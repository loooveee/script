// ==UserScript==
// @name         Gom Media
// @namespace    https://github.com/loooveee
// @version      1.3.2
// @description  Quét và tải toàn bộ ảnh/video trong thread XenForo (ZIP hoặc tải lẻ), kèm trình xem toàn màn hình.
// @author       loooveee
// @homepageURL  https://github.com/loooveee/script/tree/main/gom-media
// @supportURL   https://github.com/loooveee/script/issues
// @downloadURL  https://raw.githubusercontent.com/loooveee/script/main/gom-media/gom-media.user.js
// @updateURL    https://raw.githubusercontent.com/loooveee/script/main/gom-media/gom-media.user.js
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js#sha256=acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  // ===================== Cấu hình =====================

  const CONCURRENCY = 4;
  const ZIP_PART_LIMIT = 1024 ** 3; // Mỗi file ZIP tối đa ~1 GB, vượt thì tách part để không tràn bộ nhớ / giới hạn 4 GB của ZIP
  const PANEL_PREVIEW_LIMIT = 300; // Số ảnh xem trước trong bảng; xem hết bằng nút "Xem"
  const HISTORY_LIMIT = 10; // Số thread gần nhất được nhớ kết quả quét
  const MAX_PAGES = 2000;

  const SKIP_IMG_PATTERNS = ["/emoji/", "/avatar/", "/avatars/", "smilies", "/styles/"];
  const POST_SELECTOR = "article.message, .message, [data-author]";
  const QUOTE_SELECTOR = "blockquote, .bbCodeBlock--quote";
  const AD_SELECTOR = ".samCodeUnit, .samItem, .samBannerUnit, .samBackupItem, [data-cl-spot], .adsbygoogle";
  const IMG_HOLDER_SELECTOR = "a, .js-lbImage, .bbImageWrapper, .lbContainer:not(.js-lbContainer)";
  // Emoji / smilie / icon và ảnh xem trước link — lọc theo class vì emoji thường nằm trên CDN.
  const SKIP_IMG_SELECTOR = ".smilie, .bbCodeBlockUnfurl-icon, .bbCodeBlock--unfurl img, .avatar img";
  // Lightbox: XenForo 2.0–2.2 dùng .js-lbImage, 2.3 dùng .lbContainer-zoomer[data-src].
  const LIGHTBOX_SELECTOR =
    "a.js-lbImage, a[data-lb-sidebar-href], .js-lbImage[data-src], .lbContainer-zoomer[data-src], a[href*='/attachments/']";
  const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])|-(mp4|webm|mov|m4v|mkv)\.\d+\/?$/i;
  const MIME_EXT = {
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
    "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv",
  };

  // ===================== Xử lý URL / HTML / tên file =====================

  // "3" | "1-5" | "1,3,7-9" → [số trang đã sắp xếp]; null nếu cú pháp sai.
  function parsePages(str) {
    const pages = new Set();
    for (const part of str.split(",")) {
      const token = part.trim();
      if (!token) continue;
      const m = token.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) return null;
      let start = Number(m[1]);
      let end = m[2] ? Number(m[2]) : start;
      if (start > end) [start, end] = [end, start];
      if (start < 1 || end > MAX_PAGES) return null;
      for (let p = start; p <= end; p++) pages.add(p);
    }
    return pages.size ? [...pages].sort((a, b) => a - b) : null;
  }

  function cleanBaseUrl(rawUrl) {
    let url = rawUrl.split("#")[0].split("?")[0];
    url = url.replace(/\/page-\d+\/?$/, "").replace(/\/page\/\d+\/?$/, "");
    return url.replace(/\/+$/, "");
  }

  // XenForo dùng ".../page-2"; một số diễn đàn khác dùng ".../page/2".
  function pageStyle(doc, currentUrl) {
    if (/\/page\/\d+\/?$/.test(currentUrl.split(/[?#]/)[0])) return "slash";
    const hrefs = [...doc.querySelectorAll(".pageNav a[href], .pageNavWrapper a[href]")].map((a) => a.getAttribute("href"));
    const slash = hrefs.some((h) => /\/page\/\d+/.test(h));
    const dash = hrefs.some((h) => /\/page-\d+/.test(h));
    return slash && !dash ? "slash" : "dash";
  }

  function pageUrl(base, page, style = "dash") {
    if (page === 1) return base;
    return style === "slash" ? `${base}/page/${page}` : `${base}/page-${page}`;
  }

  // Số trang lớn nhất trên thanh phân trang (ưu tiên .pageNav để không dính link thread khác).
  function detectTotalPages(doc, threadUrl) {
    const nav = doc.querySelector(".pageNav, .pageNavWrapper");
    const scope = nav || doc;
    // Không có thanh phân trang (thread 1 trang): chỉ tính link của chính thread này,
    // tránh dính link nhảy trang của thread khác (vd. "Similar threads" → ".../page-5").
    const base = !nav && threadUrl ? cleanBaseUrl(threadUrl) : null;
    let max = 1;
    scope.querySelectorAll(".pageNav-page a, a[href*='/page-'], a[href*='/page/'], a[href*='page=']").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (base) {
        const abs = normalizeUrl(href, threadUrl);
        if (!abs || cleanBaseUrl(abs) !== base) return;
      }
      // Số trang phải kết thúc đoạn URL — không dính "page-9" nằm trong tên thread (".../home-page-9-review.55/page-2").
      const m = href.match(/page[=/-](\d+)(?=[/?#&]|$)/i);
      const p = m ? parseInt(m[1], 10) : NaN;
      if (!isNaN(p) && p <= MAX_PAGES) max = Math.max(max, p);
    });
    return max;
  }

  // Chỉ nhận http(s), bỏ #hash. Trả null nếu không dùng được (data:, blob:, javascript:...).
  function normalizeUrl(raw, baseUrl) {
    if (!raw) return null;
    try {
      const u = new URL(raw.trim(), baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      u.hash = "";
      return u.href;
    } catch {
      return null;
    }
  }

  // "/attachments/a.1/" và "/attachments/a.1" là cùng một file.
  function mediaKey(url) {
    return url.replace(/\/+$/, "");
  }

  function guessType(url) {
    return VIDEO_EXT_RE.test(url) ? "video" : "image";
  }

  // Danh sách media [{type, url}] trong các bài viết của một trang (đã bỏ trùng, bỏ ảnh trong trích dẫn).
  function extractMedia(doc, baseUrl) {
    const list = [];
    const seen = new Set();
    const add = (type, raw) => {
      const url = normalizeUrl(raw, baseUrl);
      if (!url) return false;
      const key = mediaKey(url);
      if (!seen.has(key)) {
        seen.add(key);
        list.push({ type, url });
      }
      return true;
    };
    // Bỏ qua trích dẫn và khối quảng cáo chèn trong bài (Siropu Ads Manager: .samCodeUnit / .samItem...).
    const skipped = (el) => el.closest(QUOTE_SELECTOR) || el.closest(AD_SELECTOR);

    // Chỉ lấy bài viết cấp ngoài cùng — [data-author] còn khớp cả khối trích dẫn bên trong bài.
    const posts = [...doc.querySelectorAll(POST_SELECTOR)].filter((el) => !el.parentElement?.closest(POST_SELECTOR));

    posts.forEach((post) => {
      // Link ảnh gốc (lightbox, đính kèm). Ghi nhớ phần tử để bỏ qua thumbnail bên trong.
      const captured = new Set();
      post.querySelectorAll(LIGHTBOX_SELECTOR).forEach((el) => {
        if (skipped(el)) return;
        const raw = el.getAttribute("href") || el.getAttribute("data-src");
        const url = normalizeUrl(raw, baseUrl);
        if (!url || !add(guessType(url), url)) return;
        // Zoomer kiểu cũ nằm cạnh <img> chứ không bọc nó, nên ghi nhớ khung ảnh chứa nó.
        captured.add(el.matches(".lbContainer-zoomer") && el.parentElement ? el.parentElement : el);
      });

      const wrapper = post.querySelector(".bbWrapper") || post.querySelector(".message-body") || post;
      wrapper.querySelectorAll("img").forEach((img) => {
        if (skipped(img) || img.matches(SKIP_IMG_SELECTOR)) return;
        // Khung ảnh riêng của từng ảnh — không tính khung lightbox bao cả bài (.js-lbContainer).
        const holder = img.closest(IMG_HOLDER_SELECTOR);
        if (holder && captured.has(holder)) return;
        // data-zoom-target của XenForo chỉ là cờ "1", không phải URL nên không đọc.
        const src = ["data-src", "data-original", "src", "data-url"]
          .map((attr) => normalizeUrl(img.getAttribute(attr), baseUrl))
          .find(Boolean);
        if (!src || SKIP_IMG_PATTERNS.some((p) => src.includes(p))) return;
        add("image", src);
      });

      post.querySelectorAll("video").forEach((video) => {
        if (skipped(video)) return;
        const src = [video, ...video.querySelectorAll("source")]
          .flatMap((el) => [el.getAttribute("src"), el.getAttribute("data-src")])
          .map((raw) => normalizeUrl(raw, baseUrl))
          .find(Boolean);
        if (src) add("video", src);
      });
    });

    return list;
  }

  function safeDecode(str) {
    try {
      return decodeURIComponent(str);
    } catch {
      return str;
    }
  }

  function sanitizeName(name, max = 80) {
    return name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, max).replace(/[\s.]+$/, "");
  }

  // ".../threads/ten-thread.12345" → "ten-thread".
  function slugFromUrl(url) {
    try {
      const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
      return sanitizeName(safeDecode(last).replace(/\.\d+$/, "")) || "media";
    } catch {
      return "media";
    }
  }

  // "007_ten-anh.jpg"; đuôi file lấy theo Content-Type nếu biết.
  function fileNameFor(item, index, total, mime = "") {
    let path = "";
    try {
      const u = new URL(item.url);
      path = u.pathname;
      // proxy.php?image=<url gốc> → lấy tên theo ảnh gốc
      const proxied = u.searchParams.get("image") || u.searchParams.get("url");
      if (proxied) path = new URL(proxied).pathname;
    } catch {}

    let name = safeDecode(path.split("/").filter(Boolean).pop() || "");
    name = name.replace(/-([a-z0-9]{2,5})\.\d+$/i, ".$1"); // đính kèm XenForo: "anh-jpg.123" → "anh.jpg"
    name = name.replace(/\.[a-z0-9]{2,5}-([a-z0-9]{2,5})$/i, ".$1"); // host ảnh chuyển định dạng: "abc.jpg-webp" → "abc.webp"
    name = sanitizeName(name, Infinity);

    const dot = name.lastIndexOf(".");
    let stem = dot > 0 ? name.slice(0, dot) : name;
    let ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    if (!/^[a-z0-9]{2,5}$/.test(ext)) {
      stem = name;
      ext = "";
    }
    // Cắt độ dài SAU khi tách đuôi — cắt trước thì tên dài mất đuôi file (ảnh .png bị lưu thành .jpg).
    stem = sanitizeName(stem);
    ext = MIME_EXT[mime.split(";")[0].trim().toLowerCase()] || ext || (item.type === "video" ? "mp4" : "jpg");

    const width = Math.max(3, String(total).length);
    return `${String(index + 1).padStart(width, "0")}_${stem || "media"}.${ext}`;
  }

  // Chạy worker cho từng phần tử, tối đa `limit` việc cùng lúc.
  async function runPool(items, limit, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i], i);
      }
    });
    await Promise.all(runners);
  }

  // Cho phép chạy test bằng Node mà không cần trình duyệt.
  if (typeof module !== "undefined" && typeof window === "undefined") {
    module.exports = { siteOf, parsePages, cleanBaseUrl, pageUrl, extractMedia, detectTotalPages, normalizeUrl, mediaKey, guessType, slugFromUrl, fileNameFor, runPool };
    return;
  }

  // ===================== Mạng & lưu file =====================

  // Một công việc (quét / ZIP / tải lẻ) — giữ các request đang chạy để huỷ được.
  function newJob() {
    return { cancelled: false, controller: new AbortController(), requests: new Set() };
  }

  async function fetchDoc(url, job) {
    const res = await fetch(url, { credentials: "include", signal: job.controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  function isSameOrigin(url) {
    try {
      return new URL(url).origin === location.origin;
    } catch {
      return false;
    }
  }

  // Tên miền gốc (gần đúng): "cdn.rphang.show" → "rphang.show", "img.abc.com.vn" → "abc.com.vn".
  function siteOf(hostname) {
    const labels = hostname.toLowerCase().split(".");
    const secondLevel = ["com", "net", "org", "edu", "gov", "co", "ac", "info", "biz"];
    const n = labels.length >= 3 && labels.at(-1).length === 2 && secondLevel.includes(labels.at(-2)) ? 3 : 2;
    return labels.slice(-n).join(".");
  }

  // Cùng "site" với diễn đàn (kể cả tên miền con như cdn.<diễn đàn>) — có thể cần cookie Cloudflare/đăng nhập.
  function isSameSite(url) {
    try {
      return siteOf(new URL(url).hostname) === siteOf(location.hostname);
    } catch {
      return false;
    }
  }

  // Tải một file media về bộ nhớ → { data: Uint8Array, mime }.
  // Cùng tên miền: fetch ngay trong trang để đi kèm cookie Cloudflare/đăng nhập của tab hiện tại
  // (request từ phía tiện ích dễ bị Cloudflare chặn). Khác tên miền (CDN): GM_xmlhttpRequest để không vướng CORS.
  async function fetchMedia(url, job) {
    let result;
    if (isSameOrigin(url)) {
      let res;
      try {
        res = await fetch(url, { credentials: "include", signal: job.controller.signal });
      } catch (e) {
        if (job.cancelled || e?.name === "AbortError") throw e;
        // Link của diễn đàn chuyển hướng sang máy chủ khác không bật CORS (đính kèm lưu trên S3/R2...) → fetch bị chặn.
        res = null;
      }
      if (res && !res.ok) throw new Error(`HTTP ${res.status}`);
      result = res
        ? { data: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") || "" }
        : await gmFetch(url, job);
    } else {
      result = await gmFetch(url, job);
    }
    // Link hỏng / cần đăng nhập / trang xác minh Cloudflare đều trả về HTML — không lưu thành file ảnh lỗi.
    assertMedia(result.mime);
    return result;
  }

  function assertMedia(mime) {
    if (mime.startsWith("text/html")) throw new Error("Nhận về trang HTML thay vì media (cần đăng nhập hoặc xác minh?)");
  }

  // Kiểm tra file cùng tên miền còn tải được không (chỉ lấy 1 byte) → Content-Type. Dùng trước khi tải thẳng video lớn.
  async function probeMedia(url, job) {
    const res = await fetch(url, { credentials: "include", headers: { Range: "bytes=0-0" }, signal: job.controller.signal });
    res.body?.cancel().catch(() => {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = res.headers.get("content-type") || "";
    assertMedia(mime);
    return mime;
  }

  // Chạy fn(url); nếu lỗi mà link có chữ ký/hạn dùng (vd. video RPhang "?hash=...&verify=..."),
  // tải lại trang chứa nó để lấy link mới rồi thử thêm một lần.
  async function withFreshUrl(item, job, fn) {
    try {
      return await fn(item.url);
    } catch (e) {
      if (job.cancelled || !item.page || !new URL(item.url).search) throw e;
      const fresh = await refreshItemUrl(item, job).catch(() => null);
      if (!fresh || fresh === item.url) throw e;
      item.url = fresh;
      job.refreshed = true;
      return fn(fresh);
    }
  }

  async function refreshItemUrl(item, job) {
    job.pageCache ??= new Map();
    if (!job.pageCache.has(item.page)) {
      const url = pageUrl(cleanBaseUrl(location.href), item.page, pageStyle(document, location.href));
      job.pageCache.set(item.page, fetchDoc(url, job).then((doc) => extractMedia(doc, url)));
    }
    const path = (u) => {
      const x = new URL(u);
      return x.origin + x.pathname;
    };
    const target = path(item.url);
    return (await job.pageCache.get(item.page)).find((m) => path(m.url) === target)?.url || null;
  }

  // Tải media khác tên miền (CDN) qua GM_xmlhttpRequest để không bị CORS chặn.
  function gmFetch(url, job) {
    return new Promise((resolve, reject) => {
      let req = null;
      const settle = (fn, value) => {
        job.requests.delete(req);
        fn(value);
      };
      req = GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        headers: { Referer: location.href },
        // CDN bên thứ ba không cần cookie — không gửi để tránh bị theo dõi. Tên miền con của diễn đàn thì vẫn gửi.
        anonymous: !isSameSite(url),
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) return settle(reject, new Error(`HTTP ${r.status}`));
          const mime = (/^content-type:\s*(.*)$/im.exec(r.responseHeaders || "")?.[1] || "").trim();
          // Bọc lại bằng Uint8Array của trang: ArrayBuffer từ sandbox (nhất là Firefox) bị JSZip coi là kiểu lạ.
          settle(resolve, { data: new Uint8Array(r.response), mime });
        },
        onerror: () => settle(reject, new Error("Lỗi mạng")),
        ontimeout: () => settle(reject, new Error("Hết thời gian chờ")),
        onabort: () => settle(reject, new Error("Đã huỷ")),
      });
      if (job.cancelled) req?.abort?.();
      else job.requests.add(req);
    });
  }

  function gmDownload(url, name, job) {
    return new Promise((resolve, reject) => {
      let req = null;
      const settle = (fn, value) => {
        job.requests.delete(req);
        job.controller.signal.removeEventListener("abort", onCancel);
        fn(value);
      };
      // abort() của GM_download không phải lúc nào cũng gọi lại callback — tự kết thúc khi bấm Dừng để công việc không treo.
      const onCancel = () => {
        try {
          req?.abort?.();
        } catch {}
        settle(reject, new Error("Đã huỷ"));
      };
      req = GM_download({
        url,
        name,
        saveAs: false,
        onload: () => settle(resolve),
        onerror: (e) => settle(reject, new Error(e?.error || e?.details || "Lỗi tải")),
        ontimeout: () => settle(reject, new Error("Hết thời gian chờ")),
        onabort: () => settle(reject, new Error("Đã huỷ")),
      });
      if (job.cancelled) return onCancel();
      if (req?.abort) job.requests.add(req);
      job.controller.signal.addEventListener("abort", onCancel, { once: true });
    });
  }

  // Lưu qua thẻ <a download>. Với link cùng tên miền trình duyệt tải thẳng xuống đĩa (không qua bộ nhớ);
  // nếu máy chủ gửi kèm tên file (Content-Disposition) thì trình duyệt ưu tiên tên đó.
  function clickDownload(href, filename) {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    clickDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  }

  // ===================== Lưu kết quả theo thread =====================

  function loadResults(base) {
    return GM_getValue("threads", {})[base]?.results || [];
  }

  function saveResults(base, results) {
    const all = GM_getValue("threads", {});
    all[base] = { results, at: Date.now() };
    const keep = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, HISTORY_LIMIT);
    GM_setValue("threads", Object.fromEntries(keep));
  }

  function forgetResults(base) {
    const all = GM_getValue("threads", {});
    delete all[base];
    GM_setValue("threads", all);
  }

  // ===================== Giao diện =====================

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    [hidden], .hidden { display: none !important; }
    button { border: 0; border-radius: 6px; padding: 8px 6px; font-size: 12px; font-weight: 600; color: #fff; cursor: pointer; }
    button:hover:not(:disabled) { filter: brightness(1.12); }
    button:disabled { opacity: .45; cursor: default; }
    .blue { background: #2f6fed; } .green { background: #22a052; } .red { background: #d93a3a; }
    .gray { background: #555b66; } .teal { background: #1597a8; }

    .panel {
      position: fixed; right: 18px; top: 70px; z-index: 2147483646;
      width: min(400px, calc(100vw - 24px)); max-height: min(680px, calc(100vh - 90px));
      display: flex; flex-direction: column; gap: 8px; padding: 12px;
      background: #1b1d22; color: #e8e9ec; border: 1px solid #333843; border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.45); font-size: 13px;
    }
    .head { display: flex; align-items: center; justify-content: space-between; }
    .head b { font-size: 14px; }
    .x { background: transparent; color: #aab; font-size: 16px; padding: 2px 6px; }
    .hint { margin: 0; font-size: 12px; color: #a3a8b3; line-height: 1.5; }
    code { background: #2a2e36; padding: 0 4px; border-radius: 3px; color: #ffcf6e; font-family: Consolas, monospace; }
    input {
      width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #3a3f4b;
      background: #111317; color: #e8e9ec; font-size: 13px; outline: none;
    }
    input:focus { border-color: #2f6fed; }
    .row { display: flex; gap: 6px; } .row button { flex: 1; }
    .status { min-height: 16px; font-size: 12px; color: #cfd3da; word-break: break-word; }
    .bar { height: 6px; background: #2a2e36; border-radius: 3px; overflow: hidden; }
    .fill { height: 100%; width: 0; background: #22a052; transition: width .2s; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; overflow-y: auto; min-height: 0; }
    .more { grid-column: 1 / -1; text-align: center; font-size: 12px; color: #a3a8b3; padding: 6px; }

    .tile { position: relative; aspect-ratio: 1; background: #111317; border-radius: 6px; overflow: hidden; cursor: pointer; }
    .tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tile video { pointer-events: none; }
    .tile .badge {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 28px; color: #fff; background: rgba(0,0,0,.25); pointer-events: none;
    }

    .viewer { position: fixed; inset: 0; z-index: 2147483647; background: #0d0e11; display: flex; flex-direction: column; }
    .vbar {
      display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
      border-bottom: 1px solid #2a2e36; color: #e8e9ec; font-size: 14px;
    }
    .vgrid {
      flex: 1; overflow-y: auto; padding: 10px; display: grid; gap: 10px; align-content: start;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    }
    .lightbox { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.95); display: flex; align-items: center; justify-content: center; }
    .stage { max-width: 92vw; max-height: 92vh; display: flex; align-items: center; justify-content: center; }
    .stage img, .stage video { max-width: 92vw; max-height: 92vh; }
    .nav { position: fixed; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,.12); font-size: 32px; padding: 10px 16px; }
    .prev { left: 12px; } .next { right: 12px; }
    .lbcount { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); color: #cfd3da; font-size: 13px; }
  `;

  const HTML = `
    <div class="panel hidden">
      <div class="head"><b>Gom Media</b><button class="x" data-act="close" title="Đóng">✕</button></div>
      <p class="hint">Trang: <code>3</code> · <code>1-5</code> · <code>1,3,7-9</code> · trống = tất cả <span class="total"></span></p>
      <input class="range" placeholder="để trống = quét tất cả trang" />
      <div class="row">
        <button class="blue" data-act="scan">🔍 Quét</button>
        <button class="red" data-act="stop" hidden>⏹ Dừng</button>
        <button class="gray" data-act="clear">🗑 Xoá</button>
      </div>
      <div class="row">
        <button class="green" data-act="zip">📦 Tải ZIP</button>
        <button class="blue" data-act="each">⬇️ Tải lẻ</button>
        <button class="teal" data-act="view">📺 Xem</button>
      </div>
      <div class="status"></div>
      <div class="bar"><div class="fill"></div></div>
      <div class="grid"></div>
    </div>
    <div class="viewer hidden">
      <div class="vbar"><span class="vcount"></span><button class="x" data-act="vclose" title="Đóng (Esc)">✕</button></div>
      <div class="vgrid"></div>
    </div>
    <div class="lightbox hidden">
      <span class="lbcount"></span>
      <button class="nav prev" data-act="prev">‹</button>
      <div class="stage"></div>
      <button class="nav next" data-act="next">›</button>
    </div>
  `;

  const state = {
    base: cleanBaseUrl(location.href),
    results: [],
    job: null,
    lbIndex: -1,
    savedOverflow: "",
  };

  let ui = null;

  // Trang bật Trusted Types chặn gán chuỗi thường vào innerHTML — bọc qua một policy nếu có.
  let ttPolicy;
  function trustedHtml(html) {
    if (ttPolicy === undefined) {
      try {
        ttPolicy = window.trustedTypes?.createPolicy?.("gom-media", { createHTML: (s) => s }) || null;
      } catch {
        ttPolicy = null;
      }
    }
    return ttPolicy ? ttPolicy.createHTML(html) : html;
  }

  function buildUi() {
    const host = document.createElement("div");
    host.id = "gom-media";
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = trustedHtml(`<style>${CSS}</style>${HTML}`);
    document.documentElement.appendChild(host);

    const $ = (sel) => root.querySelector(sel);
    ui = {
      root,
      panel: $(".panel"),
      range: $(".range"),
      total: $(".total"),
      status: $(".status"),
      fill: $(".fill"),
      grid: $(".grid"),
      viewer: $(".viewer"),
      vgrid: $(".vgrid"),
      vcount: $(".vcount"),
      lightbox: $(".lightbox"),
      stage: $(".stage"),
      lbcount: $(".lbcount"),
      btn: Object.fromEntries([...root.querySelectorAll("[data-act]")].map((b) => [b.dataset.act, b])),
    };

    ui.range.value = GM_getValue("pageRange", "");
    const totalPages = detectTotalPages(document, location.href);
    ui.total.textContent = `(thread có ${totalPages} trang)`;

    root.addEventListener("click", onAction);
    ui.range.addEventListener("keydown", (e) => {
      e.stopPropagation(); // không để phím tắt của trang nuốt mất
      if (e.key === "Enter") scan();
    });
    ui.lightbox.addEventListener("click", (e) => {
      if (e.target === ui.lightbox) closeLightbox();
    });
    ui.grid.addEventListener("click", onTileClick);
    ui.vgrid.addEventListener("click", onTileClick);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("beforeunload", (e) => {
      if (state.job) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    state.results = loadResults(state.base);
    renderPanelGrid();
    setStatus(state.results.length ? `Đã có ${state.results.length} file media từ lần quét trước` : "Bấm Quét để bắt đầu");
    setBusy(false);
  }

  function onAction(e) {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const actions = {
      close: () => ui.panel.classList.add("hidden"),
      scan,
      stop: cancelJob,
      clear: clearResults,
      zip: downloadZip,
      each: downloadEach,
      view: openViewer,
      vclose: closeViewer,
      prev: () => stepLightbox(-1),
      next: () => stepLightbox(1),
    };
    actions[act]?.();
  }

  function onKey(e) {
    if (!ui.lightbox.classList.contains("hidden")) {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") stepLightbox(1);
      else if (e.key === "ArrowLeft") stepLightbox(-1);
      else return;
    } else if (!ui.viewer.classList.contains("hidden")) {
      if (e.key === "Escape") closeViewer();
      else return;
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function setStatus(message) {
    ui.status.textContent = message;
  }

  function setProgress(done, total) {
    const pct = total ? Math.min(100, Math.floor((done / total) * 100)) : 0;
    ui.fill.style.width = `${pct}%`;
  }

  function setBusy(busy) {
    const b = ui.btn;
    b.stop.hidden = !busy;
    b.scan.hidden = busy;
    for (const key of ["clear", "zip", "each"]) b[key].disabled = busy;
    if (!busy) {
      b.zip.disabled = b.each.disabled = !state.results.length;
      b.view.disabled = !state.results.length;
    }
    ui.range.disabled = busy;
  }

  // Chạy một công việc: khoá nút, bắt lỗi, luôn mở khoá lại khi xong.
  async function runJob(fn) {
    if (state.job) return;
    const job = newJob();
    state.job = job;
    setBusy(true);
    setProgress(0, 0);
    try {
      setStatus(await fn(job));
    } catch (e) {
      console.error("[Gom Media]", e);
      setStatus(job.cancelled ? "Đã dừng" : `Lỗi: ${e.message}`);
    } finally {
      state.job = null;
      setBusy(false);
    }
  }

  function cancelJob() {
    const job = state.job;
    if (!job) return;
    job.cancelled = true;
    job.controller.abort();
    for (const req of job.requests) {
      try {
        req.abort();
      } catch {}
    }
    setStatus("Đang dừng...");
  }

  // ---------- Quét ----------

  function scan() {
    runJob(async (job) => {
      const raw = ui.range.value.trim();
      GM_setValue("pageRange", raw);
      state.base = cleanBaseUrl(location.href);

      const totalPages = detectTotalPages(document, location.href);
      let pages = raw ? parsePages(raw) : Array.from({ length: totalPages }, (_, i) => i + 1);
      if (!pages) return "Số trang không hợp lệ. Ví dụ: 3 | 1-5 | 1,3,7-9";
      pages = pages.filter((p) => p <= totalPages);
      if (!pages.length) return `Thread chỉ có ${totalPages} trang`;

      const style = pageStyle(document, location.href);
      const perPage = new Array(pages.length).fill([]);
      const failed = [];
      let done = 0;
      setStatus(`Đang quét 0/${pages.length} trang...`);

      await runPool(pages, CONCURRENCY, async (p, i) => {
        if (job.cancelled) return;
        const url = pageUrl(state.base, p, style);
        try {
          // Ghi nhớ số trang để sau này lấy lại link mới nếu link có chữ ký (?hash=&verify=) hết hạn.
          perPage[i] = extractMedia(await fetchDoc(url, job), url).map((item) => ({ ...item, page: p }));
        } catch (e) {
          if (job.cancelled) return;
          console.warn(`[Gom Media] Lỗi trang ${p}:`, e);
          failed.push(p);
        }
        done++;
        setProgress(done, pages.length);
        setStatus(`Đang quét ${done}/${pages.length} trang...`);
      });

      const seen = new Set();
      const results = [];
      for (const item of perPage.flat()) {
        const key = mediaKey(item.url);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(item);
      }

      // Dừng sớm hoặc trang bị lỗi (mất mạng, Cloudflare...) mà chưa lấy được gì thì giữ nguyên kết quả cũ.
      if (results.length || (!job.cancelled && !failed.length)) {
        state.results = results;
        saveResults(state.base, results);
        renderPanelGrid();
      }

      let message = job.cancelled
        ? `Đã dừng — giữ ${results.length} file media từ ${done}/${pages.length} trang`
        : `Xong! Tìm thấy ${results.length} file media trong ${pages.length} trang`;
      if (failed.length) message += ` (lỗi ${failed.length} trang: ${failed.sort((a, b) => a - b).join(", ")})`;
      return message;
    });
  }

  // ---------- Tải ZIP (tự tách part khi quá lớn) ----------

  function downloadZip() {
    if (!state.results.length) return setStatus("Chưa có media nào để tải!");
    if (typeof JSZip === "undefined") return setStatus("Không nạp được thư viện JSZip (@require)!");

    runJob(async (job) => {
      const items = state.results;
      const total = items.length;
      const prefix = `${slugFromUrl(state.base)}_${new Date().toISOString().slice(0, 10)}`;
      const saved = [];
      let zip = new JSZip();
      let partBytes = 0;
      let partFiles = 0;
      let parts = 0;
      let ok = 0;
      let done = 0;

      const flush = async (isLast) => {
        if (!partFiles) return;
        const current = zip;
        zip = new JSZip();
        partBytes = partFiles = 0;
        parts++;
        const name = isLast && parts === 1 ? `${prefix}.zip` : `${prefix}_part${parts}.zip`;
        setStatus(`Đang đóng gói ${name}...`);
        // Ảnh/video đã nén sẵn, dùng STORE cho nhanh.
        const blob = await current.generateAsync({ type: "blob", compression: "STORE" });
        saveBlob(blob, name);
        saved.push(name);
      };

      const errors = newErrorLog();

      await runPool(items, CONCURRENCY, async (item, i) => {
        if (job.cancelled) return;
        try {
          const { data, mime } = await withFreshUrl(item, job, (url) => fetchMedia(url, job));
          zip.file(fileNameFor(item, i, total, mime), data);
          partBytes += data.byteLength;
          partFiles++;
          ok++;
          if (partBytes >= ZIP_PART_LIMIT) await flush(false);
        } catch (e) {
          if (!job.cancelled) errors.add(item.url, e);
        }
        done++;
        setProgress(done, total);
        if (!job.cancelled) setStatus(`Đang tải để nén ${done}/${total}...`);
      });

      if (job.refreshed) saveResults(state.base, state.results);
      if (job.cancelled) {
        return saved.length ? `Đã dừng — đã lưu ${saved.join(", ")}` : "Đã dừng tạo ZIP";
      }
      if (!ok) return `Không tải được file nào vào ZIP!${errors.summary()}`;
      await flush(true);
      return `Đã lưu ${saved.join(", ")} (${ok}/${total} file)${errors.summary()}`;
    });
  }

  // Gom lỗi theo lý do để báo ngắn gọn trên bảng, chi tiết từng link ở Console.
  function newErrorLog() {
    const reasons = new Map();
    let count = 0;
    return {
      add(url, e) {
        count++;
        const reason = e?.message || String(e);
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
        console.warn("[Gom Media]", url, e);
      },
      summary() {
        if (!count) return "";
        const top = [...reasons].sort((a, b) => b[1] - a[1])[0][0];
        return ` — lỗi ${count} file: ${top}${reasons.size > 1 ? " (và lý do khác, xem Console)" : ""}`;
      },
    };
  }

  // ---------- Tải lẻ ----------

  function downloadEach() {
    if (!state.results.length) return setStatus("Chưa có media nào để tải!");

    runJob(async (job) => {
      const items = state.results;
      const total = items.length;
      const folder = slugFromUrl(state.base);
      // Tampermonkey (chế độ Browser API) tạo được thư mục con; Violentmonkey thì không.
      const canFolder = GM_info?.scriptHandler === "Tampermonkey";
      const errors = newErrorLog();
      let gmBroken = false; // GM_download hỏng một lần thì các file sau đi thẳng đường dự phòng
      let inFolder = 0;
      let flat = 0;
      let done = 0;

      // Lưu từ trong trang bằng thẻ <a download> — không tạo được thư mục con nên ghép tên thread vào đầu.
      const saveViaPage = async (item, i) => {
        if (item.type === "video" && isSameOrigin(item.url)) {
          // Video cùng tên miền: kiểm tra link rồi để trình duyệt tải thẳng xuống đĩa, không giữ cả file trong bộ nhớ.
          const mime = await withFreshUrl(item, job, (url) => probeMedia(url, job));
          clickDownload(item.url, `${folder}_${fileNameFor(item, i, total, mime)}`);
        } else {
          const { data, mime } = await withFreshUrl(item, job, (url) => fetchMedia(url, job));
          saveBlob(new Blob([data], { type: mime }), `${folder}_${fileNameFor(item, i, total, mime)}`);
        }
        flat++;
      };

      await runPool(items, CONCURRENCY, async (item, i) => {
        if (job.cancelled) return;
        try {
          // File cùng tên miền (vd. /attachments/ của diễn đàn) luôn tải trong trang để qua được Cloudflare.
          // File trên CDN khác: GM_download (tải thẳng xuống đĩa), hỏng thì tải trong trang.
          if (isSameOrigin(item.url) || gmBroken) {
            await saveViaPage(item, i);
          } else {
            try {
              const file = fileNameFor(item, i, total);
              await gmDownload(item.url, canFolder ? `${folder}/${file}` : `${folder}_${file}`, job);
              if (canFolder) inFolder++;
              else flat++;
            } catch (e) {
              if (job.cancelled) throw e;
              if (!gmBroken) console.warn("[Gom Media] GM_download lỗi, chuyển sang tải trong trang:", e);
              gmBroken = true;
              await saveViaPage(item, i);
            }
          }
        } catch (e) {
          if (!job.cancelled) errors.add(item.url, e);
        }
        done++;
        setProgress(done, total);
        if (!job.cancelled) setStatus(`Đang tải ${done}/${total}...`);
      });

      if (job.refreshed) saveResults(state.base, state.results);
      const ok = inFolder + flat;
      const where = [
        inFolder && `${inFolder} file vào Downloads/${folder}`,
        flat && `${flat} file vào Downloads (tên bắt đầu bằng "${folder}_")`,
      ].filter(Boolean).join(", ");
      if (job.cancelled) return `Đã dừng — đã tải ${ok}/${total} file${where ? `: ${where}` : ""}`;
      return `Đã tải ${ok}/${total} file${where ? `: ${where}` : ""}${errors.summary()}`;
    });
  }

  function clearResults() {
    state.results = [];
    forgetResults(state.base);
    renderPanelGrid();
    setProgress(0, 0);
    setBusy(false);
    setStatus("Đã xoá kết quả của thread này");
  }

  // ---------- Hiển thị ----------

  const videoObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target;
        if (entry.isIntersecting && !video.src) video.src = video.dataset.src;
      }
    },
    { rootMargin: "200px" }
  );

  function makeTile(item, index) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.index = index;
    if (item.type === "video") {
      // Chỉ nạp video khi cuộn tới, tránh mở hàng trăm kết nối một lúc.
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      video.dataset.src = item.url;
      videoObserver.observe(video);
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = "▶";
      tile.append(video, badge);
    } else {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer-when-downgrade";
      img.src = item.url;
      tile.append(img);
    }
    return tile;
  }

  function renderPanelGrid() {
    ui.grid.querySelectorAll("video").forEach((v) => videoObserver.unobserve(v));
    ui.grid.replaceChildren();
    const fragment = document.createDocumentFragment();
    state.results.slice(0, PANEL_PREVIEW_LIMIT).forEach((item, i) => fragment.append(makeTile(item, i)));
    const extra = state.results.length - PANEL_PREVIEW_LIMIT;
    if (extra > 0) {
      const more = document.createElement("div");
      more.className = "more";
      more.textContent = `… và ${extra} file nữa — bấm 📺 Xem để xem hết`;
      fragment.append(more);
    }
    ui.grid.append(fragment);
  }

  function openViewer() {
    if (!state.results.length) return;
    ui.vgrid.replaceChildren(...state.results.map(makeTile));
    ui.vcount.textContent = `${state.results.length} file media — bấm để phóng to, ← → để chuyển, Esc để đóng`;
    ui.viewer.classList.remove("hidden");
    state.savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }

  function closeViewer() {
    closeLightbox();
    ui.vgrid.querySelectorAll("video").forEach((v) => videoObserver.unobserve(v));
    ui.vgrid.replaceChildren();
    ui.viewer.classList.add("hidden");
    document.documentElement.style.overflow = state.savedOverflow;
  }

  function onTileClick(e) {
    const tile = e.target.closest(".tile");
    if (tile) openLightbox(Number(tile.dataset.index));
  }

  function openLightbox(index) {
    const items = state.results;
    if (!items.length) return;
    state.lbIndex = (index + items.length) % items.length;
    const item = items[state.lbIndex];
    const el = document.createElement(item.type === "video" ? "video" : "img");
    el.src = item.url;
    if (item.type === "video") {
      el.controls = true;
      el.autoplay = true;
    }
    ui.root.querySelectorAll("video").forEach((v) => v.pause());
    ui.stage.replaceChildren(el);
    ui.lbcount.textContent = `${state.lbIndex + 1} / ${items.length}`;
    ui.lightbox.classList.remove("hidden");
  }

  function stepLightbox(delta) {
    openLightbox(state.lbIndex + delta);
  }

  function closeLightbox() {
    ui.stage.replaceChildren();
    ui.lightbox.classList.add("hidden");
  }

  // ===================== Khởi động =====================

  function ensureUi() {
    if (!ui) buildUi();
  }

  // Chỉ mở thủ công từ menu của Tampermonkey/Violentmonkey — không tự hiện gì trên trang.
  GM_registerMenuCommand("Mở Gom Media", () => {
    ensureUi();
    ui.panel.classList.remove("hidden");
  });
})();
