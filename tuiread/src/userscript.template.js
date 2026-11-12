// ==UserScript==
// @name         TuiRead (userscript)
// @namespace    https://github.com/loooveee
// @version      @@VERSION@@
// @description  Đọc raw truyện tiếng Trung: convert sang tiếng Việt ngay trên trang theo từ điển VietPhrase. Bản userscript của extension TuiRead.
// @author       loooveee (bản userscript); engine và từ điển: ppptran/tuiread, memories169/tuiread-firefox
// @homepageURL  https://github.com/loooveee/script/tree/main/tuiread
// @supportURL   https://github.com/loooveee/script/issues
// @downloadURL  https://raw.githubusercontent.com/loooveee/script/main/tuiread/tuiread.user.js
// @updateURL    https://raw.githubusercontent.com/loooveee/script/main/tuiread/tuiread.user.js
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addValueChangeListener
// @connect      raw.githubusercontent.com
// @connect      *
// ==/UserScript==

// FILE NÀY DO build.mjs SINH RA — sửa src/userscript.template.js rồi build lại.
//
// Khác extension gốc ở đâu:
//   - Không có background/offscreen: engine chạy trong Web Worker của chính tab đang đọc
//     (trang chặn Worker thì chạy thẳng trên trang). Mỗi tab giữ một bản từ điển trong RAM.
//   - Từ điển (~45MB) không nằm trong script: tải một lần từ GitHub rồi lưu IndexedDB
//     của TỪNG site truyện.
//   - chrome.storage -> GM_setValue/GM_getValue (dùng chung cho mọi site).
//   - Popup + trang Options -> bảng "Tùy chọn TuiRead" (menu của Violentmonkey/Tampermonkey
//     hoặc nút tròn góc dưới trái).
//   - "Thêm site" -> script khớp mọi trang nhưng chỉ chạy trên site trong danh sách;
//     trang khác chỉ có một mục menu "bật trên site này".

(function () {
'use strict';

const SCRIPT_VERSION = '@@VERSION@@';
const DICT_REF = '@@DICT_REF@@';
const DEFAULT_DICT_BASE = 'https://raw.githubusercontent.com/memories169/tuiread-firefox/' + DICT_REF + '/dict/';
const BUILTIN_SITES = ['uukanshu.cc', 'piaotia.com'];
const DEFAULT_SITE_SELECTORS = {
  'uukanshu.cc': '.readcotent, #content, article',
  'piaotia.com': '#content, .content, td.tbd, #booktext'
};
const ENGINE_KEYS = ['firstMeaning', 'skipParticles', 'useRules', 'useNames'];
const CONTENT_CSS = "@@CSS@@";

// ============================================================ ENGINE
// Hàm tự chứa: được gọi thẳng (chế độ inline) hoặc .toString() rồi chạy trong Worker.
// host = { ask(message) -> Promise, getFile(tên file từ điển) -> Promise<ArrayBuffer> }
function tuireadEngineFactory(host) {
  'use strict';
  let __listener = null;
  // Giả lập phần chrome.* mà offscreen.js dùng.
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(message, cb) { host.ask(message).then(r => { if (cb) cb(r); }, () => { if (cb) cb(null); }); },
      getURL: path => path,
      onMessage: { addListener(fn) { __listener = fn; } }
    }
  };
  const fetch = async url => {
    const buffer = await host.getFile(String(url).replace(/^dict\//, ''));
    return { ok: true, status: 200, arrayBuffer: async () => buffer };
  };

/*@@ENGINE@@*/

  // ---- phần thêm của bản userscript ----
  // Ngữ cảnh key cache đặt SỚM (không cần nạp 45MB từ điển): chương đã dịch — hoặc đã được
  // dịch trước từ chương liền trước — hiện tiếng Việt ngay, engine chỉ nạp khi có cache miss.
  let earlyCtx = null;
  function ensureKeyContext() {
    if (engine) return Promise.resolve();
    if (!earlyCtx) {
      earlyCtx = (async () => {
        let text = '';
        try { text = decode(await host.getFile(FILES.supplement)); } catch { /* file tùy chọn */ }
        const { settings, store } = await fetchSettings();
        if (engine) return;   // rebuild đã tự đặt ngữ cảnh trong lúc chờ
        supplementHash = fnv1a(text);
        if (store) {
          overridesVersion = store.overridesVersion || 0;
          glossariesVersion = store.glossariesVersion || 0;
          userRulesVersion = store.userRulesVersion || 0;
        }
        setKeyContext(cacheContextParts(settings));
      })().catch(() => {});
    }
    return earlyCtx;
  }

  async function translateFromCache(msg) {
    await ensureKeyContext();
    if (engine) return null;
    const texts = msg.texts || [];
    const hits = await cacheGet(texts.map(makeKey));
    for (let i = 0; i < texts.length; i++) if (!hits[i]) return null;
    return { ok: true, build: ENGINE_BUILD, results: hits.map(hit => hit.vi), stats: { hits: texts.length, misses: 0 } };
  }

  function dispatch(msg) {
    return new Promise(resolve => {
      let keep = false;
      try { keep = __listener(msg, {}, resolve); } catch (err) { resolve({ ok: false, error: String(err && err.message || err) }); return; }
      if (!keep) resolve(undefined);
    });
  }

  async function handle(msg) {
    if (!msg || !msg.type) return undefined;
    if (msg.type === 'vp:engine-state') return { ok: true, booted: !!engine };
    if (msg.type === 'vp:ctx-reset') { earlyCtx = null; return { ok: true }; }
    if (msg.type === 'vp:translate' && !engine) {
      const cached = await translateFromCache(msg);
      if (cached) return cached;
    }
    return dispatch(msg);
  }

  return { handle };
}

// Chạy trong Worker: nối factory với trang qua postMessage.
function tuireadWorkerMain(factory, dictBase) {
  // Đọc thẳng file từ điển đã lưu trong IndexedDB ngay trong Worker: luồng chính của trang
  // không phải đụng tới 45MB. Chưa có (lần đầu) thì mới nhờ trang tải về.
  const readLocal = name => new Promise(resolve => {
    try {
      const open = indexedDB.open('tuiread-userscript-dict', 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('files')) open.result.createObjectStore('files'); };
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        try {
          const get = db.transaction('files', 'readonly').objectStore('files').get(dictBase + name);
          get.onsuccess = () => { db.close(); resolve(get.result && get.result.byteLength ? get.result : null); };
          get.onerror = () => { db.close(); resolve(null); };
        } catch { db.close(); resolve(null); }
      };
    } catch { resolve(null); }
  });
  const pending = new Map();
  let seq = 0;
  const rpc = (t, payload) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    self.postMessage(Object.assign({ t, id }, payload));
  });
  const eng = factory({ ask: msg => rpc('ask', { msg }), getFile: async name => (await readLocal(name)) || rpc('file', { name }) });
  self.onmessage = ev => {
    const d = ev.data;
    if (d.t === 'ans') {
      const p = pending.get(d.id);
      pending.delete(d.id);
      if (p) { if (d.err) p.reject(new Error(d.err)); else p.resolve(d.r); }
    } else if (d.t === 'req') {
      eng.handle(d.msg).then(
        r => self.postMessage({ t: 'res', id: d.id, r }),
        e => self.postMessage({ t: 'res', id: d.id, r: { ok: false, error: String(e && e.message || e) } })
      );
    }
  };
  self.postMessage({ t: 'ready' });
}

// ============================================================ LƯU TRỮ (thay background.js)
function gmGet(key, fallback) {
  try { const v = GM_getValue(key); return v === undefined || v === null ? fallback : v; } catch { return fallback; }
}
function gmSet(key, value) { GM_setValue(key, value); }

const HOST = location.hostname.replace(/^www\./, '');
function addedSites() { const list = gmGet('addedSites', []); return Array.isArray(list) ? list : []; }
function siteAllowed(host) {
  return [...BUILTIN_SITES, ...addedSites()].some(s => host === s || host.endsWith('.' + s));
}

function readStore() {
  return {
    settings: gmGet('settings', {}),
    hostState: gmGet('hostState', {}),
    overrides: gmGet('overrides', {}),
    overridesVersion: gmGet('overridesVersion', 0),
    siteSelectors: gmGet('siteSelectors', DEFAULT_SITE_SELECTORS),
    glossaries: gmGet('glossaries', {}),
    glossariesVersion: gmGet('glossariesVersion', 0),
    userRules: gmGet('userRules', {}),
    userRulesVersion: gmGet('userRulesVersion', 0),
    ovUrl: gmGet('ovUrl', '')
  };
}

function entriesToMap(entries) {
  const map = {};
  for (const entry of entries || []) {
    const han = String((entry && entry.han) || '').trim();
    const vi = String(entry && entry.vi != null ? entry.vi : '').trim();
    if (han && vi) map[han] = vi;
  }
  return map;
}

let engineClient = null;
let engineWorker = null;
let engineMode = '';       // 'worker' | 'inline'
let lastStatus = null;
let inflight = 0;          // mọi yêu cầu đang chờ engine
let fgInflight = 0;        // trừ các yêu cầu chạy ngầm (dịch trước chương kế)
let idleTimer = null;

async function pushEngine(msg) {
  if (!engineClient) return null;   // engine chưa tạo: lần nạp sau tự đọc store mới
  try { return await engineClient.handle(msg); } catch { return null; }
}

function writeOverrides(map) {
  const version = gmGet('overridesVersion', 0) + 1;
  gmSet('overrides', map);
  gmSet('overridesVersion', version);
  return pushEngine({ type: 'vp:overrides', overrides: map, version }).then(r => ({ version, pushed: !!(r && r.ok) }));
}
function writeGlossaries(all) {
  const version = gmGet('glossariesVersion', 0) + 1;
  gmSet('glossaries', all);
  gmSet('glossariesVersion', version);
  return pushEngine({ type: 'vp:glossaries', version }).then(() => ({ version }));
}

async function bgHandle(msg) {
  const type = msg && msg.type;
  if (type === 'vp:ensure') return { ok: true };
  if (type === 'vp:get-settings') return { ok: true, ...readStore() };
  if (type === 'vp:status-push') { onEngineStatus(msg.status || {}); return { ok: true }; }

  if (type === 'vp:set') {
    const patch = msg.patch || {};
    const before = gmGet('settings', {});
    for (const [key, value] of Object.entries(patch)) gmSet(key, value);
    if ('settings' in patch) {
      const after = patch.settings || {};
      const engineChanged = ENGINE_KEYS.some(k => String(before[k] === undefined ? '' : before[k]) !== String(after[k] === undefined ? '' : after[k]));
      if (engineChanged) {
        // Chờ engine dựng lại xong (nếu đã nạp) để lần "dịch lại" ngay sau không dính engine cũ.
        const state = await pushEngine({ type: 'vp:engine-state' });
        if (state && state.booted) await pushEngine({ type: 'vp:rebuild', reason: 'settings' });
        else await pushEngine({ type: 'vp:ctx-reset' });
      } else {
        await pushEngine({ type: 'vp:settings', settings: after });
      }
    }
    return { ok: true };
  }

  if (type === 'vp:override-set') {
    const han = String(msg.han || '').trim();
    if (!han) return { ok: false, error: 'thiếu chữ Hán' };
    const map = { ...gmGet('overrides', {}) };
    const vi = String(msg.vi == null ? '' : msg.vi).trim();
    if (vi) map[han] = vi; else delete map[han];
    const { version, pushed } = await writeOverrides(map);
    return { ok: true, overrides: map, version, pushed };
  }
  if (type === 'vp:override-replace') {
    const map = entriesToMap(msg.entries);
    const { version, pushed } = await writeOverrides(map);
    return { ok: true, overrides: map, version, pushed };
  }

  if (type === 'vp:userrules-replace') {
    const map = entriesToMap(msg.entries);
    const version = gmGet('userRulesVersion', 0) + 1;
    gmSet('userRules', map);
    gmSet('userRulesVersion', version);
    await pushEngine({ type: 'vp:user-rules', version });
    return { ok: true, userRules: map, version };
  }

  if (type === 'vp:glossary-set' || type === 'vp:glossary-replace') {
    const bookKey = String(msg.bookKey || '').trim();
    if (!bookKey) return { ok: false, error: 'thiếu bookKey' };
    const all = { ...gmGet('glossaries', {}) };
    let book;
    if (type === 'vp:glossary-set') {
      const han = String(msg.han || '').trim();
      if (!han) return { ok: false, error: 'thiếu chữ Hán' };
      book = { ...(all[bookKey] || {}) };
      const vi = String(msg.vi == null ? '' : msg.vi).trim();
      if (vi) book[han] = vi; else delete book[han];
      all[bookKey] = book;
    } else {
      book = entriesToMap(msg.entries);
      if (Object.keys(book).length) all[bookKey] = book; else delete all[bookKey];
    }
    const { version } = await writeGlossaries(all);
    return { ok: true, glossary: book, version };
  }

  return null;
}

// ============================================================ CHIP TRẠNG THÁI
// Dùng chung phần tử #vp-status-chip với content.js; chỉ gỡ khi chữ trên chip là của mình.
let myChipText = '';
function setChip(text) {
  let chip = document.getElementById('vp-status-chip');
  if (!text) {
    if (chip && chip.textContent === myChipText) chip.remove();
    myChipText = '';
    return;
  }
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'vp-status-chip';
    chip.className = 'vp-status-chip';
    (document.body || document.documentElement).appendChild(chip);
  }
  chip.textContent = myChipText = text;
}

function onEngineStatus(status) {
  lastStatus = status;
  // Engine đang nạp chỉ để dịch trước chương kế: không làm phiền người đang đọc.
  if (!fgInflight && status.state !== 'ready') { setChip(''); return; }
  if (status.state === 'loading') {
    setChip('TuiRead: ' + status.message + (typeof status.progress === 'number' ? ' — ' + Math.round(status.progress * 100) + '%' : ''));
  } else if (status.state === 'error') {
    setChip('TuiRead: ' + status.message);
  } else {
    setChip('');
    if (status.state === 'ready') pruneDictFiles();
  }
}

// ============================================================ FILE TỪ ĐIỂN (tải + IndexedDB)
function dictBase() {
  let base = String(gmGet('dictBase', '') || DEFAULT_DICT_BASE);
  if (!base.endsWith('/')) base += '/';
  return base;
}

let dictDbPromise = null;
function dictDb() {
  if (!dictDbPromise) {
    dictDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('tuiread-userscript-dict', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('không mở được IndexedDB'));
    });
  }
  return dictDbPromise;
}
function dictStore(mode, work) {
  return dictDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = work(tx.objectStore('files'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('IndexedDB lỗi'));
  }));
}

function gmDownload(url, onProgress) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET', url, responseType: 'arraybuffer',
      onprogress: e => { if (onProgress && e && e.loaded) onProgress(e.loaded); },
      onload: r => (r.status >= 200 && r.status < 300 && r.response ? resolve(r.response) : reject(new Error('HTTP ' + r.status))),
      onerror: () => reject(new Error('lỗi mạng')),
      ontimeout: () => reject(new Error('hết thời gian chờ'))
    });
  });
}

async function download(url, name) {
  let last = 0;
  const progress = loaded => {
    const now = Date.now();
    if (now - last < 250) return;
    last = now;
    setChip('TuiRead: đang tải từ điển lần đầu — ' + name + ' ' + (loaded / 1048576).toFixed(1) + ' MB');
  };
  let httpError = null;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) { httpError = new Error('HTTP ' + res.status); throw httpError; }
    if (!res.body || !res.body.getReader) return await res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      progress(total);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out.buffer;
  } catch (err) {
    if (httpError) throw httpError;          // 404 thật: GM_xmlhttpRequest cũng sẽ 404
    return gmDownload(url, progress);        // fetch bị CSP/CORS của trang chặn
  }
}

async function loadDictFile(name) {
  const key = dictBase() + name;
  try {
    const cached = await dictStore('readonly', store => store.get(key));
    if (cached && cached.byteLength) return cached;
  } catch { /* IndexedDB hỏng (chế độ riêng tư…): tải thẳng, không lưu */ }
  const buffer = await download(key, name);
  try { await dictStore('readwrite', store => store.put(buffer, key)); } catch { /* không lưu được thì lần sau tải lại */ }
  return buffer;
}

// Hai yêu cầu cùng một file xếp hàng nối nhau (buffer được CHUYỂN sang Worker nên không dùng chung được).
const fileQueue = new Map();
function getFile(name) {
  const run = (fileQueue.get(name) || Promise.resolve()).then(() => loadDictFile(name));
  fileQueue.set(name, run.catch(() => {}));
  return run;
}

// Sau khi engine sẵn sàng: xoá file của bản từ điển cũ (DICT_REF/dictBase khác) cho đỡ tốn chỗ.
let pruned = false;
function pruneDictFiles() {
  if (pruned) return;
  pruned = true;
  const base = dictBase();
  dictStore('readwrite', store => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (!String(cursor.key).startsWith(base)) cursor.delete();
      cursor.continue();
    };
    return null;
  }).catch(() => {});
}

// ============================================================ KHỞI TẠO ENGINE (Worker, không được thì inline)
function workerBlocked(set) {
  try {
    if (set) sessionStorage.setItem('tuiread-worker-blocked', '1');
    return sessionStorage.getItem('tuiread-worker-blocked') === '1';
  } catch { return false; }
}

function createWorkerEngine(onDead) {
  return new Promise((resolve, reject) => {
    if (gmGet('noWorker', false) || typeof Worker === 'undefined' || workerBlocked()) { reject(new Error('không dùng Worker')); return; }
    const source = 'const factory = ' + tuireadEngineFactory.toString() + ';\n(' + tuireadWorkerMain.toString() + ')(factory, ' + JSON.stringify(dictBase()) + ');';
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    let worker;
    try { worker = new Worker(url); } catch (err) { URL.revokeObjectURL(url); reject(err); return; }
    const pending = new Map();
    let seq = 0;
    let ready = false;
    const giveUp = err => {
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* đã chết */ }
      if (!ready) {
        URL.revokeObjectURL(url);
        workerBlocked(true);   // các chương sau trong tab này khỏi thử lại (đỡ chờ 5s)
        reject(err);
        return;
      }
      // Worker chết giữa chừng (hết RAM…): trả lời mọi yêu cầu đang treo, lần sau tạo engine mới.
      for (const res of pending.values()) res({ ok: false, error: 'engine dừng đột ngột: ' + err.message });
      pending.clear();
      onDead(worker);
    };
    const timer = setTimeout(() => { if (!ready) giveUp(new Error('Worker không khởi động (CSP của trang?)')); }, 5000);
    worker.onerror = e => giveUp(new Error((e && e.message) || 'Worker lỗi'));
    worker.onmessage = async ev => {
      const d = ev.data;
      if (d.t === 'ready') {
        ready = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        engineWorker = worker;
        resolve({
          handle: msg => new Promise(res => { const id = ++seq; pending.set(id, res); worker.postMessage({ t: 'req', id, msg }); })
        });
      } else if (d.t === 'res') {
        const res = pending.get(d.id);
        pending.delete(d.id);
        if (res) res(d.r);
      } else if (d.t === 'ask') {
        let r = null;
        try { r = await bgHandle(d.msg); } catch { /* trả null */ }
        worker.postMessage({ t: 'ans', id: d.id, r });
      } else if (d.t === 'file') {
        try {
          const buffer = await getFile(d.name);
          try { worker.postMessage({ t: 'ans', id: d.id, r: buffer }, [buffer]); }
          catch { worker.postMessage({ t: 'ans', id: d.id, r: buffer }); }
        } catch (err) {
          worker.postMessage({ t: 'ans', id: d.id, err: String(err && err.message || err) });
        }
      }
    };
  });
}

// Engine giữ 150–300MB RAM. Không ai hỏi gì trong vài phút thì bỏ đi; lần cần tới
// (bấm sửa nghĩa, dịch lại…) sẽ tự nạp lại từ IndexedDB.
function dropEngine() {
  if (engineWorker) { try { engineWorker.terminate(); } catch { /* đã chết */ } }
  engineWorker = null;
  engineClient = null;
  lastStatus = null;
  setChip('');
}
function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!inflight && engineClient) dropEngine(); }, Number(gmGet('engineIdleSec', 180)) * 1000);
}

// handle(msg, { quiet: true }) = việc chạy ngầm, không hiện chip trạng thái.
function getEngine() {
  if (!engineClient) {
    const impl = createWorkerEngine(worker => { if (engineWorker === worker) dropEngine(); }).then(
      eng => { engineMode = 'worker'; return eng; },
      err => {
        console.warn('[TuiRead] không dùng được Worker (' + (err && err.message) + ') — engine chạy thẳng trên trang.');
        engineMode = 'inline';
        return tuireadEngineFactory({ ask: bgHandle, getFile });
      }
    );
    engineClient = {
      handle(msg, opts) {
        const quiet = !!(opts && opts.quiet);
        inflight++;
        if (!quiet) fgInflight++;
        clearTimeout(idleTimer);
        const done = () => {
          inflight--;
          if (!quiet) fgInflight--;
          if (!inflight) armIdleTimer();
        };
        return impl.then(eng => eng.handle(msg)).then(r => { done(); return r; }, err => { done(); throw err; });
      }
    };
  }
  return engineClient;
}

// ============================================================ CẦU NỐI cho content.js
const ENGINE_TYPES = new Set(['vp:translate', 'vp:tokens', 'vp:status', 'vp:reload', 'vp:cache-clear', 'vp:rebuild']);
let contentListener = null;

async function route(message) {
  const type = message && message.type;
  if (ENGINE_TYPES.has(type)) {
    const resp = await getEngine().handle(message);
    if (type === 'vp:translate') schedulePrefetch();
    return resp;
  }
  return bgHandle(message);
}

const chromeShim = {
  runtime: {
    lastError: undefined,
    sendMessage(message, cb) {
      route(message).then(
        r => { if (cb) cb(r); },
        err => { if (cb) cb({ ok: false, error: String(err && err.message || err) }); }
      );
    },
    onMessage: { addListener(fn) { contentListener = fn; } }
  }
};

function contentCommand(action) {
  return new Promise(resolve => {
    if (!contentListener) { resolve({ ok: false }); return; }
    contentListener({ type: 'vp:command', action }, {}, resolve);
  });
}

// ============================================================ DỊCH TRƯỚC CHƯƠNG KẾ
// Mỗi lần chuyển chương là một lần tải trang -> engine (45MB) phải nạp lại, mất vài giây.
// Khi tab đang rảnh, tải sẵn HTML chương kế, dịch và ghi cache; sang chương đó sẽ hiện
// tiếng Việt ngay từ cache. Tắt được trong Tùy chọn.
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'OPTION', 'TITLE', 'IFRAME', 'TEMPLATE']);
const NEXT_RE = /^[\s\[【(（<«]*下\s*一?\s*[章页頁篇节節话話回][\s\]】)）>»›→]*$/;
let nextUrl = '';
let prefetchTimer = null;
let prefetchDone = false;

function bookKeyOf(loc) {
  const host = loc.hostname.replace(/^www\./, '');
  const path = loc.pathname;
  let m = path.match(/\/book\/(\d+)\//);
  if (m) return host + '/book/' + m[1];
  m = path.match(/^(\/[^/]+\/\d+)\//);
  if (m) return host + m[1];
  return host + path.replace(/[^/]+$/, '');
}

// Gọi TRƯỚC khi trang bị dịch (chữ "下一章" sau đó đã thành tiếng Việt).
function findNextUrl() {
  try {
    let href = '';
    const rel = document.querySelector('a[rel~="next"][href], link[rel~="next"][href]');
    if (rel) href = rel.href;
    if (!href) {
      for (const a of document.querySelectorAll('a[href]')) {
        if (NEXT_RE.test(a.textContent || '')) { href = a.href; break; }
      }
    }
    if (!href) return '';
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return '';
    url.hash = '';
    if (url.href === location.href.replace(/#.*$/, '')) return '';
    return url.href;
  } catch { return ''; }
}

function schedulePrefetch() {
  if (prefetchDone || !nextUrl) return;
  if (gmGet('settings', {}).prefetchNext === false) return;
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => { prefetchNext().catch(() => {}); }, 2500);
}

async function prefetchNext() {
  if (prefetchDone) return;
  prefetchDone = true;
  // Engine chạy thẳng trên trang thì thôi: nạp 45MB sẽ làm khựng trang đang đọc.
  if (engineMode !== 'worker') return;
  const res = await fetch(nextUrl, { credentials: 'include' });
  if (!res.ok) return;
  const bytes = await res.arrayBuffer();
  let html;
  try { html = new TextDecoder(document.characterSet || 'utf-8').decode(bytes); }
  catch { html = new TextDecoder('utf-8').decode(bytes); }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc.body) return;
  const seen = new Set();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && seen.size < 1500; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text || !text.trim() || !HAN_RE.test(text)) continue;
    if (!node.parentElement || SKIP_TAGS.has(node.parentElement.tagName)) continue;
    seen.add(text);
  }
  const bookKey = bookKeyOf(new URL(nextUrl));
  let batch = [];
  let chars = 0;
  const flush = async () => {
    if (!batch.length) return;
    const texts = batch;
    batch = [];
    chars = 0;
    await getEngine().handle({ type: 'vp:translate', texts, bookKey }, { quiet: true });
  };
  for (const text of seen) {
    batch.push(text);
    chars += text.length;
    if (batch.length >= 40 || chars >= 6000) await flush();
  }
  await flush();
}

// ============================================================ BẢNG TÙY CHỌN (thay popup + options)
function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}

function parseLines(text) {
  const entries = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    entries.push({ han: line.slice(0, eq).trim(), vi: line.slice(eq + 1).trim() });
  }
  return entries;
}
const toLines = map => Object.entries(map || {}).map(([han, vi]) => han + '=' + vi).join('\n');

function saveTextFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.documentElement.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET', url, timeout: 20000,
      onload: r => (r.status >= 200 && r.status < 300 ? resolve(String(r.responseText || '')) : reject(new Error('HTTP ' + r.status))),
      onerror: () => reject(new Error('lỗi mạng hoặc bị từ chối quyền truy cập miền này')),
      ontimeout: () => reject(new Error('quá 20s không tải xong'))
    });
  });
}

const PANEL_CSS = `
:host { all: initial; }
.wrap { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); box-sizing: border-box; overflow-y: auto;
  background: #fffdf7; color: #0b2b2f; font: 13px/1.5 system-ui, sans-serif; padding: 12px 14px 24px;
  border-left: 3px solid #e4572e; box-shadow: -6px 0 24px rgba(7,30,34,.3);
  --line: #d8ccb4; --card: #f7f1e5; --muted: #6d7a78; --accent: #e4572e; --input: #fff; }
.wrap.dark { background: #3a2a1f; color: #f3e9dc; --line: #5a4231; --card: #2b1f18; --muted: #a89582; --accent: #ff7a50; --input: #2f2218; }
h1 { font-size: 16px; margin: 0 0 6px; display: flex; justify-content: space-between; align-items: center; }
h1 small { font-weight: 400; color: var(--muted); font-size: 11px; }
.status { white-space: pre-wrap; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 12px; }
label { display: block; margin: 4px 0; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
button, select, input[type=text], input[type=url], textarea { font: inherit; color: inherit; background: var(--input); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
button { background: var(--card); cursor: pointer; }
button:hover { border-color: var(--accent); }
button.main { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
textarea { width: 100%; box-sizing: border-box; min-height: 110px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
input[type=text], input[type=url] { flex: 1 1 140px; min-width: 0; }
details { border-top: 1px solid var(--line); padding: 6px 0; }
summary { cursor: pointer; font-weight: 600; }
.hint { color: var(--muted); font-size: 11.5px; margin: 4px 0; }
.msg { color: var(--accent); font-size: 12px; }
.site { display: inline-flex; gap: 4px; align-items: center; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; margin: 2px 4px 2px 0; }
.site button { border: 0; background: none; padding: 0 2px; }
`;

let panelHost = null;
let panelTimer = null;

function closePanel() {
  if (panelTimer) { clearInterval(panelTimer); panelTimer = null; }
  if (panelHost) { panelHost.remove(); panelHost = null; }
}

function openPanel() {
  if (panelHost) { closePanel(); return; }
  const store = readStore();
  let settings = store.settings;
  const currentBook = bookKeyOf(location);

  panelHost = h('div', { class: 'vp-panel-host' });
  const root = panelHost.attachShadow({ mode: 'open' });
  // Gõ trong bảng không được kích hoạt phím tắt của trang (uukanshu đổi chương bằng mũi tên).
  for (const type of ['keydown', 'keyup', 'keypress']) {
    root.addEventListener(type, e => { if (type === 'keydown' && e.key === 'Escape') closePanel(); e.stopPropagation(); });
  }
  const wrap = h('div', { class: 'wrap' + (settings.uiTheme ? ' dark' : '') });
  root.append(h('style', { textContent: PANEL_CSS }), wrap);

  const flash = (el, text) => { el.textContent = text; setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 6000); };
  const retranslate = () => contentCommand('retranslate');

  // ---- trạng thái + công tắc site
  const statusBox = h('div', { class: 'status' }, 'Đang kiểm tra…');
  const toggleBtn = h('button', { class: 'main', onclick: async () => { await toggleHost(); refreshStatus(); } }, '…');
  async function refreshStatus() {
    if (!panelHost) return;
    const page = await contentCommand('status');
    const st = lastStatus;
    const enabled = readStore().hostState[HOST] !== false;
    toggleBtn.textContent = enabled ? 'Đang bật — bấm để tắt' : 'Đang tắt — bấm để bật';
    let engineLine = 'Engine: chưa nạp từ điển (tự nạp khi có đoạn chưa dịch)';
    if (st) {
      engineLine = 'Engine: ' + st.message + (st.state === 'loading' && typeof st.progress === 'number' ? ' — ' + Math.round(st.progress * 100) + '%' : '');
      if (st.state === 'ready' && st.info) engineLine += '\nVP ' + st.info.vp + ' · Names ' + st.info.names + ' · PA ' + st.info.pa + ' · Rules ' + st.info.rules;
    }
    if (engineMode) engineLine += '\nChạy trong: ' + (engineMode === 'worker' ? 'Web Worker' : 'luồng chính của trang (Worker bị chặn)');
    statusBox.textContent = 'Site: ' + HOST + '\n' + engineLine + '\nTrang này: ' + ((page && page.translated) || 0) + ' đoạn đã dịch';
  }

  // ---- settings
  async function saveSetting(key, value) {
    settings = { ...gmGet('settings', {}), [key]: value };
    await bgHandle({ type: 'vp:set', patch: { settings } });
    if (key === 'uiTheme') wrap.classList.toggle('dark', !!value);
    if (key === 'showFab') { updateFab(); return; }
    if (key === 'prefetchNext') return;
    await retranslate();
    refreshStatus();
  }
  const check = (key, text, defaultOn) => h('label', {},
    h('input', { type: 'checkbox', checked: defaultOn ? settings[key] !== false : settings[key] === true, onchange: e => saveSetting(key, e.target.checked) }),
    ' ' + text);
  const select = (key, options) => {
    const el = h('select', { onchange: e => saveSetting(key, e.target.value) }, options.map(([value, text]) => h('option', { value }, text)));
    el.value = settings[key] || options[0][0];
    return el;
  };

  // ---- vùng nhập "Hán=nghĩa" dùng chung cho bản vá / glossary / luật nhân
  function dictEditor({ load, save, exportName, header, placeholder, extra }) {
    const area = h('textarea', { spellcheck: false, placeholder, value: load() });
    const msg = h('span', { class: 'msg' });
    const file = h('input', { type: 'file', accept: '.txt,text/plain', style: 'display:none', onchange: () => {
      const picked = file.files && file.files[0];
      if (!picked) return;
      const reader = new FileReader();
      reader.onload = async () => { area.value = String(reader.result || ''); await apply('Đã nhập "' + picked.name + '".'); };
      reader.readAsText(picked, 'utf-8');
      file.value = '';
    } });
    async function apply(note) {
      const count = await save(parseLines(area.value));
      area.value = load();
      flash(msg, note + ' ' + count + ' mục.');
      await retranslate();
      refreshStatus();
    }
    const box = h('div', {}, area, h('div', { class: 'row' },
      h('button', { class: 'main', onclick: () => apply('Đã lưu.') }, 'Lưu'),
      h('button', { onclick: () => saveTextFile(exportName(), header + area.value.split('\n').filter(l => l.trim() && !l.startsWith('#')).join('\n') + '\n') }, 'Xuất .txt'),
      h('button', { onclick: () => file.click() }, 'Nhập .txt'),
      extra || null, file, msg));
    return { box, area, reload: () => { area.value = load(); }, apply, flash: text => flash(msg, text) };
  }

  // ---- Từ điển của tôi
  const overrides = dictEditor({
    load: () => toLines(gmGet('overrides', {})),
    save: async entries => Object.keys((await bgHandle({ type: 'vp:override-replace', entries })).overrides).length,
    exportName: () => 'tuiread-overrides.txt',
    header: '# TuiRead - bản vá từ điển của tôi. Định dạng: 漢=nghĩa\n',
    placeholder: 'Mỗi dòng một mục:\n搜索=Tìm tòi\n林動=Lâm Động'
  });
  const urlInput = h('input', { type: 'url', spellcheck: false, placeholder: 'https://raw.githubusercontent.com/…/overrides.txt', value: store.ovUrl });
  const urlBtn = h('button', { onclick: async () => {
    let url;
    try { url = new URL(urlInput.value.trim()); } catch { overrides.flash('URL không hợp lệ.'); return; }
    if (!/^https?:$/.test(url.protocol)) { overrides.flash('Chỉ nhận URL http/https.'); return; }
    urlBtn.disabled = true;
    try {
      const text = await fetchText(url.href);
      if (text.length > 8 * 1024 * 1024) throw new Error('file lớn hơn 8MB');
      if (!parseLines(text).length) throw new Error('không có dòng hợp lệ nào (dạng 漢=nghĩa)');
      overrides.area.value = text;
      gmSet('ovUrl', url.href);
      await overrides.apply('Đã tải từ URL (thay toàn bộ bản vá).');
    } catch (err) {
      overrides.flash('Không tải được: ' + (err && err.message || err));
    } finally {
      urlBtn.disabled = false;
    }
  } }, 'Tải từ URL');

  // ---- Từ điển riêng theo truyện
  const bookSelect = h('select', { style: 'flex:1 1 200px;min-width:0', onchange: () => glossary.reload() });
  function fillBooks() {
    const all = gmGet('glossaries', {});
    const keys = [currentBook, ...Object.keys(all).filter(key => key !== currentBook).sort()];
    const previous = bookSelect.value || currentBook;
    bookSelect.textContent = '';
    for (const key of keys) bookSelect.append(h('option', { value: key }, key + ' (' + Object.keys(all[key] || {}).length + ' mục)' + (key === currentBook ? ' — truyện này' : '')));
    bookSelect.value = keys.includes(previous) ? previous : currentBook;
  }
  fillBooks();
  const glossary = dictEditor({
    load: () => toLines(gmGet('glossaries', {})[bookSelect.value]),
    save: async entries => {
      const resp = await bgHandle({ type: 'vp:glossary-replace', bookKey: bookSelect.value, entries });
      fillBooks();
      return Object.keys(resp.glossary || {}).length;
    },
    exportName: () => 'tuiread-glossary-' + bookSelect.value.replace(/[^a-zA-Z0-9._-]+/g, '_') + '.txt',
    header: '# TuiRead - từ điển riêng của truyện. Định dạng: 漢=nghĩa\n',
    placeholder: 'Mỗi dòng một mục:\n林动=Lâm Động',
    extra: h('button', { onclick: async () => { glossary.area.value = ''; await glossary.apply('Đã xoá bộ này.'); } }, 'Xoá bộ này')
  });

  // ---- Luật nhân của tôi
  const userRules = dictEditor({
    load: () => toLines(gmGet('userRules', {})),
    save: async entries => Object.keys((await bgHandle({ type: 'vp:userrules-replace', entries })).userRules).length,
    exportName: () => 'tuiread-luatnhan.txt',
    header: '# TuiRead - luật nhân của tôi. Định dạng: mẫu có {0}=nghĩa có {0}\n',
    placeholder: 'Mỗi dòng một luật:\n根本不是{0}的对手=căn bản không phải là đối thủ của {0}'
  });

  // ---- Site + selector
  const selectorInput = h('input', { type: 'text', spellcheck: false, placeholder: '#content, .chapter-body', value: store.siteSelectors[HOST] || '' });
  const siteMsg = h('span', { class: 'msg' });
  const siteList = h('div', {});
  function fillSites() {
    siteList.textContent = '';
    for (const site of BUILTIN_SITES) siteList.append(h('span', { class: 'site' }, site + ' *'));
    for (const site of addedSites()) {
      siteList.append(h('span', { class: 'site' }, site, h('button', { title: 'Bỏ site này', onclick: () => {
        gmSet('addedSites', addedSites().filter(s => s !== site));
        fillSites();
        flash(siteMsg, 'Đã bỏ ' + site + ' — có hiệu lực từ lần tải trang sau.');
      } }, '✕')));
    }
  }
  fillSites();

  // ---- Thử convert
  const trySrc = h('textarea', { spellcheck: false, style: 'min-height:60px', value: '他没想到对方竟然会如此干脆利落，心中不由得一动，目光落在那枚古朴的戒指上。' });
  const tryOut = h('div', { class: 'status' }, '-');

  wrap.append(
    h('h1', {}, h('span', {}, 'TuiRead ', h('small', {}, 'userscript ' + SCRIPT_VERSION)), h('button', { onclick: closePanel, title: 'Đóng (Esc)' }, '✕')),
    statusBox,
    h('div', { class: 'row' }, toggleBtn),
    h('div', { class: 'row' },
      h('button', { onclick: async () => { await retranslate(); refreshStatus(); } }, 'Dịch lại trang'),
      h('button', { onclick: async () => { await getEngine().handle({ type: 'vp:reload' }); await retranslate(); refreshStatus(); } }, 'Nạp lại từ điển'),
      h('button', { onclick: async () => { await getEngine().handle({ type: 'vp:cache-clear' }); await retranslate(); refreshStatus(); } }, 'Xoá cache dịch'),
      h('button', { title: 'Xoá file từ điển đã lưu trên site này rồi tải lại từ GitHub', onclick: async () => {
        try { await dictStore('readwrite', s => s.clear()); } catch { /* không có gì để xoá */ }
        await getEngine().handle({ type: 'vp:reload' });
        await retranslate();
        refreshStatus();
      } }, 'Tải lại từ điển từ mạng')),

    h('details', { open: true }, h('summary', {}, 'Hiển thị'),
      h('label', {}, 'Kiểu ', select('mode', [['vi', 'Chỉ tiếng Việt'], ['vi-han', 'Tiếng Việt + gốc Hán bên dưới']])),
      h('label', {}, 'Giao diện card/bảng ', select('uiTheme', [['', 'Sáng'], ['cappuccino', 'Cappuccino (tối)']])),
      check('translateChrome', 'Dịch cả menu, header, footer của trang', true),
      check('allowClickEdit', 'Bấm vào cụm đã dịch để xem Hán gốc và sửa nghĩa', true),
      check('prefetchNext', 'Dịch trước chương kế khi đang đọc (sang chương hiện tiếng Việt ngay)', true),
      check('showFab', 'Hiện nút tròn TuiRead ở góc dưới trái', true)),

    h('details', {}, h('summary', {}, 'Cách chọn nghĩa'),
      check('firstMeaning', 'Chỉ lấy nghĩa đầu trước dấu / (tắt = giữ tất cả nghĩa)', true),
      check('skipParticles', 'Bỏ chữ thừa 的 / 了 / 着 / 著 khi không khớp được cụm từ', false),
      check('useRules', 'Bật rule engine (số, giờ, ngày, đơn vị)', true),
      check('useNames', 'Bật nhận diện tên riêng (Names)', true)),

    h('details', {}, h('summary', {}, 'Site & selector khu vực truyện'),
      h('div', { class: 'hint' }, 'Site đang chạy TuiRead (* = mặc định). Thêm site: mở trang truyện đó → menu của trình quản lý userscript → "TuiRead: bật trên site này".'),
      siteList,
      h('div', { class: 'hint' }, 'Selector CSS của thân truyện cho ' + HOST + ' (để trống = tự chọn khối nhiều chữ Hán nhất):'),
      h('div', { class: 'row' }, selectorInput, h('button', { class: 'main', onclick: async () => {
        const map = { ...readStore().siteSelectors };
        const value = selectorInput.value.trim();
        if (value) map[HOST] = value; else delete map[HOST];
        gmSet('siteSelectors', map);
        await retranslate();
        flash(siteMsg, 'Đã lưu selector.');
      } }, 'Lưu')),
      siteMsg),

    h('details', {}, h('summary', {}, 'Từ điển của tôi (bản vá cho mọi truyện)'),
      h('div', { class: 'hint' }, 'Thắng mọi mục của từ điển gốc. Vá cụm tên đầy đủ (秦江=Tần Giang), đừng vá một chữ.'),
      overrides.box,
      h('div', { class: 'row' }, urlInput, urlBtn)),

    h('details', {}, h('summary', {}, 'Từ điển riêng theo truyện'),
      h('div', { class: 'row' }, bookSelect),
      glossary.box),

    h('details', {}, h('summary', {}, 'Luật nhân của tôi'),
      h('div', { class: 'hint' }, '{0} là chỗ trống cho tên/cụm Hán (1–8 chữ).'),
      userRules.box),

    h('details', {}, h('summary', {}, 'Thử convert'),
      trySrc,
      h('div', { class: 'row' }, h('button', { class: 'main', onclick: async () => {
        tryOut.textContent = 'Đang convert…';
        const resp = await getEngine().handle({ type: 'vp:translate', texts: trySrc.value.split(/\n+/).filter(line => line.trim()) });
        tryOut.textContent = resp && resp.ok ? resp.results.join('\n') : 'Lỗi: ' + (resp && resp.error);
      } }, 'Convert')),
      tryOut)
  );

  document.documentElement.appendChild(panelHost);
  refreshStatus();
  panelTimer = setInterval(refreshStatus, 1500);
}

// ============================================================ NÚT NỔI + MENU
let fabHost = null;
function updateFab() {
  const wanted = gmGet('settings', {}).showFab !== false;
  if (!wanted) { if (fabHost) { fabHost.remove(); fabHost = null; } return; }
  if (fabHost) return;
  fabHost = h('div', { class: 'vp-fab-host' });
  const root = fabHost.attachShadow({ mode: 'open' });
  root.append(
    h('style', { textContent: ':host{all:initial}button{position:fixed;left:10px;bottom:10px;z-index:2147483645;width:30px;height:30px;border-radius:50%;border:1px solid #f2b33d;background:#12474b;color:#f7f1e5;font:600 11px/1 system-ui,sans-serif;opacity:.35;cursor:pointer;padding:0}button:hover{opacity:1}' }),
    h('button', { title: 'Tùy chọn TuiRead', onclick: openPanel }, 'TR'));
  document.documentElement.appendChild(fabHost);
}

async function toggleHost() {
  const state = { ...gmGet('hostState', {}) };
  const enabled = state[HOST] !== false;
  state[HOST] = !enabled;
  gmSet('hostState', state);
  await contentCommand(enabled ? 'disable' : 'enable');
}

async function toggleMode() {
  const settings = { ...gmGet('settings', {}) };
  settings.mode = settings.mode === 'vi-han' ? 'vi' : 'vi-han';
  await bgHandle({ type: 'vp:set', patch: { settings } });
  await contentCommand('retranslate');
}

function menu(title, fn) {
  try { GM_registerMenuCommand(title, fn); } catch { /* trình quản lý không hỗ trợ menu */ }
}

// Tab khác vừa đổi bản vá / glossary / luật / settings -> engine của tab này dùng theo.
let remoteTimer = null;
function watchRemoteChanges() {
  if (typeof GM_addValueChangeListener !== 'function') return;
  const onChange = (name, oldValue, newValue, remote) => {
    if (!remote) return;
    if (name === 'settings') {
      const core = value => { const copy = { ...(value || {}) }; delete copy.showFab; delete copy.prefetchNext; return JSON.stringify(copy); };
      if (core(oldValue) === core(newValue)) { updateFab(); return; }
    }
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(async () => {
      const state = await pushEngine({ type: 'vp:engine-state' });
      if (state && state.booted) await pushEngine({ type: 'vp:rebuild', reason: 'remote' });
      else await pushEngine({ type: 'vp:ctx-reset' });
      await contentCommand('retranslate');
      updateFab();
    }, 600);
  };
  for (const key of ['overridesVersion', 'glossariesVersion', 'userRulesVersion', 'settings']) {
    try { GM_addValueChangeListener(key, onChange); } catch { /* bỏ qua */ }
  }
}

// ============================================================ CONTENT SCRIPT GỐC
function runContent(chrome) {
/*@@CONTENT@@*/
}

let started = false;
function start() {
  if (started) return;
  started = true;
  try { GM_addStyle(CONTENT_CSS); }
  catch { document.head.appendChild(h('style', { textContent: CONTENT_CSS })); }
  nextUrl = findNextUrl();
  menu('TuiRead: Tùy chọn', openPanel);
  menu('TuiRead: Bật / tắt dịch trên site này', toggleHost);
  menu('TuiRead: Đổi kiểu hiển thị (Việt ↔ Việt + Hán)', toggleMode);
  menu('TuiRead: Dịch lại trang', () => contentCommand('retranslate'));
  watchRemoteChanges();
  runContent(chromeShim);
  updateFab();
}

if (siteAllowed(HOST)) {
  start();
} else {
  menu('TuiRead: bật trên site này (' + HOST + ')', () => {
    if (!HOST) return;
    gmSet('addedSites', [...new Set([...addedSites(), HOST])]);
    start();
  });
}
})();
