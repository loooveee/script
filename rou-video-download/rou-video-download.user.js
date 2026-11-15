// ==UserScript==
// @name         Rou Video Download
// @namespace    https://github.com/loooveee
// @version      1.0.1
// @description  Tải video và phim bộ trên rou.video thành file MP4 (chất lượng cao nhất), ngay trong trình duyệt.
// @author       loooveee
// @homepageURL  https://github.com/loooveee/script/tree/main/rou-video-download
// @supportURL   https://github.com/loooveee/script/issues
// @downloadURL  https://raw.githubusercontent.com/loooveee/script/main/rou-video-download/rou-video-download.user.js
// @updateURL    https://raw.githubusercontent.com/loooveee/script/main/rou-video-download/rou-video-download.user.js
// @match        *://rou.video/*
// @match        *://*.rou.video/*
// @include      /^https?:\/\/(www\.)?rouv[a-z][0-9]+\.xyz\//
// @noframes
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/mux.js@7.1.0/dist/mux.min.js#sha256=eb088a07f954554db7c38114487b21df6d1f28c4a84d53003644e962c7567b5b
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  // ===================== Cấu hình =====================

  const CONCURRENCY = 6; // Số đoạn video tải cùng lúc
  const MAX_AHEAD = 24; // Tải trước tối đa bao nhiêu đoạn so với đoạn đang ghép (giới hạn RAM)
  const RETRIES = 4;
  const SEG_TIMEOUT = 45000;

  // Cách hoạt động:
  //  1. Đọc tên, thời lượng, bộ phim và danh sách tập từ dữ liệu dựng sẵn trong trang /v/<id> hoặc /s/<id>.
  //  2. /api/hls/<id> chuyển hướng tới playlist có chữ ký trên CDN.
  //  3. Playlist và mọi đoạn video đều được gửi dưới dạng ảnh PNG: dữ liệu thật nằm trong chunk riêng "roUd"
  //     (byte đầu là cờ, bit 1 = nén zlib).
  //  4. mux.js chuyển các đoạn MPEG-TS thành MP4 (không mã hoá lại), ghi thẳng ra file.

  const muxjs = (typeof window !== "undefined" && window.muxjs) || globalThis.muxjs;

  // ===================== Dữ liệu trong ảnh PNG =====================

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ROUD = 0x726f5564; // "roUd"
  const IEND = 0x49454e44;

  async function inflate(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unwrapPng(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length < 8 || PNG_SIG.some((b, i) => u8[i] !== b)) return u8;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let p = 8;
    while (p + 8 <= u8.length) {
      const len = dv.getUint32(p), type = dv.getUint32(p + 4), start = p + 8;
      if (type === ROUD) {
        const flag = u8[start], body = u8.subarray(start + 1, start + len);
        return flag & 1 ? inflate(body) : body;
      }
      if (type === IEND) break;
      p = start + len + 4;
    }
    throw new Error("Ảnh trả về không chứa dữ liệu video");
  }

  function tsStart(u8) {
    if (u8.length > 376 && u8[0] === 0x47 && u8[188] === 0x47) return 0;
    const lim = Math.min(u8.length - 3 * 188, 65536);
    for (let i = 0; i < lim; i++) if (u8[i] === 0x47 && u8[i + 188] === 0x47 && u8[i + 376] === 0x47) return i;
    return -1;
  }

  // ===================== Playlist =====================

  function parseM3u8(text, base) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const variants = [], segments = [];
    let dur = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("#EXT-X-STREAM-INF")) {
        const res = /RESOLUTION=(\d+)x(\d+)/.exec(l), bw = /BANDWIDTH=(\d+)/.exec(l);
        const next = lines.slice(i + 1).find((x) => !x.startsWith("#"));
        if (next) variants.push({ url: new URL(next, base).href, w: res ? +res[1] : 0, h: res ? +res[2] : 0, bw: bw ? +bw[1] : 0 });
      } else if (l.startsWith("#EXTINF:")) {
        dur = parseFloat(l.slice(8)) || 0;
      } else if ((l.startsWith("#EXT-X-KEY") && !/METHOD=NONE/.test(l)) || l.startsWith("#EXT-X-MAP") || l.startsWith("#EXT-X-BYTERANGE")) {
        throw new Error("Playlist dạng đặc biệt (mã hoá / byte range), script chưa hỗ trợ");
      } else if (!l.startsWith("#")) {
        segments.push({ url: new URL(l, base).href, dur });
        dur = 0;
      }
    }
    variants.sort((a, b) => b.w * b.h - a.w * a.h || b.bw - a.bw);
    return { variants, segments, duration: segments.reduce((s, x) => s + x.dur, 0) };
  }

  function resLabel(w, h) {
    const long = Math.max(w, h), short = Math.min(w, h);
    const p = [[3800, 2100, 2160], [2500, 1400, 1440], [1900, 1000, 1080], [1260, 700, 720], [840, 470, 480], [630, 350, 360]]
      .find(([lw, sh]) => long >= lw || short >= sh);
    return `${p ? p[2] : short}p (${w}x${h})`;
  }

  // ===================== Mạng =====================

  let useGM = false; // Bật khi trình duyệt chặn CORS (tên miền phụ): chuyển sang GM_xmlhttpRequest

  function gmGet(url, signal, timeout) {
    return new Promise((resolve, reject) => {
      const req = GM_xmlhttpRequest({
        method: "GET", url, responseType: "arraybuffer", timeout,
        headers: { Referer: location.href },
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve({ data: r.response, url: r.finalUrl || url })
          : reject(new Error(`HTTP ${r.status}`))),
        onerror: () => reject(new Error("Lỗi mạng")),
        ontimeout: () => reject(new Error("Quá thời gian chờ")),
      });
      signal?.addEventListener("abort", () => { try { req.abort(); } catch (_) { /* */ } reject(abortError()); });
    });
  }

  function abortError() {
    return new DOMException("Đã huỷ", "AbortError");
  }

  async function getBytes(url, signal, timeout = SEG_TIMEOUT) {
    if (!useGM) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const r = await fetch(url, { signal: ctl.signal, credentials: "same-origin" });
        if (r.status === 401 || r.status === 403) throw httpError(r.status);
        if (!r.ok) throw httpError(r.status);
        return { data: await r.arrayBuffer(), url: r.url };
      } catch (e) {
        if (signal?.aborted) throw abortError();
        // TypeError = bị CORS chặn (thường gặp ở tên miền phụ): thử lại bằng GM_xmlhttpRequest.
        if (e instanceof TypeError && typeof GM_xmlhttpRequest === "function") useGM = true;
        else throw e.name === "AbortError" ? new Error("Quá thời gian chờ") : e;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    return gmGet(url, signal, timeout);
  }

  function httpError(status) {
    const e = new Error(status === 404 ? "Không tìm thấy (HTTP 404), có thể video đã bị gỡ"
      : status === 401 || status === 403 ? `HTTP ${status}: trang yêu cầu đăng nhập hoặc chặn truy cập`
        : `HTTP ${status}`);
    e.status = status;
    return e;
  }

  async function withRetry(fn, signal) {
    let last;
    for (let i = 0; i <= RETRIES; i++) {
      if (signal?.aborted) throw abortError();
      try {
        return await fn();
      } catch (e) {
        if (e.name === "AbortError" || e.status === 404) throw e;
        last = e;
        await sleep(1000 * (i + 1));
      }
    }
    throw last;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ===================== Đọc dữ liệu trang =====================
  // Trang chứa dữ liệu dạng đoạn JavaScript ($R[1]={id:"...",name:"...",...}), không phải JSON.

  function balanced(text, start) {
    let depth = 0, quote = null;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        if (--depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  // Văn bản của object, bỏ trống các object / mảng lồng bên trong.
  function topLevel(obj) {
    let out = "", depth = 0, quote = null;
    for (let i = 0; i < obj.length; i++) {
      const ch = obj[i];
      let keep = depth <= 1;
      if (quote) {
        if (ch === "\\") { if (keep) out += obj.slice(i, i + 2); i++; continue; }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{" || ch === "[") { depth++; keep = depth <= 1; }
      else if (ch === "}" || ch === "]") depth--;
      if (keep) out += ch;
    }
    return out;
  }

  function jsFields(obj) {
    const fields = {};
    const re = /(?<![\w$])([A-Za-z_]\w*):("(?:[^"\\]|\\.)*"|-?[\d.]+(?:e[-+]?\d+)?|null|!0|!1)/g;
    for (const m of topLevel(obj).matchAll(re)) {
      const [, key, raw] = m;
      if (key in fields) continue;
      if (raw[0] === '"') {
        try { fields[key] = JSON.parse(raw); } catch (_) { fields[key] = raw.slice(1, -1); }
      } else if (raw === "null") fields[key] = null;
      else if (raw === "!0" || raw === "!1") fields[key] = raw === "!0";
      else fields[key] = Number(raw);
    }
    return fields;
  }

  function jsObjects(page, key, open = "{") {
    const found = [];
    const re = new RegExp(`(?<![\\w$])${key}:(?:\\$R\\[\\d+\\]=)?\\${open}`, "g");
    for (const m of page.matchAll(re)) {
      const obj = balanced(page, m.index + m[0].length - 1);
      if (obj) found.push({ pos: m.index, obj });
    }
    return found;
  }

  function arrayItems(arr) {
    const items = [];
    let depth = 0, quote = null;
    for (let i = 0; i < arr.length; i++) {
      const ch = arr[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{" && depth === 1) {
        const obj = balanced(arr, i);
        if (!obj) break;
        items.push(jsFields(obj));
        i += obj.length - 1;
      } else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") depth--;
    }
    return items;
  }

  function pageTitle(page) {
    const m = /<title>([\s\S]*?)<\/title>/.exec(page);
    if (!m) return "";
    const el = document.createElement("textarea");
    el.innerHTML = m[1];
    return el.value.split(" - ").slice(0, -1).join(" - ").trim() || el.value.trim();
  }

  function seriesData(page, sid) {
    for (const { pos, obj } of jsObjects(page, "series")) {
      const f = jsFields(obj);
      if (f.id !== sid) continue;
      const series = { id: sid, name: f.name || "", total: f.totalEpisodes || f.episodeCount || 0 };
      const list = jsObjects(page, "episodes", "[").find((x) => x.pos > pos);
      const eps = (list ? arrayItems(list.obj) : []).filter((e) => e.id)
        .map((e) => ({ id: e.id, name: e.name || "", episode: e.episode, duration: e.duration || 0 }))
        .sort((a, b) => (a.episode ?? 1e9) - (b.episode ?? 1e9));
      return { series, eps };
    }
    return { series: null, eps: [] };
  }

  async function fetchPage(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw httpError(r.status);
    const page = await r.text();
    if (/cf-chl-|challenge-platform|Just a moment\.\.\./.test(page.slice(0, 20000))) {
      throw new Error("Trang đang hiện bước kiểm tra Cloudflare; hãy tải lại trang rồi thử lại");
    }
    return page;
  }

  async function readVideo(origin, vid) {
    const page = await fetchPage(`${origin}/v/${vid}`);
    const f = jsObjects(page, "video").map((x) => jsFields(x.obj)).find((x) => x.id === vid) || {};
    let { series, eps } = f.seriesId ? seriesData(page, f.seriesId) : { series: null, eps: [] };
    if (series && !eps.some((e) => e.id === vid)) eps = [];
    if (series && !series.name) series = null;
    return { id: vid, name: f.name || pageTitle(page) || vid, duration: f.duration || 0, episode: f.episode, series, eps };
  }

  async function readSeries(origin, sid) {
    const page = await fetchPage(`${origin}/s/${sid}`);
    const { series, eps } = seriesData(page, sid);
    return { series: { id: sid, name: (series && series.name) || pageTitle(page) || sid, total: series ? series.total : 0 }, eps };
  }

  // ===================== Tên file =====================

  function safeName(name) {
    name = name.replace(/[\\/*?:"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
    name = name.slice(0, 120).replace(/[. ]+$/, "");
    if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(name.split(".")[0])) name += "_";
    return name || "rou";
  }

  function episodeTitle(seriesName, ep, count) {
    if (count <= 1) return seriesName;
    return Number.isFinite(ep.episode) ? `${seriesName} E${String(ep.episode).padStart(2, "0")}` : `${seriesName} ${ep.name || ep.id}`;
  }

  // ===================== MP4 =====================
  //
  // mux.js chỉ xuất MP4 PHÂN MẢNH (moof/mdat lặp lại, dạng dùng cho phát trực tuyến). Nhiều trình phát
  // trên máy (ví dụ ứng dụng phim của Windows) chỉ phát được tiếng của loại file này. Mp4Builder gom các
  // mảnh lại thành MP4 thường như ffmpeg tạo ra: một khối mdat chứa toàn bộ dữ liệu, và moov ở cuối file
  // có bảng mẫu đầy đủ (stts, ctts, stss, stsz, stsc, stco) cùng edit list để hình và tiếng khớp nhau.

  const MP4_EPOCH = 2082844800; // giây từ 1904-01-01 tới 1970-01-01

  const fourcc = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);

  // Các box con trực tiếp trong u8[start, end): [{ type, start, size }]
  function childBoxes(u8, start, end) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p);
      if (size === 1) size = Number(dv.getBigUint64(p + 8));
      else if (size === 0) size = end - p;
      if (size < 8 || p + size > end) break;
      out.push({ type: fourcc(u8, p + 4), start: p, size });
      p += size;
    }
    return out;
  }

  function concatBytes(parts) {
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let p = 0;
    for (const x of parts) { out.set(x, p); p += x.length; }
    return out;
  }

  function box(type, ...parts) {
    const body = concatBytes(parts);
    const out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    return out;
  }

  // Full box (version + flags). fields: [[bits, value], ...], bits = 64, 32, -32 (có dấu) hoặc 16.
  function fullBox(type, version, flags, fields) {
    const size = fields.reduce((n, [bits]) => n + Math.abs(bits) / 8, 4);
    const body = new Uint8Array(size), dv = new DataView(body.buffer);
    dv.setUint32(0, ((version << 24) | flags) >>> 0);
    let p = 4;
    for (const [bits, v] of fields) {
      if (bits === 64) { dv.setBigUint64(p, BigInt(v)); p += 8; }
      else if (bits === 32) { dv.setUint32(p, v >>> 0); p += 4; }
      else if (bits === -32) { dv.setInt32(p, v); p += 4; }
      else { dv.setUint16(p, v); p += 2; }
    }
    return box(type, body);
  }

  // Mảng số nguyên tự giãn: đỡ tốn RAM hơn Array thường khi có vài trăm nghìn mẫu.
  class IntList {
    constructor(signed = false) { this.a = signed ? new Int32Array(4096) : new Uint32Array(4096); this.n = 0; }
    push(v) {
      if (this.n === this.a.length) { const b = new this.a.constructor(this.a.length * 2); b.set(this.a); this.a = b; }
      this.a[this.n++] = v;
    }
    get values() { return this.a.subarray(0, this.n); }
  }

  // Đọc thời lượng (cùng ctime/mtime) ở đúng vị trí theo version của mvhd / tkhd / mdhd.
  // Các box này có: version(1) flags(3) ctime mtime, rồi (mvhd/mdhd) timescale duration
  // hoặc (tkhd) track_ID reserved duration. ctime/mtime/duration dài 8 byte nếu version 1.
  function setTimes(raw, type, duration, now) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const v1 = raw[8] === 1, w = v1 ? 8 : 4;
    const put = (p, value) => (v1 ? dv.setBigUint64(p, BigInt(value)) : dv.setUint32(p, Math.min(value, 0xffffffff)));
    put(12, now);
    put(12 + w, now);
    put(12 + 2 * w + 4 + (type === "tkhd" ? 4 : 0), duration); // bỏ qua timescale hoặc track_ID (+ reserved)
    return raw;
  }

  class Mp4Builder {
    constructor(sink) {
      this.sink = sink;
      this.tracks = new Map(); // track_ID -> bảng mẫu đang gom
      this.pos = 0;            // số byte đã ghi ra file
      this.ready = false;
    }

    // initSegment của mux.js = ftyp + moov (chưa có mẫu). Ghi ftyp + đầu mdat, giữ moov làm khuôn.
    async start(init) {
      const u8 = new Uint8Array(init);
      const top = childBoxes(u8, 0, u8.length);
      const ftyp = top.find((b) => b.type === "ftyp"), moov = top.find((b) => b.type === "moov");
      if (!ftyp || !moov) throw new Error("mux.js không tạo được phần đầu MP4");
      this.moov = u8.slice(moov.start, moov.start + moov.size);
      const dv = new DataView(this.moov.buffer);
      for (const trak of childBoxes(this.moov, 8, this.moov.length).filter((b) => b.type === "trak")) {
        const kids = childBoxes(this.moov, trak.start + 8, trak.start + trak.size);
        const tkhd = kids.find((b) => b.type === "tkhd"), mdia = kids.find((b) => b.type === "mdia");
        const mdhd = childBoxes(this.moov, mdia.start + 8, mdia.start + mdia.size).find((b) => b.type === "mdhd");
        const id = dv.getUint32(tkhd.start + (this.moov[tkhd.start + 8] === 1 ? 28 : 20));
        this.tracks.set(id, {
          timescale: dv.getUint32(mdhd.start + (this.moov[mdhd.start + 8] === 1 ? 28 : 20)),
          sizes: new IntList(), durations: new IntList(), ctos: new IntList(true), syncs: new IntList(),
          chunks: [], // [vị trí trong file, số mẫu]
          firstDts: null, nextDts: 0, anyCto: false, allSync: true,
        });
      }
      await this.write(u8.slice(ftyp.start, ftyp.start + ftyp.size));
      // mdat dùng kích thước 64 bit (size = 1) để không giới hạn 4 GB; số thật được điền lúc xong.
      this.mdatPos = this.pos;
      await this.write(this.mdatHeader(0));
      this.ready = true;
    }

    mdatHeader(size) {
      const head = new Uint8Array(16);
      head.set([0, 0, 0, 1, 0x6d, 0x64, 0x61, 0x74]);
      new DataView(head.buffer).setBigUint64(8, BigInt(size));
      return head;
    }

    async write(u8) {
      await this.sink.write(u8);
      this.pos += u8.length;
    }

    // Một lần xuất của mux.js: các cặp moof + mdat (mỗi moof một track).
    async add(data) {
      const u8 = new Uint8Array(data), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      for (const moof of childBoxes(u8, 0, u8.length).filter((b) => b.type === "moof")) {
        for (const traf of childBoxes(u8, moof.start + 8, moof.start + moof.size).filter((b) => b.type === "traf")) {
          const kids = childBoxes(u8, traf.start + 8, traf.start + traf.size);
          const tfhd = kids.find((b) => b.type === "tfhd");
          if (!tfhd) continue;
          const tr = this.tracks.get(dv.getUint32(tfhd.start + 12));
          if (!tr) continue; // track không có trong phần đầu: bỏ qua
          const hf = dv.getUint32(tfhd.start + 8) & 0xffffff;
          let p = tfhd.start + 16, base = moof.start, defDur = 0, defSize = 0, defFlags = 0;
          if (hf & 0x1) { base = Number(dv.getBigUint64(p)); p += 8; }
          if (hf & 0x2) p += 4;
          if (hf & 0x8) { defDur = dv.getUint32(p); p += 4; }
          if (hf & 0x10) { defSize = dv.getUint32(p); p += 4; }
          if (hf & 0x20) { defFlags = dv.getUint32(p); p += 4; }

          const tfdt = kids.find((b) => b.type === "tfdt");
          if (tfdt) {
            const dts = u8[tfdt.start + 8] === 1 ? Number(dv.getBigUint64(tfdt.start + 12)) : dv.getUint32(tfdt.start + 12);
            if (tr.firstDts === null) tr.firstDts = tr.nextDts = dts;
            else if (dts !== tr.nextDts && tr.durations.n) {
              // Khoảng hở / chồng lấn giữa hai mảnh: bù vào thời lượng của mẫu ngay trước.
              const last = tr.durations.n - 1;
              tr.durations.a[last] = Math.max(1, tr.durations.a[last] + dts - tr.nextDts);
              tr.nextDts = dts;
            }
          }
          if (tr.firstDts === null) tr.firstDts = 0;

          for (const trun of kids.filter((b) => b.type === "trun")) {
            const tf = dv.getUint32(trun.start + 8) & 0xffffff;
            const count = dv.getUint32(trun.start + 12);
            let q = trun.start + 16, dataStart = base, firstFlags = null;
            if (tf & 0x1) { dataStart = base + dv.getInt32(q); q += 4; }
            if (tf & 0x4) { firstFlags = dv.getUint32(q); q += 4; }
            const next = () => { const v = dv.getUint32(q); q += 4; return v; };
            let total = 0;
            for (let i = 0; i < count; i++) {
              const dur = tf & 0x100 ? next() : defDur;
              const size = tf & 0x200 ? next() : defSize;
              let flags = tf & 0x400 ? next() : defFlags;
              if (i === 0 && firstFlags !== null) flags = firstFlags;
              const cto = tf & 0x800 ? next() | 0 : 0;
              tr.sizes.push(size);
              tr.durations.push(dur);
              tr.ctos.push(cto);
              if (cto) tr.anyCto = true;
              if (flags & 0x10000) tr.allSync = false; // sample_is_non_sync_sample
              else tr.syncs.push(tr.sizes.n);           // số thứ tự mẫu, tính từ 1
              tr.nextDts += dur;
              total += size;
            }
            if (!count) continue;
            if (dataStart < 0 || dataStart + total > u8.length) throw new Error("Dữ liệu MP4 từ mux.js bị lệch");
            tr.chunks.push([this.pos, count]);
            await this.write(u8.slice(dataStart, dataStart + total));
          }
        }
      }
    }

    // Ghi moov vào cuối file và điền kích thước mdat. Trả về tổng số byte của file.
    async finish() {
      const mdatSize = this.pos - this.mdatPos;
      await this.write(this.buildMoov(this.pos > 0xffffffff));
      await this.sink.writeAt(this.mdatPos, this.mdatHeader(mdatSize));
      return this.pos;
    }

    buildMoov(useCo64) {
      const src = this.moov, dv = new DataView(src.buffer);
      const kids = childBoxes(src, 8, src.length);
      const mvhd = kids.find((b) => b.type === "mvhd");
      const movieScale = dv.getUint32(mvhd.start + (src[mvhd.start + 8] === 1 ? 28 : 20));
      const now = Math.floor(Date.now() / 1000) + MP4_EPOCH;

      // Thời điểm hiện khung / mẫu đầu tiên của mỗi track (giây): căn hình với tiếng bằng edit list.
      const presStart = (tr) => (tr.firstDts + (tr.ctos.n ? tr.ctos.a[0] : 0)) / tr.timescale;
      const live = [...this.tracks.values()].filter((tr) => tr.sizes.n);
      if (!live.length) throw new Error("Không có dữ liệu video");
      const minStart = Math.min(...live.map(presStart));

      let movieDur = 0;
      const traks = [];
      for (const trak of kids.filter((b) => b.type === "trak")) {
        const tk = childBoxes(src, trak.start + 8, trak.start + trak.size);
        const tkhd = tk.find((b) => b.type === "tkhd");
        const tr = this.tracks.get(dv.getUint32(tkhd.start + (src[tkhd.start + 8] === 1 ? 28 : 20)));
        if (!tr || !tr.sizes.n) continue;
        let mediaDur = 0;
        for (const d of tr.durations.values) mediaDur += d;
        const trackDur = Math.round((mediaDur / tr.timescale) * movieScale);
        const delay = Math.round((presStart(tr) - minStart) * movieScale);
        movieDur = Math.max(movieDur, delay + trackDur);

        const edits = [];
        if (delay > 0) edits.push([delay, -1]);                // edit rỗng: lùi track cho khớp track kia
        edits.push([trackDur, tr.ctos.n ? tr.ctos.a[0] : 0]);    // bắt đầu từ khung hiện đầu tiên
        const edts = box("edts", fullBox("elst", 0, 0,
          [[32, edits.length], ...edits.flatMap(([d, t]) => [[32, d], [-32, t], [16, 1], [16, 0]])]));

        const parts = [];
        for (const b of tk) {
          const raw = src.slice(b.start, b.start + b.size);
          if (b.type === "tkhd") parts.push(setTimes(raw, "tkhd", delay + trackDur, now), edts);
          else if (b.type === "edts") continue;
          else if (b.type === "mdia") parts.push(this.buildMdia(raw, tr, mediaDur, now, useCo64));
          else parts.push(raw);
        }
        traks.push(box("trak", ...parts));
      }

      const out = [];
      let traksPlaced = false;
      for (const b of kids) {
        if (b.type === "mvhd") out.push(setTimes(src.slice(b.start, b.start + b.size), "mvhd", movieDur, now));
        else if (b.type === "trak") { if (!traksPlaced) { out.push(...traks); traksPlaced = true; } }
        else if (b.type === "mvex") continue; // chỉ dành cho MP4 phân mảnh
        else out.push(src.slice(b.start, b.start + b.size));
      }
      return box("moov", ...out);
    }

    buildMdia(raw, tr, mediaDur, now, useCo64) {
      const parts = [];
      for (const b of childBoxes(raw, 8, raw.length)) {
        const sub = raw.slice(b.start, b.start + b.size);
        if (b.type === "mdhd") parts.push(setTimes(sub, "mdhd", mediaDur, now));
        else if (b.type === "minf") {
          const mp = [];
          for (const c of childBoxes(sub, 8, sub.length)) {
            const cs = sub.slice(c.start, c.start + c.size);
            if (c.type !== "stbl") { mp.push(cs); continue; }
            const stsd = childBoxes(cs, 8, cs.length).find((x) => x.type === "stsd");
            mp.push(box("stbl", cs.slice(stsd.start, stsd.start + stsd.size), ...this.sampleTables(tr, useCo64)));
          }
          parts.push(box("minf", ...mp));
        } else parts.push(sub);
      }
      return box("mdia", ...parts);
    }

    sampleTables(tr, useCo64) {
      // Gộp các giá trị giống nhau liên tiếp: [[số lần, giá trị], ...]
      const runs = (values) => {
        const out = [];
        for (const v of values) {
          if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++;
          else out.push([1, v]);
        }
        return out;
      };
      const tables = [];
      const stts = runs(tr.durations.values);
      tables.push(fullBox("stts", 0, 0, [[32, stts.length], ...stts.flatMap(([c, d]) => [[32, c], [32, d]])]));
      if (tr.anyCto) {
        const negative = tr.ctos.values.some((v) => v < 0);
        const ctts = runs(tr.ctos.values);
        tables.push(fullBox("ctts", negative ? 1 : 0, 0, [[32, ctts.length], ...ctts.flatMap(([c, o]) => [[32, c], [-32, o]])]));
      }
      if (!tr.allSync) {
        tables.push(fullBox("stss", 0, 0, [[32, tr.syncs.n], ...Array.from(tr.syncs.values, (s) => [32, s])]));
      }
      // stsc: mỗi lần mux.js xuất là một chunk; gộp các chunk liên tiếp có cùng số mẫu.
      const stsc = [];
      tr.chunks.forEach(([, count], i) => {
        if (!stsc.length || stsc[stsc.length - 1][1] !== count) stsc.push([i + 1, count]);
      });
      tables.push(fullBox("stsc", 0, 0, [[32, stsc.length], ...stsc.flatMap(([first, count]) => [[32, first], [32, count], [32, 1]])]));
      tables.push(fullBox("stsz", 0, 0, [[32, 0], [32, tr.sizes.n], ...Array.from(tr.sizes.values, (s) => [32, s])]));
      tables.push(useCo64
        ? fullBox("co64", 0, 0, [[32, tr.chunks.length], ...tr.chunks.map(([off]) => [64, off])])
        : fullBox("stco", 0, 0, [[32, tr.chunks.length], ...tr.chunks.map(([off]) => [32, off])]));
      return tables;
    }
  }

  // Nơi ghi file: ghi thẳng ra đĩa (Chrome / Edge) hoặc gom trong RAM rồi tải về (trình duyệt khác).
  // writeAt() ghi đè vài byte đã ghi trước đó (kích thước mdat, điền vào khi tải xong).
  function diskSink(handle) {
    let writable;
    return {
      async open() { writable = await handle.createWritable(); },
      write: (u8) => writable.write(u8),
      writeAt: (position, u8) => writable.write({ type: "write", position, data: u8 }),
      close: () => writable.close(),
      abort: () => writable && writable.abort().catch(() => {}),
    };
  }

  function memorySink(name) {
    let parts = [], offsets = [], size = 0;
    return {
      async open() {},
      async write(u8) { parts.push(u8); offsets.push(size); size += u8.length; },
      async writeAt(position, u8) {
        // Phần cần ghi đè luôn nằm gọn trong một lần ghi trước đó (đầu mdat được ghi riêng).
        const i = offsets.findIndex((o, k) => position >= o && position + u8.length <= o + parts[k].length);
        if (i < 0) throw new Error("Không ghi đè được phần đầu file");
        parts[i] = parts[i].slice();
        parts[i].set(u8, position - offsets[i]);
      },
      async close() {
        const url = URL.createObjectURL(new Blob(parts, { type: "video/mp4" }));
        parts = []; offsets = [];
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      },
      async abort() { parts = []; offsets = []; },
    };
  }

  // Tải một video: lấy playlist, tải các đoạn song song, ghép theo thứ tự rồi ghi ra `sink`.
  async function downloadVideo(origin, vid, sink, signal, onProgress) {
    let { data, url } = await withRetry(() => getBytes(`${origin}/api/hls/${vid}`, signal), signal);
    let pl = parseM3u8(new TextDecoder().decode(await unwrapPng(data)), url);
    let quality = "";
    if (pl.variants.length) {
      const best = pl.variants[0];
      quality = best.h ? `${resLabel(best.w, best.h)} · cao nhất trong ${pl.variants.length} bản` : "";
      ({ data, url } = await withRetry(() => getBytes(best.url, signal), signal));
      pl = parseM3u8(new TextDecoder().decode(await unwrapPng(data)), url);
    }
    const segs = pl.segments;
    if (!segs.length) throw new Error("Playlist không có đoạn video nào");

    const tm = new muxjs.mp4.Transmuxer({ remux: true });
    const mp4 = new Mp4Builder(sink);
    let out = [], init = null;
    tm.on("data", (seg) => {
      if (!init) {
        init = new Uint8Array(seg.initSegment);
        if (!quality && seg.info && seg.info.width) quality = resLabel(seg.info.width, seg.info.height);
      }
      out.push(new Uint8Array(seg.data));
    });

    // Huỷ riêng cho video này: một đoạn lỗi hẳn thì dừng luôn các luồng tải còn lại,
    // không để chúng chạy tiếp sang lúc tải tập sau.
    const inner = new AbortController();
    const onOuterAbort = () => inner.abort();
    signal.addEventListener("abort", onOuterAbort);
    const stop = inner.signal;

    await sink.open();
    const results = new Array(segs.length);
    const sizes = new Array(segs.length);
    const started = performance.now();
    let next = 0, fed = 0, bytes = 0, fedBytes = 0, written = 0, feeding = Promise.resolve();
    const samples = [];

    const report = () => {
      const now = performance.now();
      samples.push([now, bytes]);
      while (samples.length > 1 && now - samples[0][0] > 5000) samples.shift();
      const dt = (now - samples[0][0]) / 1000;
      const speed = dt > 0.5 ? (bytes - samples[0][1]) / dt : 0;
      onProgress({ done: fed, total: segs.length, bytes, fedBytes, written, speed, quality, elapsed: (now - started) / 1000 });
    };

    // Ghép các đoạn đã tải theo đúng thứ tự.
    const feed = () => (feeding = feeding.then(async () => {
      while (fed < segs.length && results[fed]) {
        tm.push(results[fed]);
        tm.flush();
        results[fed] = null;
        fedBytes += sizes[fed];
        fed++;
        const pieces = out;
        out = [];
        if (pieces.length && !mp4.ready) await mp4.start(init);
        for (const p of pieces) await mp4.add(p);
        written = mp4.pos;
        report();
      }
    }));

    const worker = async () => {
      while (true) {
        if (stop.aborted) throw abortError();
        const i = next++;
        if (i >= segs.length) return;
        while (i - fed > MAX_AHEAD) {
          if (stop.aborted) throw abortError();
          await sleep(100);
        }
        const ts = await withRetry(async () => {
          const r = await getBytes(segs[i].url, stop);
          const raw = await unwrapPng(r.data);
          const start = tsStart(raw);
          if (start < 0) throw new Error(`Đoạn ${i + 1} không phải video`);
          bytes += r.data.byteLength;
          sizes[i] = r.data.byteLength;
          return start ? raw.subarray(start) : raw;
        }, stop);
        if (stop.aborted) throw abortError();
        results[i] = ts;
        await feed();
      }
    };

    try {
      const runs = Array.from({ length: Math.min(CONCURRENCY, segs.length) },
        () => worker().catch((e) => { inner.abort(); throw e; }));
      // Chờ MỌI luồng dừng hẳn (allSettled) rồi mới báo lỗi, để không còn luồng nào chạy ngầm.
      const settled = await Promise.allSettled(runs);
      if (signal.aborted) throw abortError();
      const failure = settled.find((r) => r.status === "rejected" && r.reason?.name !== "AbortError")
        || settled.find((r) => r.status === "rejected");
      if (failure) throw failure.reason;
      await feed();
      if (fed !== segs.length) throw new Error(`Thiếu ${segs.length - fed} đoạn video`);
      if (!mp4.ready) throw new Error("mux.js không tạo được MP4 từ video này");
      written = await mp4.finish();
      await sink.close();
    } catch (e) {
      inner.abort();
      await feeding.catch(() => {});
      await sink.abort();
      throw e;
    } finally {
      signal.removeEventListener("abort", onOuterAbort);
    }
    return { size: written, quality, duration: pl.duration };
  }

  // ===================== Giao diện =====================

  const CSS = `
    :host { all: initial; }
    .box { position: fixed; top: 16px; right: 16px; z-index: 2147483647; width: 380px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: #16171c; color: #e8e8ea;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; border: 1px solid #2c2e36;
      border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.45); overflow: hidden; }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2c2e36; }
    header b { flex: 1; font-size: 14px; }
    button { font: inherit; color: inherit; background: #2a2c34; border: 1px solid #3a3d47; border-radius: 8px;
      padding: 6px 12px; cursor: pointer; }
    button:hover:not(:disabled) { background: #343743; }
    button:disabled { opacity: .5; cursor: default; }
    button.primary { background: #e0457b; border-color: #e0457b; color: #fff; font-weight: 600; }
    button.primary:hover:not(:disabled) { background: #ea5a8c; }
    button.x { padding: 2px 8px; background: none; border: none; font-size: 18px; line-height: 1; color: #9a9ca5; }
    .body { padding: 12px; overflow: auto; display: grid; gap: 10px; }
    .title { font-weight: 600; font-size: 14px; word-break: break-word; }
    .muted { color: #9a9ca5; }
    .eps { display: grid; gap: 2px; max-height: 220px; overflow: auto; border: 1px solid #2c2e36; border-radius: 8px; padding: 4px; }
    .eps label { display: flex; gap: 8px; align-items: center; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
    .eps label:hover { background: #20222a; }
    .eps label span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .row .grow { flex: 1; }
    .bar { height: 8px; background: #2a2c34; border-radius: 4px; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; background: #e0457b; transition: width .2s; }
    .bar.ok i { background: #3fb67a; }
    .log { display: grid; gap: 4px; font-size: 12px; }
    .ok { color: #3fb67a; } .err { color: #ff6b6b; } .warn { color: #f0b54a; }
    .note { font-size: 12px; color: #9a9ca5; }
  `;

  let host = null;

  function fmtBytes(n) {
    if (!n && n !== 0) return "?";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return i ? `${n.toFixed(1)} ${u[i]}` : `${n} B`;
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return "--:--";
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m).padStart(2, "0")) + ":" + String(sec).padStart(2, "0");
  }

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid);
    return e;
  }

  function parseLocation() {
    const m = /^\/(v|s)\/([A-Za-z0-9_-]{6,64})\/?$/.exec(location.pathname);
    return m ? { kind: m[1], id: m[2] } : null;
  }

  function closePanel() {
    if (host && host.busy && !confirm("Đang tải. Huỷ tải và đóng?")) return;
    if (host) {
      host.ctl?.abort();
      host.remove();
      host = null;
    }
  }

  async function openPanel() {
    if (host) closePanel();
    if (host) return;
    host = el("div");
    const root = host.attachShadow({ mode: "open" });
    root.append(el("style", {}, CSS));
    const body = el("div", { class: "body" }, el("div", { class: "muted" }, "Đang đọc trang..."));
    root.append(el("div", { class: "box" },
      el("header", {}, el("b", {}, "Rou Video Download"), el("button", { class: "x", title: "Đóng", onclick: closePanel }, "×")),
      body));
    document.documentElement.append(host);

    if (!muxjs || !muxjs.mp4) {
      body.replaceChildren(el("div", { class: "err" }, "Không nạp được thư viện mux.js (@require). Hãy cài lại script."));
      return;
    }
    const where = parseLocation();
    if (!where) {
      body.replaceChildren(el("div", {}, "Hãy mở trang một video (", el("b", {}, "/v/..."), ") hoặc một bộ phim (",
        el("b", {}, "/s/..."), ") rồi chọn lại lệnh này."));
      return;
    }

    let info;
    try {
      info = where.kind === "v" ? await readVideo(location.origin, where.id) : await readSeries(location.origin, where.id);
    } catch (e) {
      if (host) body.replaceChildren(el("div", { class: "err" }, "Không đọc được trang: " + e.message));
      return;
    }
    if (!host) return;
    renderChoice(body, where, info);
  }

  function renderChoice(body, where, info) {
    const { series, eps } = info;
    const isSeries = series && eps.length > 1;
    const items = isSeries
      ? eps.map((ep) => ({ id: ep.id, title: episodeTitle(series.name, ep, eps.length), label: ep.name, duration: ep.duration, folder: series.name }))
      : [{ id: info.id || (eps[0] && eps[0].id), title: series ? series.name : info.name, label: info.name, duration: info.duration || (eps[0] && eps[0].duration) }];
    if (!items[0].id) {
      body.replaceChildren(el("div", { class: "err" }, "Bộ phim này không có tập nào."));
      return;
    }

    const head = el("div", {},
      el("div", { class: "title" }, isSeries ? series.name : info.name),
      el("div", { class: "muted" }, isSeries ? `${eps.length} tập` + (series.total > eps.length ? ` (trang liệt kê ${eps.length}/${series.total})` : "")
        : fmtTime(items[0].duration)));

    const boxes = [];
    let list = null;
    if (isSeries) {
      list = el("div", { class: "eps" }, items.map((it) => {
        const cb = el("input", { type: "checkbox" });
        cb.checked = where.kind === "s" || it.id === info.id;
        boxes.push(cb);
        return el("label", {}, cb, el("span", { title: it.label }, it.label), el("small", { class: "muted" }, fmtTime(it.duration)));
      }));
    }
    const count = () => (isSeries ? boxes.filter((b) => b.checked).length : 1);
    const canDisk = typeof window.showSaveFilePicker === "function";
    const note = el("div", { class: "note" });
    const go = el("button", { class: "primary" });
    const setGo = () => {
      const n = count();
      go.textContent = n > 1 ? `Tải ${n} tập (MP4)` : "Tải MP4";
      go.disabled = n === 0;
      note.textContent = canDisk
        ? (n > 1 ? "Chọn một thư mục, các tập được ghi thẳng ra đĩa trong lúc tải."
          : "Chọn nơi lưu, file được ghi thẳng ra đĩa trong lúc tải.")
        : "Trình duyệt này không ghi thẳng ra đĩa được: video được giữ trong RAM rồi mới lưu, video rất dài có thể tốn nhiều RAM."
          + (n > 1 ? " Mỗi tập là một lượt tải về riêng: nếu trình duyệt hỏi có cho trang tải nhiều file không, hãy chọn Cho phép, nếu không các tập sau sẽ bị chặn." : "");
    };
    boxes.forEach((b) => b.addEventListener("change", setGo));
    setGo();

    const tools = isSeries ? el("div", { class: "row" },
      el("button", { onclick: () => { boxes.forEach((b) => (b.checked = true)); setGo(); } }, "Chọn hết"),
      el("button", { onclick: () => { boxes.forEach((b) => (b.checked = false)); setGo(); } }, "Bỏ chọn")) : null;

    go.addEventListener("click", () => {
      const picked = isSeries ? items.filter((_, i) => boxes[i].checked) : items;
      startDownload(body, picked, canDisk);
    });
    body.replaceChildren(...[head, list, tools, el("div", { class: "row" }, go), note].filter(Boolean));
  }

  // Gọi ngay trong sự kiện bấm nút: hộp thoại chọn nơi lưu chỉ mở được khi người dùng vừa bấm.
  function startDownload(body, picked, canDisk) {
    let target;
    if (canDisk) {
      target = picked.length > 1
        ? window.showDirectoryPicker({ id: "rou-video-download", mode: "readwrite" }).then((dir) => ({ dir }))
        : window.showSaveFilePicker({
          id: "rou-video-download",
          suggestedName: safeName(picked[0].title) + ".mp4",
          types: [{ description: "Video MP4", accept: { "video/mp4": [".mp4"] } }],
        }).then((file) => ({ file }));
    } else target = Promise.resolve({});
    target.then((t) => runQueue(body, picked, t), (e) => {
      if (e && e.name === "AbortError") return; // Người dùng bấm Huỷ ở hộp thoại
      runQueue(body, picked, {}); // Không mở được hộp thoại: lưu bằng cách tải về thông thường
    });
  }

  async function runQueue(body, picked, target) {
    if (!host) return;
    const ctl = new AbortController();
    host.ctl = ctl;
    host.busy = true;

    const title = el("div", { class: "title" });
    const bar = el("div", { class: "bar" }, el("i"));
    const stat = el("div", { class: "muted" });
    const total = picked.length > 1 ? el("div", { class: "muted" }) : null;
    const log = el("div", { class: "log" });
    const cancel = el("button", { onclick: () => ctl.abort() }, "Huỷ");
    body.replaceChildren(...[title, bar, stat, total, el("div", { class: "row" }, cancel), log].filter(Boolean));

    let ok = 0;
    const failed = [];
    for (let n = 0; n < picked.length && !ctl.signal.aborted; n++) {
      const it = picked[n];
      const name = safeName(it.title) + ".mp4";
      title.textContent = it.title;
      bar.className = "bar";
      bar.firstChild.style.width = "0";
      stat.textContent = "Đang lấy link...";
      if (total) total.textContent = `Tập ${n + 1}/${picked.length} · xong ${ok}` + (failed.length ? ` · lỗi ${failed.length}` : "");
      try {
        let sink;
        if (target.file) sink = diskSink(target.file);
        else if (target.dir) {
          let exists = false;
          try { exists = (await (await target.dir.getFileHandle(name)).getFile()).size > 0; } catch (_) { /* chưa có */ }
          if (exists) {
            log.append(el("div", { class: "muted" }, `= ${name}: đã có, bỏ qua`));
            ok++;
            continue;
          }
          sink = diskSink(await target.dir.getFileHandle(name + ".part", { create: true }));
        } else sink = memorySink(name);

        const res = await downloadVideo(location.origin, it.id, sink, ctl.signal, (p) => {
          bar.firstChild.style.width = `${(100 * p.done) / p.total}%`;
          // Ước tính theo các đoạn ĐÃ GHÉP (liên tục từ đầu), không theo đoạn tải trước không theo thứ tự.
          const est = p.done ? Math.max((p.fedBytes / p.done) * p.total, p.bytes) : 0;
          const eta = p.speed && est ? (est - p.bytes) / p.speed : NaN;
          stat.textContent = [p.quality, `${((100 * p.done) / p.total).toFixed(1)}%`,
            `${fmtBytes(p.bytes)}${est ? " / ~" + fmtBytes(est) : ""}`, p.speed ? `${fmtBytes(p.speed)}/s` : null,
            `còn ${fmtTime(eta)}`].filter(Boolean).join(" · ");
        });
        if (target.dir) await renameEntry(target.dir, name + ".part", name);
        ok++;
        bar.className = "bar ok";
        bar.firstChild.style.width = "100%";
        log.append(el("div", { class: "ok" }, `✓ ${name} · ${fmtBytes(res.size)}` + (res.quality ? ` · ${res.quality}` : "")));
      } catch (e) {
        if (e.name === "AbortError") break;
        failed.push(it);
        log.append(el("div", { class: "err" }, `✗ ${it.title}: ${e.message}`));
        if (target.dir) target.dir.removeEntry(name + ".part").catch(() => {});
      }
    }

    host && (host.busy = false);
    cancel.remove();
    if (total) total.textContent = "";
    if (ctl.signal.aborted) {
      stat.innerHTML = "";
      stat.append(el("span", { class: "warn" }, "Đã huỷ."));
      return;
    }
    title.textContent = failed.length ? `Xong ${ok}/${picked.length}, lỗi ${failed.length}` : `Xong ${ok}/${picked.length}`;
    title.className = "title " + (failed.length ? "err" : "ok");
    stat.textContent = target.file || target.dir ? "Đã lưu vào thư mục bạn chọn."
      : "Đã lưu vào thư mục tải về của trình duyệt.";
    if (failed.length) {
      body.append(el("div", { class: "row" }, el("button", { class: "primary", onclick: () => startDownload(body, failed, !!(target.file || target.dir)) },
        `Thử lại ${failed.length} video lỗi`)));
    }
  }

  // Đổi tên "<tên>.mp4.part" thành "<tên>.mp4" khi tải xong (move() có từ Chrome 110; không có thì chép lại).
  async function renameEntry(dir, from, to) {
    const h = await dir.getFileHandle(from);
    if (typeof h.move === "function") {
      try { await h.move(to); return; } catch (_) { /* chép lại bên dưới */ }
    }
    const dest = await (await dir.getFileHandle(to, { create: true })).createWritable();
    await (await h.getFile()).stream().pipeTo(dest);
    await dir.removeEntry(from);
  }

  window.addEventListener("beforeunload", (e) => {
    if (host && host.busy) { e.preventDefault(); e.returnValue = ""; }
  });

  GM_registerMenuCommand("Tải video này (MP4)", openPanel);
})();
