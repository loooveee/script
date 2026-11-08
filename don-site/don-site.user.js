// ==UserScript==
// @name         Dọn Site
// @namespace    https://github.com/loooveee
// @version      1.0.0
// @description  Xem dung lượng và xoá dữ liệu của trang đang mở: cookie, Local/Session Storage, IndexedDB, Cache Storage, Service Worker, File System (OPFS).
// @author       loooveee
// @homepageURL  https://github.com/loooveee/script/tree/main/don-site
// @supportURL   https://github.com/loooveee/script/issues
// @downloadURL  https://raw.githubusercontent.com/loooveee/script/main/don-site/don-site.user.js
// @updateURL    https://raw.githubusercontent.com/loooveee/script/main/don-site/don-site.user.js
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_cookie
// ==/UserScript==

(function () {
  "use strict";

  // Kiểu file mà "làm mới cache" được phép tải lại — bỏ qua XHR/fetch/beacon để không gọi lại API của trang.
  const REFRESHABLE_INITIATORS = new Set(["script", "link", "img", "image", "css", "video", "audio", "track", "other"]);
  const MAX_REFRESH = 400;

  // ===================== Tiện ích =====================

  function formatBytes(n) {
    if (!Number.isFinite(n)) return "?";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(i && n < 10 ? 1 : 0)} ${units[i]}`;
  }

  // Chạy fn, quá `ms` thì bỏ — vài API (GM_cookie, IndexedDB) có thể không bao giờ gọi lại.
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: hết thời gian chờ`)), ms)),
    ]);
  }

  async function runPool(items, limit, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    });
    await Promise.all(runners);
  }

  // ===================== Cookie =====================

  // GM_cookie (Tampermonkey) thấy được cả cookie HttpOnly; Violentmonkey không có API này.
  function hasGmCookie() {
    return typeof GM_cookie !== "undefined" && typeof GM_cookie?.list === "function";
  }

  function gmCookieList() {
    return withTimeout(
      new Promise((resolve, reject) => {
        GM_cookie.list({ url: location.href }, (cookies, error) => (error ? reject(new Error(String(error))) : resolve(cookies || [])));
      }),
      4000,
      "GM_cookie"
    );
  }

  function gmCookieDelete(cookie) {
    const host = (cookie.domain || location.hostname).replace(/^\./, "");
    const url = `${location.protocol}//${host}${cookie.path || "/"}`;
    return withTimeout(
      new Promise((resolve, reject) => {
        GM_cookie.delete({ url, name: cookie.name }, (error) => (error ? reject(new Error(String(error))) : resolve()));
      }),
      4000,
      "GM_cookie"
    );
  }

  function jsCookieNames() {
    return [...new Set(document.cookie.split(";").map((s) => s.split("=")[0].trim()).filter(Boolean))];
  }

  // Cookie chỉ xoá được khi ghi đè đúng domain + path lúc tạo, nên thử mọi tổ hợp domain cha × path cha.
  function expireJsCookie(name) {
    const parts = location.hostname.split(".");
    const domains = ["", `; domain=${location.hostname}`];
    for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join(".")}`);
    // Path có thể được đặt có hoặc không có "/" ở cuối ("/a" khác "/a/") nên thử cả hai.
    const paths = new Set(["/"]);
    let path = "";
    for (const seg of location.pathname.split("/").slice(1).filter(Boolean)) {
      path += `/${seg}`;
      paths.add(path);
      paths.add(`${path}/`);
    }
    const secure = location.protocol === "https:" ? "; secure" : "";
    for (const domain of domains) {
      for (const p of paths) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=${p}${domain}${secure}`;
      }
    }
  }

  // ===================== Các loại dữ liệu =====================
  // count(): { n, detail? } — hoặc { unsupported: "lý do" }. clear(): chuỗi kết quả.

  const TYPES = [
    {
      key: "cookies",
      label: "Cookie",
      async count() {
        if (hasGmCookie()) {
          try {
            const cookies = await gmCookieList();
            const httpOnly = cookies.filter((c) => c.httpOnly).length;
            return { n: cookies.length, detail: httpOnly ? `${httpOnly} HttpOnly` : "" };
          } catch {
            // GM_cookie bị tắt / lỗi → dùng document.cookie
          }
        }
        return { n: jsCookieNames().length, detail: "không thấy được cookie HttpOnly" };
      },
      async clear() {
        let viaGm = 0;
        if (hasGmCookie()) {
          try {
            const cookies = await gmCookieList();
            for (const c of cookies) {
              try {
                await gmCookieDelete(c);
                viaGm++;
              } catch {}
            }
          } catch {}
        }
        const names = jsCookieNames();
        names.forEach(expireJsCookie);
        const left = jsCookieNames().length;
        const total = Math.max(viaGm, names.length);
        return left ? `xoá ${total - left}, còn ${left} không xoá được` : `đã xoá ${total}`;
      },
    },
    {
      key: "localStorage",
      label: "Local Storage",
      count() {
        try {
          return { n: localStorage.length };
        } catch {
          return { unsupported: "trang chặn truy cập" };
        }
      },
      clear() {
        const n = localStorage.length;
        localStorage.clear();
        return `đã xoá ${n} mục`;
      },
    },
    {
      key: "sessionStorage",
      label: "Session Storage",
      count() {
        try {
          return { n: sessionStorage.length };
        } catch {
          return { unsupported: "trang chặn truy cập" };
        }
      },
      clear() {
        const n = sessionStorage.length;
        sessionStorage.clear();
        return `đã xoá ${n} mục`;
      },
    },
    {
      key: "indexedDB",
      label: "IndexedDB",
      async count() {
        if (!window.indexedDB?.databases) return { unsupported: "trình duyệt không liệt kê được" };
        const names = (await indexedDB.databases()).map((d) => d.name).filter(Boolean);
        return { n: names.length, detail: names.slice(0, 4).join(", ") + (names.length > 4 ? "…" : "") };
      },
      async clear() {
        const names = (await indexedDB.databases()).map((d) => d.name).filter(Boolean);
        let done = 0;
        let blocked = 0;
        await Promise.all(
          names.map(
            (name) =>
              new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = () => {
                  done++;
                  resolve();
                };
                req.onerror = () => resolve();
                // Trang vẫn đang mở kết nối: lệnh xoá chờ tới khi kết nối đóng (tải lại trang là xong).
                req.onblocked = () => {
                  blocked++;
                  resolve();
                };
              })
          )
        );
        return blocked ? `đã xoá ${done}, ${blocked} sẽ xoá xong khi tải lại trang` : `đã xoá ${done}`;
      },
    },
    {
      key: "cacheStorage",
      label: "Cache Storage",
      async count() {
        if (!window.caches) return { unsupported: "chỉ có trên trang https" };
        return { n: (await caches.keys()).length };
      },
      async clear() {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        return `đã xoá ${keys.length}`;
      },
    },
    {
      key: "serviceWorkers",
      label: "Service Worker",
      async count() {
        if (!navigator.serviceWorker?.getRegistrations) return { unsupported: "chỉ có trên trang https" };
        return { n: (await navigator.serviceWorker.getRegistrations()).length };
      },
      async clear() {
        const regs = await navigator.serviceWorker.getRegistrations();
        const ok = (await Promise.all(regs.map((r) => r.unregister().catch(() => false)))).filter(Boolean).length;
        return `đã gỡ ${ok}`;
      },
    },
    {
      key: "opfs",
      label: "File System (OPFS)",
      async count() {
        if (!navigator.storage?.getDirectory) return { unsupported: "trình duyệt không hỗ trợ" };
        const root = await navigator.storage.getDirectory();
        let n = 0;
        for await (const _ of root.keys()) n++;
        return { n };
      },
      async clear() {
        const root = await navigator.storage.getDirectory();
        const names = [];
        for await (const name of root.keys()) names.push(name);
        let ok = 0;
        for (const name of names) {
          try {
            await root.removeEntry(name, { recursive: true });
            ok++;
          } catch {}
        }
        return ok === names.length ? `đã xoá ${ok}` : `xoá ${ok}/${names.length} (file đang được dùng)`;
      },
    },
    {
      key: "httpCache",
      label: "Làm mới cache trình duyệt",
      note: "userscript không xoá được cache trình duyệt; tuỳ chọn này tải lại các file của trang (script, CSS, ảnh…) để thay bản cũ trong cache",
      defaultOff: true,
      count() {
        return { n: refreshableUrls().length, detail: "file" };
      },
      async clear() {
        const urls = refreshableUrls();
        let ok = 0;
        await runPool(urls, 6, async (url) => {
          try {
            const sameOrigin = new URL(url).origin === location.origin;
            await fetch(url, { cache: "reload", credentials: "include", mode: sameOrigin ? "same-origin" : "no-cors" });
            ok++;
          } catch {}
        });
        return `đã làm mới ${ok}/${urls.length} file`;
      },
    },
  ];

  function refreshableUrls() {
    const urls = new Set([location.href.split("#")[0]]);
    for (const entry of performance.getEntriesByType("resource")) {
      if (REFRESHABLE_INITIATORS.has(entry.initiatorType) && /^https?:/.test(entry.name)) urls.add(entry.name.split("#")[0]);
    }
    return [...urls].slice(0, MAX_REFRESH);
  }

  async function estimateUsage() {
    if (!navigator.storage?.estimate) return null;
    try {
      return await navigator.storage.estimate();
    } catch {
      return null;
    }
  }

  // ===================== Giao diện =====================

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    [hidden] { display: none !important; }
    .backdrop { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .dialog {
      width: min(460px, 100%); max-height: calc(100vh - 32px); overflow-y: auto;
      background: #1b1d22; color: #e8e9ec; border: 1px solid #333843; border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 14px; font-size: 13px; display: flex; flex-direction: column; gap: 10px;
    }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .head b { font-size: 15px; }
    .origin { color: #a3a8b3; font-size: 12px; word-break: break-all; }
    .usage { background: #111317; border-radius: 6px; padding: 8px 10px; line-height: 1.6; }
    .usage small { color: #a3a8b3; }
    .list { display: flex; flex-direction: column; gap: 2px; }
    label.item { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: start; padding: 6px 4px; border-radius: 6px; cursor: pointer; }
    label.item:hover { background: #23262d; }
    label.item.off { opacity: .45; cursor: default; }
    label.item input { margin: 2px 0 0; }
    .name { font-weight: 600; }
    .sub { display: block; font-weight: 400; color: #a3a8b3; font-size: 12px; margin-top: 2px; }
    .count { color: #ffcf6e; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .result { color: #7ee2a8; font-size: 12px; display: block; margin-top: 2px; font-weight: 400; }
    .opts { display: flex; align-items: center; gap: 8px; color: #cfd3da; cursor: pointer; }
    .row { display: flex; gap: 8px; }
    button { border: 0; border-radius: 6px; padding: 9px 10px; font-size: 13px; font-weight: 600; color: #fff; cursor: pointer; flex: 1; }
    button:hover:not(:disabled) { filter: brightness(1.12); }
    button:disabled { opacity: .45; cursor: default; }
    .danger { background: #d93a3a; } .gray { background: #555b66; }
    .x { background: transparent; color: #aab; font-size: 16px; padding: 2px 6px; flex: 0; }
    .status { min-height: 16px; color: #cfd3da; font-size: 12px; }
  `;

  let ui = null;

  function span(className, text) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
  }

  function buildUi() {
    const host = document.createElement("div");
    host.id = "don-site";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="backdrop" hidden>
        <div class="dialog" role="dialog" aria-label="Dọn Site">
          <div class="head"><b>🧹 Dọn Site</b><button class="x" data-act="close" title="Đóng (Esc)">✕</button></div>
          <div class="origin"></div>
          <div class="usage"></div>
          <div class="list"></div>
          <label class="opts"><input type="checkbox" class="reload" /> Tải lại trang sau khi xoá</label>
          <div class="status"></div>
          <div class="row">
            <button class="danger" data-act="clear">Xoá dữ liệu đã chọn</button>
            <button class="gray" data-act="close">Đóng</button>
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    const $ = (s) => root.querySelector(s);
    ui = { root, backdrop: $(".backdrop"), origin: $(".origin"), usage: $(".usage"), list: $(".list"), reload: $(".reload"), status: $(".status"), clearBtn: $('[data-act="clear"]') };

    ui.reload.checked = GM_getValue("reload", true);
    ui.reload.addEventListener("change", () => GM_setValue("reload", ui.reload.checked));
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") close();
      else if (act === "clear") clearSelected();
    });
    ui.backdrop.addEventListener("click", (e) => {
      if (e.target === ui.backdrop) close();
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && !ui.backdrop.hidden) {
          e.stopPropagation();
          close();
        }
      },
      true
    );
  }

  function close() {
    ui.backdrop.hidden = true;
  }

  function savedSelection() {
    const saved = GM_getValue("selected", null);
    return (type) => (saved && type.key in saved ? saved[type.key] : !type.defaultOff);
  }

  async function open() {
    if (!ui) buildUi();
    ui.backdrop.hidden = false;
    ui.origin.textContent = location.origin;
    ui.status.textContent = "";
    await refresh();
  }

  // Đếm lại mọi loại dữ liệu và vẽ danh sách. results: { key: "kết quả lần xoá vừa rồi" }.
  async function refresh(results = {}) {
    ui.usage.textContent = "Đang đọc dung lượng…";
    const isSelected = savedSelection();
    const counts = await Promise.all(
      TYPES.map(async (t) => {
        try {
          return await withTimeout(Promise.resolve(t.count()), 5000, t.label);
        } catch (e) {
          return { unsupported: e.message };
        }
      })
    );

    ui.list.replaceChildren(
      ...TYPES.map((t, i) => {
        const c = counts[i];
        const item = document.createElement("label");
        item.className = "item" + (c.unsupported ? " off" : "");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.dataset.key = t.key;
        box.disabled = !!c.unsupported;
        box.checked = !c.unsupported && isSelected(t);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = t.label;
        const sub = c.unsupported || [c.detail, t.note].filter(Boolean).join(" · ");
        if (sub) name.append(span("sub", sub));
        if (results[t.key]) name.append(span("result", `✓ ${results[t.key]}`));
        const count = document.createElement("span");
        count.className = "count";
        count.textContent = c.unsupported ? "—" : String(c.n);
        item.append(box, name, count);
        return item;
      })
    );

    const est = await estimateUsage();
    if (!est) {
      ui.usage.textContent = "Trình duyệt không cho biết dung lượng.";
    } else {
      const details = Object.entries(est.usageDetails || {})
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${formatBytes(v)}`)
        .join(" · ");
      ui.usage.innerHTML = `Đang dùng <b></b> / hạn mức <span></span>${details ? "<br><small></small>" : ""}`;
      ui.usage.querySelector("b").textContent = formatBytes(est.usage);
      ui.usage.querySelector("span").textContent = formatBytes(est.quota);
      if (details) ui.usage.querySelector("small").textContent = details;
    }
  }

  async function clearSelected() {
    const boxes = [...ui.list.querySelectorAll("input[type=checkbox]")];
    const chosen = boxes.filter((b) => b.checked && !b.disabled).map((b) => b.dataset.key);
    const selection = Object.fromEntries(boxes.filter((b) => !b.disabled).map((b) => [b.dataset.key, b.checked]));
    GM_setValue("selected", selection);
    if (!chosen.length) {
      ui.status.textContent = "Chưa chọn loại dữ liệu nào.";
      return;
    }

    ui.clearBtn.disabled = true;
    ui.status.textContent = "Đang xoá…";
    const results = {};
    for (const key of chosen) {
      const type = TYPES.find((t) => t.key === key);
      try {
        results[key] = await withTimeout(Promise.resolve(type.clear()), 30000, type.label);
      } catch (e) {
        results[key] = `lỗi: ${e.message}`;
      }
    }
    ui.clearBtn.disabled = false;

    if (ui.reload.checked) {
      ui.status.textContent = "Xong, đang tải lại trang…";
      location.reload();
      return;
    }
    ui.status.textContent = "Xong. Trang có thể tạo lại dữ liệu khi bạn tiếp tục dùng — bật “Tải lại trang” để sạch hẳn.";
    await refresh(results);
  }

  // Xoá nhanh mọi loại (trừ loại mặc định tắt) rồi tải lại, không cần mở bảng.
  async function quickClear() {
    if (!confirm(`Xoá toàn bộ dữ liệu của ${location.origin} (cookie, storage, cache…) rồi tải lại trang?`)) return;
    for (const type of TYPES) {
      if (type.defaultOff) continue;
      try {
        const c = await withTimeout(Promise.resolve(type.count()), 5000, type.label);
        if (!c.unsupported) await withTimeout(Promise.resolve(type.clear()), 30000, type.label);
      } catch (e) {
        console.warn("[Dọn Site]", type.label, e);
      }
    }
    location.reload();
  }

  GM_registerMenuCommand("🧹 Dọn dữ liệu trang này…", open);
  GM_registerMenuCommand("⚡ Xoá nhanh & tải lại", quickClear);
})();
