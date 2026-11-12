// ==UserScript==
// @name         TuiRead (userscript)
// @namespace    https://github.com/loooveee
// @version      0.8.1.1
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

const SCRIPT_VERSION = '0.8.1.1';
const DICT_REF = 'd78cfba4be9affc3aaff7234cf1133d7468c306f';
const DEFAULT_DICT_BASE = 'https://raw.githubusercontent.com/memories169/tuiread-firefox/' + DICT_REF + '/dict/';
const BUILTIN_SITES = ['uukanshu.cc', 'piaotia.com'];
const DEFAULT_SITE_SELECTORS = {
  'uukanshu.cc': '.readcotent, #content, article',
  'piaotia.com': '#content, .content, td.tbd, #booktext'
};
const ENGINE_KEYS = ['firstMeaning', 'skipParticles', 'useRules', 'useNames'];
const CONTENT_CSS = ".vp-orig {\n  display: none;\n}\n\nbody.vp-mode-han .vp-orig {\n  display: block;\n  color: #8b8b8b;\n  font-size: 0.86em;\n  line-height: 1.5;\n  opacity: 0.8;\n  margin: 0.15em 0 0.9em;\n  border-left: 2px solid rgba(140, 140, 140, 0.35);\n  padding-left: 0.6em;\n  white-space: pre-wrap;\n}\n\n/* Nhận diện TuiRead: mực teal + giấy ấm + chu sa/hổ phách làm điểm nhấn.\n   Giữ nguyên tên lớp .vp-* (content.js, harness và browser-check đều dựa vào chúng). */\n.vp-status-chip {\n  position: fixed;\n  right: 12px;\n  bottom: 12px;\n  z-index: 2147483647;\n  background: linear-gradient(160deg, #12474b, #0b2b2f);\n  color: #f7f1e5;\n  font: 12px/1.4 system-ui, sans-serif;\n  padding: 6px 10px;\n  border-radius: 6px;\n  border-left: 3px solid #f2b33d;\n  box-shadow: 0 3px 12px rgba(7, 30, 34, 0.35);\n  opacity: 0.95;\n}\n\n/* Card sửa nghĩa (tokenMap click-to-edit): bấm vào cụm đã dịch để vá từ điển ngay trên trang */\n/* THEME UI trên trang: biến mặc định (sáng) + data-vp-theme='cappuccino' (tối).\n   content.js đặt attr này lên <html> theo settings.uiTheme — card sửa chữ ăn theo. */\n:root {\n  --vp-pop-bg: #fffdf7;\n  --vp-pop-ink: #0b2b2f;\n  --vp-pop-ink2: #12474b;\n  --vp-pop-line: #d8ccb4;\n  --vp-pop-card: #f7f1e5;\n  --vp-pop-hover: #efe6d4;\n  --vp-pop-input-bg: #ffffff;\n  --vp-pop-muted: #6d7a78;\n  --vp-pop-vermilion: #e4572e;\n  --vp-pop-vermilion-hover: #c9481f;\n  --vp-pop-amber: #f2b33d;\n  --vp-pop-chipsep: #b9a97f;\n}\n:root[data-vp-theme='cappuccino'] {\n  --vp-pop-bg: #3a2a1f;\n  --vp-pop-ink: #f3e9dc;\n  --vp-pop-ink2: #d9c1a3;\n  --vp-pop-line: #5a4231;\n  --vp-pop-card: #2b1f18;\n  --vp-pop-hover: #46352a;\n  --vp-pop-input-bg: #2f2218;\n  --vp-pop-muted: #a89582;\n  --vp-pop-vermilion: #ff7a50;\n  --vp-pop-vermilion-hover: #ff8f68;\n  --vp-pop-amber: #ffc864;\n  --vp-pop-chipsep: #8a6a4f;\n}\n\n.vp-pop {\n  position: fixed;\n  z-index: 2147483646;\n  max-width: 340px;\n  background: var(--vp-pop-bg);\n  color: var(--vp-pop-ink);\n  border: 1px solid var(--vp-pop-line);\n  border-top: 3px solid var(--vp-pop-vermilion);\n  border-radius: 10px;\n  box-shadow: 0 6px 24px rgba(7, 30, 34, 0.3);\n  padding: 10px 12px;\n  font: 13px/1.5 system-ui, sans-serif;\n}\n\n.vp-pop-head {\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n  margin-bottom: 6px;\n}\n\n.vp-pop-han {\n  font-size: 17px;\n  font-weight: 600;\n}\n\n.vp-pop-kind {\n  color: #6d7a78;\n  font-size: 11px;\n}\n\n/* Âm Hán Việt của vùng chọn — hàng nhỏ xám ngay dưới tiêu đề */\n.vp-pop-phien {\n  font-size: 12.5px;\n  color: #6d7a78;\n  font-style: italic;\n  margin: 2px 0 4px;\n}\n\n.vp-pop-cur {\n  color: #8a6d1a;\n  font-size: 12px;\n  margin-bottom: 4px;\n}\n\n/* Hàng nhập có nhãn: \"Tiếng Trung / Hán Việt / Vietphrase\" */\n.vp-pop-row {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  margin: 5px 0;\n}\n\n.vp-pop-label {\n  flex: 0 0 auto;\n  min-width: 84px;\n  font-size: 12px;\n  color: #6b5d4f;\n  font-weight: 500;\n}\n\n.vp-pop-row .vp-pop-input {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.vp-pop-input {\n  width: 100%;\n  box-sizing: border-box;\n  padding: 5px 7px;\n  margin: 2px 0 8px;\n  font: inherit;\n  color: var(--vp-pop-ink);\n  background: var(--vp-pop-input-bg);\n  border: 1px solid var(--vp-pop-line);\n  border-radius: 6px;\n}\n\n.vp-pop-input:focus {\n  outline: 2px solid var(--vp-pop-amber);\n  outline-offset: 1px;\n}\n\n.vp-pop-btns button {\n  font: inherit;\n  padding: 4px 12px;\n  margin-right: 6px;\n  border: 1px solid var(--vp-pop-line);\n  border-radius: 6px;\n  background: var(--vp-pop-card);\n  color: var(--vp-pop-ink);\n  cursor: pointer;\n}\n\n.vp-pop-btns button:first-child {\n  background: var(--vp-pop-vermilion);\n  border-color: var(--vp-pop-vermilion);\n  color: #fff;\n  font-weight: 600;\n}\n\n.vp-pop-btns button:hover {\n  background: var(--vp-pop-hover);\n}\n\n.vp-pop-btns button:first-child:hover {\n  background: var(--vp-pop-vermilion-hover);\n}\n\n/* F1 (bản 2): từ đang chọn = ĐỔI MÀU CHỮ xanh cyan qua CSS Custom Highlight API.\n   Range thật bám theo text — không có lớp overlay nên không bao giờ lệch. */\n/* F1 bản 3: <mark class=\"vp-sel\"> thật bọc token đang chọn — CSS thuần, chắc chắn hiện */\nmark.vp-sel {\n  background: transparent;          /* nền trang giữ nguyên */\n  color: #00e5ff;                   /* chữ cyan */\n  text-shadow: 0 0 6px rgba(0, 229, 255, 0.45);\n  font: inherit;                    /* không nhảy cỡ/weight so với dòng */\n  padding: 0;\n  margin: 0;\n}\n\n/* Font SF Pro Display cho toàn bộ bản dịch (span .vp-vi bọc quanh text node đã dịch)\n   và mọi UI của TuiRead trên trang. Chữ Hán gốc (.vp-orig) giữ font của trang. */\n.vp-vi, .vp-pop, .vp-status-chip {\n  font-family: 'SF Pro Display', system-ui, sans-serif;\n}\n\n/* Bo nho sup: the span moi khong the nho hon text node cha - dam bao doc sach tai\n   moi kich thuoc, khong lam giat layout khi boc/unwrap */\n.vp-vi {\n  display: inline;\n  font-variant-ligatures: none;\n  -webkit-font-smoothing: antialiased;\n  text-rendering: optimizeLegibility;\n}\n\n\n/* F2: chip từng chữ Hán trong card sửa — bấm để thu vùng chọn */\n.vp-chip {\n  font: inherit;\n  font-size: 15px;\n  padding: 1px 4px;\n  margin: 0 1px;\n  border: 1px solid transparent;\n  border-radius: 4px;\n  background: transparent;\n  color: var(--vp-pop-ink);\n  cursor: pointer;\n}\n\n.vp-chip:hover {\n  background: var(--vp-pop-hover);\n  border-color: var(--vp-pop-line);\n}\n\n.vp-chip-sep {\n  color: var(--vp-pop-chipsep);\n  font-size: 11px;\n}\n\n.vp-pop-hint {\n  color: var(--vp-pop-muted);\n  font-size: 11px;\n  margin-top: 6px;\n}\n";

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

// ---- numbers.js ----
const M_numbers = (() => {
// Chuyển chữ số Hán sang Ả Rập cho rule engine (<n>, <y>).

const DIGITS = {
  '零': 0, '〇': 0, '○': 0,
  '一': 1, '二': 2, '两': 2, '兩': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9
};
const SMALL_UNITS = { '十': 10, '百': 100, '千': 1000 };
const LARGE_UNITS = { '万': 1e4, '萬': 1e4, '亿': 1e8, '億': 1e8 };

const NUM_CHARS = /[0-9零〇○一二两兩三四五六七八九十百千万萬亿億]/;
const DIGIT_ONLY_CHARS = /[0-9零〇○一二三四五六七八九]/;

const LABELS = {
  '章': 'Chương', '卷': 'Quyển', '集': 'Tập', '节': 'Tiết', '節': 'Tiết',
  '幕': 'Màn', '回': 'Hồi', '折': 'Chiết'
};

function isNumChar(ch) { return NUM_CHARS.test(ch); }
function isDigitChar(ch) { return DIGIT_ONLY_CHARS.test(ch); }

// Chuỗi gồm 十百千 + 万萬亿億 + chữ số -> số Ả Rập.
// Hỗ trợ dạng rút gọn: 六百三八=638, 一千三百=1300, 六百三=630, 一百二=120 —
// chữ số trần đứng NGAY sau đơn vị mà tiếp theo là chữ số khác hoặc hết chuỗi
// thì chiếm bậc đơn vị/10; các chữ số trần sau đó giảm bậc /10 từng bước.
// Hạn chế (hiếm gặp trong số chương): 一万二 chưa rút gọn được (cần 一万二千).
function chineseNumberToArabic(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^[0-9]+$/.test(s)) return String(Number(s));

  const chars = [...s];
  const hasUnit = chars.some(ch => SMALL_UNITS[ch] || LARGE_UNITS[ch]);
  if (!hasUnit) {
    // Không có đơn vị -> đọc từng chữ số: 三八=38, 二零一八=2018.
    let out = '';
    for (const ch of chars) {
      const d = DIGITS[ch];
      const v = d !== undefined ? d : (/[0-9]/.test(ch) ? Number(ch) : null);
      if (v === null) return '';
      out += String(v);
    }
    return out;
  }

  let result = 0, section = 0, number = 0, mag = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    const after = chars[i + 2];
    const d = DIGITS[ch], u = SMALL_UNITS[ch], L = LARGE_UNITS[ch];
    const ascii = /[0-9]/.test(ch);
    if (d !== undefined || ascii) {
      const value = ascii ? Number(ch) : d;
      const nextIsUnit = next !== undefined && (SMALL_UNITS[next] !== undefined || LARGE_UNITS[next] !== undefined);
      if (mag > 0 && value > 0 && !nextIsUnit) {
        number += value * mag;          // chữ số trần trong chuỗi rút gọn
        mag = mag >= 10 ? mag / 10 : 0;
      } else {
        number = value; mag = 0;        // chữ số thường (đứng trước đơn vị) hoặc 零: hủy rút gọn
      }
      continue;
    }
    if (u) {
      section += (number || 1) * u;
      number = 0;
      // Chữ số kế tiếp là "số trần" (tiếp nữa là chữ số khác hoặc hết chuỗi)
      // -> nó chiếm bậc u/10, KHÔNG phải chữ số đứng trước đơn vị nữa.
      mag = (next !== undefined && DIGITS[next] !== undefined && (after === undefined || DIGITS[after] !== undefined)) ? u / 10 : 0;
      continue;
    }
    if (L) {
      section += number;
      result += (section || 1) * L;
      section = 0; number = 0;
      // 一万二 = 12000: chữ số sau đơn vị lớn cũng có bậc rút gọn (L/10).
      mag = (next !== undefined && DIGITS[next] !== undefined) ? L / 10 : 0;
      continue;
    }
    return '';
  }
  return String(result + section + number);
}

// Đọc từng chữ số: 二零一八 -> 2018 (dùng cho <y>: năm, mã số).
function digitByDigit(input) {
  let out = '';
  for (const ch of String(input || '')) {
    if (/[0-9]/.test(ch)) out += ch;
    else if (DIGITS[ch] !== undefined) out += String(DIGITS[ch]);
    else return '';
  }
  return out;
}

return { DIGITS, SMALL_UNITS, LARGE_UNITS, NUM_CHARS, DIGIT_ONLY_CHARS, LABELS, isNumChar, isDigitChar, chineseNumberToArabic, digitByDigit };
})();

// ---- dict.js ----
const M_dict = (() => {
// Đọc file từ điển định dạng "Hán=nghĩa Việt" (một mục từ mỗi dòng).
// Nghĩa nhiều nghĩa phân cách bởi separator (mặc định '/'), có thể lấy nghĩa đầu.

function isWsCode(code) {
  return code === 32 || code === 9 || code === 13 || code === 10;
}

// Xử lý một dòng dict: trả [key, value] hoặc null. Dùng chung cho parseDict (string)
// và parseDictBuffer (streaming) để hai đường luôn hành xử giống hệt nhau.
function dictEntry(line, singleChar) {
  if (!line) return null;
  const c0 = line.charCodeAt(0);
  if (c0 === 35 || c0 === 47) return null; // '#' or '/'
  const eq = line.indexOf('=');
  if (eq < 1) return null;
  let from = 0, to = eq;
  while (from < to && isWsCode(line.charCodeAt(from))) from++;
  while (to > from && isWsCode(line.charCodeAt(to - 1))) to--;
  const key = to > from ? line.slice(from, to) : '';
  from = eq + 1; to = line.length;
  while (from < to && isWsCode(line.charCodeAt(from))) from++;
  while (to > from && isWsCode(line.charCodeAt(to - 1))) to--;
  const value = to > from ? line.slice(from, to) : '';
  if (!key || !value) return null;
  if (singleChar && Array.from(key).length > 1) return null;
  return [key, value];
}

function parseDict(text, { singleChar = false } = {}) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const entry = dictEntry(line, singleChar);
    if (entry) map.set(entry[0], entry[1]);
  }
  return map;
}

// Streaming parse cho file từ điển BỰ (36MB): decode từng khối, cắt dòng, không giữ
// mảng 1 triệu dòng trong RAM cùng lúc → đỉnh bộ nhớ lúc nạp giảm đáng kể (tránh
// cảm giác "treo" trên máy ít RAM trống khi offscreen boot/rebuild).
function parseDictBuffer(buffer, { singleChar = false, chunkBytes = 1 << 21 } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let decoder, offset = 0;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { decoder = new TextDecoder('utf-16le'); offset = 2; }
  else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { decoder = new TextDecoder('utf-8'); offset = 3; }
  else decoder = new TextDecoder('utf-8');

  const map = new Map();
  let carry = '';
  while (offset < bytes.length) {
    const end = Math.min(bytes.length, offset + chunkBytes);
    const text = decoder.decode(bytes.subarray(offset, end), { stream: true });
    offset = end;
    let lineStart = 0;
    for (;;) {
      const nl = text.indexOf('\n', lineStart);
      if (nl < 0) { carry += text.slice(lineStart); break; }
      const entry = dictEntry(carry + text.slice(lineStart, nl), singleChar);
      if (entry) map.set(entry[0], entry[1]);
      carry = '';
      lineStart = nl + 1;
    }
  }
  // dòng cuối không có '\n' + flush decoder (phần multi-byte còn treo)
  const tail = carry + decoder.decode();
  const entry = dictEntry(tail, singleChar);
  if (entry) map.set(entry[0], entry[1]);
  return map;
}

// Gỡ wrapper điều khiển còn sót trong dữ liệu dict cộng đồng, giữ nguyên {0} (placeholder luật):
//   {máy luyện lực tổng hợp} -> máy luyện lực tổng hợp   (378 mục trong VP)
//   [Nữ siêu nhân số 2]      -> Nữ siêu nhân số 2        (ngoặc bao trọn nghĩa)
//   ...thời[]                -> ...thời                  (ngoặc rỗng đuôi)
//   {đèn pin tiến hóa☼}      -> đèn pin tiến hóa         (☼ là cờ nội bộ của dict cũ)
function cleanMeaning(text) {
  let out = String(text);
  out = out.replace(/\{([^{}]*)\}/g, (m, inner) => (/^\d+$/.test(inner) ? m : inner));
  out = out.replace(/\[([^\[\]]*)\]/g, (m, inner) => inner);
  out = out.replace(/☼/g, '');
  return out.trim();
}

function firstMeaning(value, separator) {
  const sep = separator || '/';
  // Chọn candidate đầu tiên KHÔNG rỗng sau khi gỡ wrapper: dict cộng đồng có mục
  // kiểu "/lấy/mắng" (candidate đầu trống) — lấy theo vị trí thì token biến mất khỏi bản dịch.
  for (const part of String(value).split(sep)) {
    const cleaned = cleanMeaning(part);
    if (cleaned) return cleaned;
  }
  return '';
}

// Độ dài mục từ dài nhất — dùng làm trần cho vòng lặp longest-match.
function maxKeyLength(map) {
  let max = 1;
  for (const key of map.keys()) {
    const len = [...key].length;
    if (len > max) max = len;
  }
  return max;
}

return { parseDict, parseDictBuffer, cleanMeaning, firstMeaning, maxKeyLength };
})();

// ---- t2s.js ----
const M_t2s = (() => {
// Chuẩn hoá 繁體 → 简体 bằng bảng OpenCC TSCharacters.txt (Apache-2.0).
// Dòng dữ liệu: <繁><TAB><简> [<简 biến thể...>]

function parseT2S(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const parts = s.split(/\s+/);
    if (parts.length < 2) continue;
    map.set(parts[0], parts[1]);
  }
  return map;
}

function toSimplified(text, map) {
  if (!map || map.size === 0) return text;
  let out = '';
  for (const ch of text) {
    const s = map.get(ch);
    out += s === undefined ? ch : s;
  }
  return out;
}

return { parseT2S, toSimplified };
})();

// ---- rules.js ----
const M_rules = (() => {
// Rule engine QuickTranslate (subset): literal, (a|b), (a|b)?, <n:m-n>, <y:m-n>, <L>, {i}.
// Rule cần <ne> <pn> <vp> <hv> bị bỏ qua (đếm ở stats.skipped). Token dự án: <n> <y> <L> <e> (từ thường) <w> (tự do) <u> (tên).

const { isNumChar, isDigitChar, chineseNumberToArabic, digitByDigit, LABELS } = M_numbers;

const CAPTURE_RE = /^<([nyLewup])(?::(\d+)(?:-(\d+))?)?>$/;
// set bởi createRuleEngine: chặn capture <e> khi là từ thường (xem createRuleEngine).
let REJECT_CAPTURE = null;   // token <e> bị chặn; <w> bỏ qua; <u> cần ACCEPT_NAME (tên)
let ACCEPT_NAME = null;   // (chuỗi) => true nếu là TÊN RIÊNG (nghĩa VP viết hoa)
let ACCEPT_WHOLE = null;   // (chuỗi) => true nếu capture nguyên là key VP (danh từ hợp lệ)
// 1 chữ Hán (gồm CJK Ext-A) — dùng cho token <e> (run chữ Hán bất kỳ, {0} của LuatNhan).
const HAN_1 = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

// <ne> <pn> <vp> <hv> <w> can tra tu dien khi match -> chưa hỗ trợ.
function hasUnsupportedToken(pattern) {
  for (const m of pattern.matchAll(/<([^>]*)>/g)) {
    const kind = m[1].split(':')[0];
    if (kind !== 'n' && kind !== 'y' && kind !== 'L' && kind !== 'e' && kind !== 'w' && kind !== 'u' && kind !== 'p') return true;
  }
  return false;
}

function tokenize(pattern) {
  const chars = [...pattern];
  const tokens = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === '<') {
      const close = chars.indexOf('>', i);
      if (close < 0) return null;
      const spec = chars.slice(i, close + 1).join('');
      const m = CAPTURE_RE.exec(spec);
      if (!m) return null;
      const kind = m[1];
      const min = m[2] ? Number(m[2]) : 1;
      const max = m[3] ? Number(m[3]) : (kind === 'L' ? 1 : (m[2] ? Number(m[2]) : 8));
      if (kind === 'L') tokens.push({ t: 'label' });
      else if (kind === 'e') tokens.push({ t: 'han', min, max });
      else if (kind === 'w') tokens.push({ t: 'han', min, max, free: true });   // <w> bỏ qua rejectCapture
      else if (kind === 'u') tokens.push({ t: 'han', min, max, free: true, nameOk: true });   // <u> chỉ nhận TÊN (nghĩa VP viết hoa)
      else if (kind === 'p') tokens.push({ t: 'han', min, max, allowWhole: true });   // <p> như <e> + nhận nguyên từ VP
      else tokens.push({ t: kind === 'n' ? 'num' : 'year', min, max });
      i = close + 1;
      continue;
    }
    if (ch === '(') {
      const close = chars.indexOf(')', i);
      if (close < 0) return null;
      const alts = chars.slice(i + 1, close).join('').split('|').filter(a => a.length);
      let optional = false;
      let next = close + 1;
      if (chars[next] === '?') { optional = true; next++; }
      tokens.push({ t: 'group', alts, optional });
      i = next;
      continue;
    }
    tokens.push({ t: 'lit', v: ch });
    i++;
  }
  return tokens.length ? tokens : null;
}

function parseTemplate(template) {
  const parts = [];
  let i = 0;
  while (i < template.length) {
    const m = /\{(\d+)\}/.exec(template.slice(i));
    if (!m) { parts.push({ lit: template.slice(i) }); break; }
    if (m.index) parts.push({ lit: template.slice(i, i + m.index) });
    parts.push({ ref: Number(m[1]) });
    i += m.index + m[0].length;
  }
  return parts;
}

function parseRules(text) {
  const rules = [];
  const stats = { total: 0, skippedUnsupported: 0, skippedInvalid: 0 };
  for (const raw of String(text || '').split('\n')) {
    let line = raw.trim();
    // "!" đầu dòng = rule mạnh: thắng cả khi HOÀ độ dài với key VietPhrase.
    // Dùng cho tiêu đề chương: dữ liệu 第X章 trong VietPhrase có ~15% mục sai số
    // (VD 第一千五百四十八章 ghi 1549) và thiếu mục số Ả Rập >= 1000 — rule tính
    // số chuẩn luôn đúng nên phải nhường KHÔNG cần dài hơn.
    const strong = line.startsWith('!');
    if (strong) line = line.slice(1).trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    stats.total++;
    const pattern = line.slice(0, eq).trim();
    const template = line.slice(eq + 1).trim();
    if (hasUnsupportedToken(pattern)) { stats.skippedUnsupported++; continue; }
    const tokens = tokenize(pattern);
    if (!tokens) { stats.skippedInvalid++; continue; }
    if (!tokens.some(t => t.t === 'lit' || (t.t === 'group' && !t.optional))) { stats.skippedInvalid++; continue; }
    const parts = parseTemplate(template);
    const refs = parts.filter(p => p.ref !== undefined).length;
    const captures = tokens.filter(t => t.t === 'num' || t.t === 'year' || t.t === 'label' || t.t === 'han').length;
    if (refs !== captures) { stats.skippedInvalid++; continue; }
    rules.push({ pattern, parts, tokens, order: rules.length, strong });
  }
  return { rules, stats };
}

function walk(tokens, ti, text, pos, captures) {
  if (ti === tokens.length) return { end: pos, captures };
  const tok = tokens[ti];
  if (tok.t === 'lit') {
    if (!text.startsWith(tok.v, pos)) return null;
    return walk(tokens, ti + 1, text, pos + tok.v.length, captures);
  }
  if (tok.t === 'group') {
    for (const alt of tok.alts) {
      if (text.startsWith(alt, pos)) {
        const hit = walk(tokens, ti + 1, text, pos + alt.length, captures);
        if (hit) return hit;
      }
    }
    if (tok.optional) return walk(tokens, ti + 1, text, pos, captures);
    return null;
  }
  if (tok.t === 'label') {
    const label = LABELS[text[pos]];
    if (!label) return null;
    return walk(tokens, ti + 1, text, pos + 1, captures.concat([label]));
  }
  if (tok.t === 'han') {
    let run = 0;
    while (pos + run < text.length && HAN_1.test(text[pos + run])) run++;
    if (run < tok.min) return null;
    const limit = Math.min(run, tok.max);
    for (let take = limit; take >= tok.min; take--) {
      const cap = text.slice(pos, pos + take);
      if (tok.nameOk === true) { if (!ACCEPT_NAME || !ACCEPT_NAME(cap)) continue; }
      else if (tok.allowWhole === true) {
        // <p>: từ thường nhường VP, NHƯNG capture NGUYÊN là key VP thì nhận
        // (quan hệ '爷爷/妹妹'... trong luật X的Y là danh từ, không phải rác).
        if (REJECT_CAPTURE && REJECT_CAPTURE(cap) && !ACCEPT_WHOLE(cap)) continue;
      }
      else if (tok.free !== true && REJECT_CAPTURE && REJECT_CAPTURE(cap)) continue;   // <e> từ thường nhường VP; <w> tự do
      const hit = walk(tokens, ti + 1, text, pos + take, captures.concat([cap]));
      if (hit) return hit;
    }
    return null;
  }
  const pred = tok.t === 'num' ? isNumChar : isDigitChar;
  let run = 0;
  while (pos + run < text.length && pred(text[pos + run])) run++;
  if (pos + run < text.length && pred(text[pos + run])) return null; // chuỗi số dài hơn max
  if (run < tok.min) return null;
  const limit = Math.min(run, tok.max);
  for (let take = limit; take >= tok.min; take--) {
    const value = text.slice(pos, pos + take);
    const conv = tok.t === 'num' ? chineseNumberToArabic(value) : digitByDigit(value);
    if (!conv) continue;
    const hit = walk(tokens, ti + 1, text, pos + take, captures.concat([conv]));
    if (hit) return hit;
  }
  return null;
}

function render(parts, captures) {
  let out = '';
  for (const p of parts) out += p.ref === undefined ? p.lit : (captures[p.ref] ?? '');
  return out;
}

function createRuleEngine(ruleText, opts = {}) {
  const { rules, stats } = parseRules(ruleText);
  // rejectCapture: (chuỗi) => true nếu chuỗi KHÔNG được phép làm {0} — dùng để chặn
  // <e> nuốt TỪ THƯỜNG có nghĩa trong VP/sup (LuatNhan {0} là TÊN RIÊNG): '厉害'
  // có nghĩa → rule '个很<e>的人' nhường cho VP/sup đường cũ.
  REJECT_CAPTURE = opts.rejectCapture || null;
  ACCEPT_NAME = opts.acceptName || null;
  ACCEPT_WHOLE = opts.acceptWhole || null;
  const direct = new Map();
  const anchors = new Map();
  let maxLookahead = 0;

  for (const rule of rules) {
    const first = rule.tokens[0];
    if (first.t === 'lit') pushIndex(direct, first.v[0], rule);
    else if (first.t === 'group' && !first.optional) for (const alt of first.alts) pushIndex(direct, alt[0], rule);
    else {
      let min = 0, max = 0, anchorToken = null;
      for (const tok of rule.tokens) {
        if (tok.t === 'lit') { anchorToken = { v: tok.v }; break; }
        if (tok.t === 'group' && !tok.optional) { anchorToken = { v: tok.alts[0], alts: tok.alts }; break; }
        if (tok.t === 'label') { min += 1; max += 1; continue; }
        if (tok.min == null || tok.max == null) continue;   // group (a|b)? — không có min/max
        min += tok.min; max += tok.max;
      }
      if (!anchorToken) continue;
      if (Number.isFinite(max)) maxLookahead = Math.max(maxLookahead, max);
      const keys = anchorToken.alts ? anchorToken.alts.map(a => a[0]) : [anchorToken.v[0]];
      for (const key of keys) {
        if (!anchors.has(key)) anchors.set(key, []);
        anchors.get(key).push({ rule, min, max });
      }
    }
  }

  function pushIndex(map, key, rule) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rule);
  }

  // Trả về { end, text } nếu có rule khớp tại start, ngược lại null.
  function matchAt(text, start, __dbg) {
    const candidates = (direct.get(text[start]) || []).slice();
    if (anchors.size && maxLookahead) {
      const seen = new Set(candidates);
      for (const item of anchors.get(text[start]) || []) {
        if (!seen.has(item.rule)) { seen.add(item.rule); candidates.push(item.rule); }
      }
      const limit = Math.min(maxLookahead, text.length - start - 1);
      for (let offset = 1; offset <= limit; offset++) {
        const list = anchors.get(text[start + offset]);
        if (!list) continue;
        for (const item of list) {
          if (offset < item.min || offset > item.max || seen.has(item.rule)) continue;
          seen.add(item.rule);
          candidates.push(item.rule);
        }
      }
    }
    if (candidates.length > 1) candidates.sort((a, b) => a.order - b.order);
    for (const rule of candidates) {
      if (__dbg) console.log("cand", rule.pattern);
      const hit = walk(rule.tokens, 0, text, start, []);
      if (__dbg && hit) console.log("hit", JSON.stringify(hit));
      if (!hit || hit.end === start) continue;
      return { end: hit.end, text: render(rule.parts, hit.captures), rule: rule.pattern, strong: !!rule.strong, parts: rule.parts, captures: hit.captures };
    }
    return null;
  }

  return { matchAt, count: rules.length, stats, __ANCHORS: anchors, __DIRECT: direct, __MAXLOOK: maxLookahead };
}

return { parseRules, createRuleEngine };
})();

// ---- translate.js ----
const M_translate = (() => {
// Pipeline convert Trung -> Việt: punct -> 繁→簡 -> rule -> name -> VP -> PA -> ghép/tua hoa.
// Khong dong DOM o day; chay duoc trong Node lan trong trinh duyet.

const { toSimplified } = M_t2s;
const { firstMeaning, cleanMeaning, maxKeyLength } = M_dict;

const PUNCT_MAP = {
  '，': ',', '、': ',', '。': '.', '．': '.', '？': '?', '！': '!',
  '；': ';', '：': ':', '（': '(', '）': ')', '【': '[', '】': ']',
  '“': '"', '”': '"', '「': '"', '」': '"', '『': '"', '』': '"',
  '‘': "'", '’': "'", '—': '-', '－': '-', '…': '...'
};
const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/;
const LETTER_RE = /[\p{L}]/u;
const OPEN = new Set('([「《〈"\'');
const CLOSE_NO_SPACE = new Set('.,!?:;)]}》〉"\'');

function normalizePunct(text) {
  let out = '';
  for (const ch of text) {
    if (PUNCT_MAP[ch] !== undefined) out += PUNCT_MAP[ch];
    else if (ch === '　' || ch === '\xa0') out += ' ';
    else out += ch;
  }
  return out;
}

function needsSpace(a, b) {
  if (!a || !b) return false;
  if (OPEN.has(a)) return false;
  if (CLOSE_NO_SPACE.has(b)) return false;
  if (a === '.' || a === '!' || a === '?' || a === ',' || a === ';' || a === ':') return true;
  if (a === '-' && b === '-') return false;
  const la = LETTER_RE.test(a), lb = LETTER_RE.test(b);
  const da = /[0-9]/.test(a), db = /[0-9]/.test(b);
  if ((la || da) && (lb || db)) return true;
  return false;
}

function autoUpperCase(text) {
  return text.replace(/(^|[.!?]\s+|\n+\s*)([a-zà-ỹả~])/g, (m, pre, ch) => pre + ch.toLocaleUpperCase('vi'));
}

function createEngine(dicts, settings = {}) {
  const opt = {
    firstMeaning: true,
    separator: '/',
    useRules: true,
    useNames: true,
    skipParticles: false,
    ...settings
  };
  const { pa, vp, names, t2s } = dicts;
  const overrides = dicts.overrides && dicts.overrides.size ? dicts.overrides : null;
  const ovMax = overrides ? maxKeyLength(overrides) : 0;
  // Supplement dict: lớp bổ trợ gắn theo gói (sửa order/mục thiếu của dict cộng đồng),
  // thấp hơn override của user, cao hơn rule/Names/VP/PA.
  const supplement = dicts.supplement && dicts.supplement.size ? dicts.supplement : null;
  const supMax = supplement ? maxKeyLength(supplement) : 0;
  // Glossary RIÊNG theo từng truyện (F4): từ điển nhỏ user nhập cho một sách, THẮNG từ
  // điển gốc (VP/Names/rules) nhưng thua override toàn cục. Engine nhận dict "glossary"
  // theo bookKey của trang đang dịch (background/offscreen chọn lớp đúng).
  const glossary = dicts.glossary && dicts.glossary.size ? dicts.glossary : null;
  const glMax = glossary ? maxKeyLength(glossary) : 0;
  const ruleEngine = opt.useRules && dicts.rules ? dicts.rules : null;
  // MaxKeyLength tính sẵn từ lúc parse (offscreen gửi kèm): rebuild sau mỗi lần Lưu
  // không phải quét lại hơn 1 triệu key (~200ms + đỉnh cấp phát) nữa.
  const vpMax = dicts.vpMax || maxKeyLength(vp);
  const namesMax = names && names.size ? (dicts.namesMax || maxKeyLength(names)) : 0;
  const PARTICLES = new Set(['的', '了', '着', '著']);

  function vpAt(text, start) {
    const limit = Math.min(vpMax, text.length - start);
    for (let len = limit; len > 1; len--) {
      const key = text.substr(start, len);
      const value = vp.get(key);
      if (value !== undefined) return { key, value, len };
    }
    const one = vp.get(text[start]);
    if (one !== undefined) return { key: text[start], value: one, len: 1 };
    return null;
  }

  function longestVPLen(text, start) {
    const hit = vpAt(text, start);
    return hit ? hit.len : 0;
  }

  function nameAt(text, start) {
    if (!opt.useNames || !namesMax) return null;
    const limit = Math.min(namesMax, text.length - start);
    for (let len = limit; len > 1; len--) {
      const key = text.substr(start, len);
      const value = names.get(key);
      if (value !== undefined) return { key, value, len };
    }
    return null;
  }

  // Layer override (từ điển vá của user): tra TRƯỚC mọi tầng để ý của user luôn thắng
  // rule/Names/VP/PA. Key là chữ đã 繁→簡 vì matching chạy trên văn bản đã chuẩn hoá.
  function segmentOverrides(text) {
    if (!ovMax) return [{ kind: 'plain', text }];
    const out = [];
    let plainStart = 0, pos = 0;
    while (pos < text.length) {
      const limit = Math.min(ovMax, text.length - pos);
      let hit = null;
      for (let len = limit; len >= 1; len--) {
        const value = overrides.get(text.substr(pos, len));
        if (value !== undefined) { hit = { value, len }; break; }
      }
      if (hit) {
        if (plainStart < pos) out.push({ kind: 'plain', text: text.slice(plainStart, pos) });
        out.push({ kind: 'ov', text: hit.value, han: text.slice(pos, pos + hit.len) });
        pos += hit.len;
        plainStart = pos;
        continue;
      }
      pos++;
    }
    if (plainStart < text.length) out.push({ kind: 'plain', text: text.slice(plainStart) });
    return out;
  }

  // Layer glossary per-book (F4): tra NGAY SAU override toàn cục, TRƯỚC supplement/
  // rule/Names/VP/PA -> từ điển riêng của truyện thắng từ điển gốc.
  function segmentGlossary(text) {
    if (!glossary) return [{ kind: 'plain', text }];
    const out = [];
    let plainStart = 0, pos = 0;
    while (pos < text.length) {
      const limit = Math.min(glMax, text.length - pos);
      let hit = null;
      for (let len = limit; len >= 1; len--) {
        const value = glossary.get(text.substr(pos, len));
        if (value !== undefined) { hit = { value, len }; break; }
      }
      if (hit) {
        if (plainStart < pos) out.push({ kind: 'plain', text: text.slice(plainStart, pos) });
        out.push({ kind: 'gl', text: hit.value, han: text.slice(pos, pos + hit.len) });
        pos += hit.len;
        plainStart = pos;
        continue;
      }
      pos++;
    }
    if (plainStart < text.length) out.push({ kind: 'plain', text: text.slice(plainStart) });
    return out;
  }

  // Layer supplement (đi kèm gói): tra sau override của user, trước rule/Names/VP/PA.
  // Key là chữ đã 繁→簡 vì matching chạy trên văn bản đã chuẩn hoá.
  function segmentSupplement(text) {
    if (!supplement) return [{ kind: 'plain', text }];
    const out = [];
    let plainStart = 0, pos = 0;
    while (pos < text.length) {
      const limit = Math.min(supMax, text.length - pos);
      let hit = null;
      for (let len = limit; len >= 1; len--) {
        const value = supplement.get(text.substr(pos, len));
        if (value !== undefined) { hit = { value, len }; break; }
      }
      if (hit) {
        if (plainStart < pos) out.push({ kind: 'plain', text: text.slice(plainStart, pos) });
        out.push({ kind: 'sup', text: hit.value, han: text.slice(pos, pos + hit.len) });
        pos += hit.len;
        plainStart = pos;
        continue;
      }
      pos++;
    }
    if (plainStart < text.length) out.push({ kind: 'plain', text: text.slice(plainStart) });
    return out;
  }

  function segmentRules(text) {
    if (!ruleEngine) return [{ kind: 'plain', text }];
    const out = [];
    let plainStart = 0, pos = 0;
    while (pos < text.length) {
      const hit = ruleEngine.matchAt(text, pos);
      // Rule thường chỉ thắng VP khi DÀI hơn; rule mạnh ("!" đầu dòng trong rule.txt)
      // thắng cả khi HOÀ độ dài — dữ liệu 第X章 trong VP có ~15% mục sai số, rule tính
      // số chuẩn luôn đúng nên phải thắng khi hoà.
      if (hit && (hit.strong || longestVPLen(text, pos) < hit.end - pos)) {
        if (plainStart < pos) out.push({ kind: 'plain', text: text.slice(plainStart, pos) });
        // Template {n} của luật nhân: capture PHẢI được DỊCH TIẾP (nghĩa VP đầu
        // tiên; thiếu thì phiên âm Hán Việt) — '{0} của hắn' với {0}='爷爷' ra
        // 'ông của hắn', không giữ Hán.
        let vi = hit.text;
        if (hit.parts && hit.captures && hit.parts.some(p => p.ref !== undefined)) {
          vi = hit.parts.map(p => {
            if (p.ref === undefined) return p.lit;
            const cap = hit.captures[p.ref] ?? '';
            if (!cap) return '';
            // Viết hoa phiên âm Hán-Việt khi capture là TÊN RIÊNG: nghĩa VP nguyên
            // bắt đầu chữ hoa ('陆鸣'->'Lục Minh') hoặc cụm không trong VP ('章岳'
            // -> 'Chương Nhạc'). Cụm thường ('两人口中') không đi đường này.
            const whole = vp.get(cap);
            const isName = whole !== undefined
              ? /^[A-ZÀÁẰẲẴẸĂẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]/.test(whole.split('/')[0].trim())
              : [...cap].length >= 2;
            const render = s => isName
              ? s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ')
              : s;
            if (whole !== undefined) return render(whole.split('/')[0].trim());
            if ([...cap].length >= 2) return render(phienOf(cap));   // không VP nguyên: phiên âm TOÀN capture
            const one = vpAt(cap, 0);
            return one ? render(one.value.split('/')[0].trim()) : phienOf(cap);
          }).join('');
        }
        out.push({ kind: 'rule', text: vi, han: text.slice(pos, hit.end) });
        pos = hit.end;
        plainStart = pos;
        continue;
      }
      pos++;
    }
    if (plainStart < text.length) out.push({ kind: 'plain', text: text.slice(plainStart) });
    return out;
  }

  function segmentNames(text) {
    const out = [];
    let plainStart = 0, pos = 0;
    while (pos < text.length) {
      const hit = nameAt(text, pos);
      if (hit) {
        // Trọng tài Names-vs-VP (giống userscript GPL tham chiếu): nếu VP có mục
        // tại đúng vị trí này dài >= tên thì nhường VP — không thì cụm VP chứa
        // chuỗi trùng tên bị tên cắt vụn (负能量 vỡ thành 负+能量 vì Names có 能量).
        let vpLen = 0;
        const vpLimit = Math.min(vpMax, text.length - pos);
        for (let len = vpLimit; len >= hit.len; len--) {
          if (vp.get(text.substr(pos, len)) !== undefined) { vpLen = len; break; }
        }
        if (vpLen >= hit.len) { pos++; continue; }
        if (plainStart < pos) out.push({ kind: 'plain', text: text.slice(plainStart, pos) });
        out.push({ kind: 'name', text: hit.value, han: hit.key });
        pos += hit.len;
        plainStart = pos;
        continue;
      }
      pos++;
    }
    if (plainStart < text.length) out.push({ kind: 'plain', text: text.slice(plainStart) });
    return out;
  }

  function tokenizePlain(text) {
    const tokens = [];
    let pos = 0;
    while (pos < text.length) {
      const hit = vpAt(text, pos);
      if (hit) {
        const value = opt.firstMeaning ? firstMeaning(hit.value, opt.separator) : hit.value;
        // `raw` = TOÀN BỘ danh sách nghĩa gốc (chưa cắt bởi firstMeaning) — card sửa
        // nghĩa hiển thị đủ các lựa chọn cách nhau '/'; token rửa/sort không đụng nó.
        tokens.push({ han: hit.key, vi: value, kind: hit.len > 1 ? 'vp' : 'vp1', raw: cleanMeaning(hit.value) || value });
        pos += hit.len;
        continue;
      }
      const ch = text[pos];
      if (!HAN_RE.test(ch)) {
        let end = pos;
        while (end < text.length && !HAN_RE.test(text[end])) end++;
        const run = text.slice(pos, end);
        tokens.push({ han: run, vi: run, kind: 'raw' });
        pos = end;
        continue;
      }
      if (opt.skipParticles && PARTICLES.has(ch)) { pos++; continue; }
      const paValue = pa.get(ch);
      tokens.push({ han: ch, vi: paValue || ch, kind: 'pa' });
      pos++;
    }
    return tokens;
  }

  function translate(source) {
    const original = String(source || '').normalize('NFC');
    if (!original.trim() || !HAN_RE.test(original)) return { vi: original, tokens: [], spans: [], stats: null };

    const simplified = toSimplified(normalizePunct(original), t2s);
    let tokens = [];
    // THỨ TỰ LỚP: ov > gl > supplement > RULES > names > VP/PA. Supplement trước
    // rules: sup ('很', '点'...) xẻ nghĩa nhỏ ở vị trí ĐÚNG; rule (LuatNhan strong)
    // chỉ thắng khi còn khớp TRỌN đoạn không bị sup chia (hoặc hoà VP nhờ strong —
    // LuatNhan cụm chuẩn hơn ghép VP rời).
    for (const piece of segmentOverrides(simplified)) {
      if (piece.kind === 'ov') { tokens.push({ han: piece.han, vi: piece.text, kind: 'ov' }); continue; }
      for (const gseg of segmentGlossary(piece.text)) {
        if (gseg.kind === 'gl') { tokens.push({ han: gseg.han, vi: gseg.text, kind: 'gl' }); continue; }
        for (const seg of segmentSupplement(gseg.text)) {
          if (seg.kind === 'sup') { tokens.push({ han: seg.han, vi: opt.firstMeaning ? firstMeaning(seg.text, opt.separator) : seg.text, kind: 'sup', raw: cleanMeaning(seg.text) || seg.text }); continue; }
          for (const part of segmentRules(seg.text)) {
            if (part.kind === 'rule') { tokens.push({ han: part.han, vi: part.text, kind: 'rule' }); continue; }
            for (const sub of segmentNames(part.text)) {
              if (sub.kind === 'name') tokens.push({ han: sub.han, vi: sub.text, kind: 'name' });
              else tokens = tokens.concat(tokenizePlain(sub.text));
            }
          }
        }
      }
    }

    // [ĐÃ BỎ] các quy tắc tự tạo quanh 的 (gộp token đơn chữ trước/sau 的 + đảo
    // 'của' + cách gọi): xử lý 的 giờ CHỈ dựa vào LuatNhan ('…的<e>' đã loại,
    // giữ các luật 'X的Y' có trong từ điển luật nhân) + VP/supplement có sẵn.

    // spans[i] = [vi tri trong chuoi vi, chi so token]: dung de map vi tri bam chuot ve token
    // (tokenMap click-to-edit). Toan bo buoc "rua" lam trong vong lap nay tren tung token
    // (`:.`->':', gom khoang trang, viet hoa dau cau) de spans dung tren chuoi cuoi cung -
    // neu rua sau khi ghep thi moi lan rut bot ky tu deu lam spans lech cho cac token phia sau.
    let out = '';
    const spans = [];
    let sentenceStart = true;
    for (let i = 0; i < tokens.length; i++) {
      let vi = tokens[i].vi;
      if (vi === undefined || vi === '') continue;
      vi = vi.replace(/:\./g, ':').replace(/ {2,}/g, ' ')
        // Raw run giữ \n (giữ xuống dòng) nhưng space/thụt đầu dòng SAU \n là khoảng
        // trắng in đầu của đoạn gốc (　　) — HTML không hiển thị nó ở đầu dòng, giữ
        // lại sẽ thành "khoảng trống đầu dòng" trên bản dịch.
        .replace(/\n[\s\u3000]+/g, '\n');
      if (sentenceStart) vi = autoUpperCase(vi);
      else vi = vi.replace(/([.!?]\s+|\n+\s*)([a-zà-ỹả~])/g, (m, pre, ch) => pre + ch.toLocaleUpperCase('vi'));
      tokens[i].vi = vi;   // token trả về phải là nghĩa đã rửa: card click-to-edit hiện đúng những gì đang trên màn hình
      const prev = out[out.length - 1];
      if (needsSpace(prev, vi[0])) {
        out += ' ';
        vi = vi.replace(/^ +/, '');   // space vừa chèn thay cho space đầu token -> không bao giờ có 2 space liền (tương đương rửa toàn cục cũ)
      }
      if (vi.trim()) spans.push([out.length, i]);   // token whitespace-thuan: không có span (text có thể bị trim mất -> span lac)
      out += vi;
      sentenceStart = /[.!?]\s*$/.test(vi) || /\n\s*$/.test(vi);
    }
    // spans ghi trên chuỗi TRƯỚC trim; nếu trim cắt/gọt thì DỊCH toàn bộ offset
    // (highlight/click-map của content script trỏ nhầm chữ — lỗi "lệch 1 chữ" trên
    // truyện mở đầu đoạn bằng fullwidth space). Tính lượng cắt ở ĐẦU, dồn spans về
    // chuỗi sau trim; đuôi cắt không ảnh hưởng offset nào vì không có span sau nó.
    const cut = out.length - out.trimStart().length;
    if (cut > 0) {
      for (const sp of spans) sp[0] = Math.max(0, sp[0] - cut);
      out = out.trimStart();
    }
    out = out.trimEnd();

    const han = tokens.filter(t => HAN_RE.test(t.han));
    const stats = {
      hanChars: han.reduce((n, t) => n + [...t.han].length, 0),
      phraseChars: han.filter(t => [...t.han].length > 1).reduce((n, t) => n + [...t.han].length, 0),
      paChars: tokens.filter(t => t.kind === 'pa').reduce((n, t) => n + [...t.han].length, 0)
    };
    return { vi: out, tokens, spans, stats };
  }

  // Âm Hán Việt TỪNG CHỮ cho card sửa (F-âm): đọc từ lớp pa (ChinesePhienAmWords.txt).
  // '一' -> 'nhất'; chữ không có trong pa thì trả về chính nó (card tự ẩn dòng này).
  function phienOf(han) {
    let out = '';
    for (const ch of String(han || '')) {
      if (!HAN_RE.test(ch)) { out += ch; continue; }
      out += (pa.get(ch) || ch) + ' ';
    }
    return out.trim();
  }

  return { translate, phienOf, vpMax, namesMax, info: { vp: vp.size, names: names ? names.size : 0, pa: pa.size, rules: ruleEngine ? ruleEngine.count : 0, ov: overrides ? overrides.size : 0, gl: glossary ? glossary.size : 0, sup: supplement ? supplement.size : 0 } };
}

return { normalizePunct, createEngine };
})();

// ---- index.js ----
const M_index = (() => {
// Bootstrap: doc dict tu mot thu muc (Node dung fs, trinh duyet dung fetch).
// Tu phat hien ma hoa qua BOM: FF FE -> UTF-16LE, nguoi khac -> UTF-8.

const { parseDict, parseDictBuffer } = M_dict;
const { parseT2S } = M_t2s;
const { createRuleEngine } = M_rules;
const { createEngine } = M_translate;

const FILES = {
  vp: 'VietPhrase.txt',
  names: 'Names.txt',
  pa: 'ChinesePhienAmWords.txt',
  pronouns: 'Pronouns.txt',
  rules: 'rule.txt',
  luatNhan: 'LuatNhan.txt',
  t2s: 'TSCharacters.txt',
  supplement: 'Supplement.txt',
  pack: 'Pack-UuHoa.txt'
};

function decode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function loadEngine(readFile, settings = {}) {
  const t0 = Date.now();
  // Nạp theo KEY (không destructure theo thứ tự values) — thêm file mới không lệch.
  const bufs = {};
  await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
    // Supplement/Pack/LuatNhan là file tùy chọn: thiếu thì engine vẫn chạy với lớp rỗng.
    try { bufs[key] = await readFile(file); } catch { bufs[key] = null; }
  }));

  const vp = parseDict(decode(bufs.vp));
  const names = parseDict(decode(bufs.names));
  const pa = parseDict(decode(bufs.pa), { singleChar: true });
  const pronouns = parseDict(decode(bufs.pronouns));
  const t2s = parseT2S(decode(bufs.t2s));
  // VP/sup nạp trước để kiểm capture <e>: {0} của LuatNhan là TÊN — đoạn có nghĩa
  // trong VP/sup thì rule nhường (tránh '个很<e>的人' nuốt '很厉害' giữ Hán).
  const vpEarly = parseDict(decode(bufs.vp));
  const supEarly = new Map([
    ...(bufs.pack ? parseDict(decode(bufs.pack)) : []),
    ...(bufs.supplement ? parseDict(decode(bufs.supplement)) : [])
  ]);
  const pronounsEarly = parseDict(decode(bufs.pronouns));
  const FUNC_FIRST = '是非乃为即系而这那把被对和与跟从向到让使给有在都也就才又再还很挺蛮但可是不';
  const FUNC_LAST = '中里内间上下前后旁侧边时之者们底';
  const rejectCapture = cap => {
    if (FUNC_FIRST.includes(cap[0])) return true;   // '为陆檬檬' — đầu cụm là động từ/chức năng
    if (vpEarly.has(cap) || supEarly.has(cap) || pronounsEarly.has(cap)) return true;
    // capture CHỨA từ VP/sup >= 2 chữ bên trong → không phải tên thuần → nhường
    for (let i = 0; i + 2 <= cap.length; i++) {
      for (let len = 2; i + len <= cap.length; len++) {
        if (vpEarly.has(cap.slice(i, i + len)) || supEarly.has(cap.slice(i, i + len))) return true;
      }
    }
    // capture chứa ĐẠI TỪ (她/他/它/他们…, 1 chữ là đủ) → danh ngữ đại từ, không phải tên
    for (const ch of cap) {
      if (pronounsEarly.has(ch)) return true;
      // chữ đơn có nghĩa VP (vp1) — từ thường: '普通的水' capture '水'
      if (cap.length === 1 && vpEarly.has(ch)) return true;
    }
    return false;
  };
  // TÊN RIÊNG (cho token <u> của luật '…的…'): nghĩa VP đầu tiên viết HOA
  // ('陆鸣'->'Lục Minh') — cụm thường ('他是'->'hắn là') không phải tên.
  const acceptName = cap => {
    // Chặn chữ ĐẦU CỤM là TỪ CHỨC NĂNG ('是陆鸣' — '是' động từ, không phải tên):
    const FUNC_FIRST = '是非乃为即系而这那把被对和与跟从向到让使给有在都也就才又再还很挺蛮但可是不';
  const FUNC_LAST = '中里内间上下前后旁侧边时之者们底';
    if (FUNC_FIRST.includes(cap[0])) return false;
    if (FUNC_LAST.includes(cap[cap.length - 1])) return false;   // '炼中' — chữ vị trí/thời gian đuôi cụm
    const val = vpEarly.get(cap);
    if (val !== undefined) {
      const first = val.split('/')[0].trim();
      return /^[A-ZÀÁẰẲẴẸĂẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]/.test(first);
    }
    // Không trong VP: chỉ coi là TÊN MẢNH nếu CÁC CHỮ của nó KHÔNG ghép thành từ
    // có nghĩa ('院门哐' chứa '院门'(VP) -> không phải tên; '章岳' -> là tên).
    for (let i = 0; i + 2 <= cap.length; i++) {
      for (let len = 2; i + len <= cap.length; len++) {
        if (vpEarly.has(cap.slice(i, i + len))) return false;
      }
    }
    return cap.length <= 3;
  };
  const acceptWhole = cap => vpEarly.has(cap);
  const rules = createRuleEngine(decode(bufs.rules) + '\n' + (bufs.luatNhan ? decode(bufs.luatNhan) : ''), { rejectCapture, acceptName, acceptWhole });
  // Lớp supplement gộp 2 nguồn: Pack-UuHoa (cộng đồng, nạp trước) < Supplement.txt (bản vá
  // tay của dự án, nạp sau -> thắng khi trùng key). Cả hai nằm dưới override của user.
  const pack = bufs.pack ? parseDict(decode(bufs.pack)) : new Map();
  const supplement = bufs.supplement ? parseDict(decode(bufs.supplement)) : new Map();
  const supplementMerged = new Map([...pack, ...supplement]);

  const engine = createEngine({ pa, vp, names, pronouns, t2s, rules, supplement: supplementMerged }, settings);
  engine.loadMs = Date.now() - t0;
  engine.ruleStats = rules.stats;
  engine.t2sSize = t2s.size;
  engine.supplementSize = supplementMerged.size;
  return engine;
}



return { createEngine, parseDict, parseDictBuffer, parseT2S, createRuleEngine, FILES, decode, loadEngine };
})();

// ---- db.js ----
const M_db = (() => {
// Cache kết quả dịch trong IndexedDB của engine page.
//
// Vì sao cache: mỗi lần mở/reload chương đều gửi lại toàn bộ text node cho engine. Dịch
// nhanh (~40ms/chương) nhưng khi trình duyệt vừa mở, từ điển 34MB chưa nạp xong (~2-5s)
// nên trang hiện chữ Hán rồi mới lật sang Việt. Có cache, chương đã đọc hiện Việt ngay
// cả khi engine còn đang nạp.
//
// Vì sao IndexedDB mà không phải chrome.storage: chrome.storage.local chỉ 10MB, không đủ
// cho hàng chục nghìn bản dịch; `unlimitedStorage` đã có sẵn trong manifest. IndexedDB là
// API web chuẩn (không thuộc chrome.* bị Edge cắt trong engine page — probe README), nếu
// trình duyệt nào vẫn chặn thì tự rơi về Map trong RAM: mất cache khi restart, không mất
// tính năng dịch.

// Tên DB giữ nguyên từ thời "VietPhrase Reader": đổi tên khi lên thương hiệu TuiRead
// sẽ bỏ toàn bộ cache bản dịch đã tích lũy của người đang dùng.
const DB_NAME = 'vietphrase-reader';
const STORE = 'translations';
const MAX_ENTRIES = 30000;   // Trần tổng, vượt thì prune còn lại một nửa lúc khởi động
const MEM_MAX = 8000;        // Trần tầng RAM (L1) để heap offscreen không phình vô hạn

// Tăng khi thay đổi file trong dict/ hoặc cách parse: cache cũ tự chết theo key.
const DICT_VERSION = 20;   // bump: FUNC_LAST chặn đuôi cụm tên (中里内间...) + autosave khong doi textarea

let dbPromise = null;
let mem = new Map();         // key -> entry; L1 cho hit tức thì, đồng thời là fallback
let keyCtx = '';             // ngữ cảnh đặt trước của key: dict version + settings + overrides

function hasIDB() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('khong mo duoc IndexedDB'));
  });
  return dbPromise;
}

// FNV-1a 32-bit: đủ cho key cache, nhanh hơn nhiều so với sha256 trên từng text node.
// Thêm text.length vào key để hai chuỗi khác độ dài khó va nhau hơn nữa.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Xoá TOÀN BỘ cache dịch (store 'translations') + cache mem. Dùng tay từ popup
// ('Xoá cache dịch') — không bao giờ gọi tự động: bump DICT_VERSION là đủ cho các
// thay đổi engine/dict.
async function cacheClear() {
  mem.clear();
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Gọi sau mỗi lần dựng engine (boot / đổi settings / đổi override): mọi key cũ vô nghĩa.
function setKeyContext(parts) {
  keyCtx = parts.join('|');
  mem.clear();
}

function makeKey(text) {
  return keyCtx + ':' + text.length + ':' + fnv1a(text);
}

function memSet(key, value) {
  if (mem.size >= MEM_MAX && !mem.has(key)) mem.delete(mem.keys().next().value);
  mem.set(key, value);
}

// keys: mảng key theo thứ tự -> mảng kết quả, miss = undefined.
async function cacheGet(keys) {
  const out = new Array(keys.length);
  const missing = [];
  keys.forEach((key, i) => {
    if (mem.has(key)) out[i] = mem.get(key);
    else missing.push([key, i]);
  });
  if (missing.length && hasIDB()) {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const store = db.transaction(STORE, 'readonly').objectStore(STORE);
        let done = 0;
        for (const [key, i] of missing) {
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result !== undefined) { out[i] = req.result; memSet(key, req.result); }
            if (++done === missing.length) resolve();
          };
          req.onerror = () => reject(req.error);
        }
      });
    } catch { /* IndexedDB hỏng -> vẫn còn tầng RAM */ }
  }
  return out;
}

// entries: [[key, value], ...]. Ghi RAM trước (hit ngay trong phiên), IDB nền sau.
async function cachePut(entries) {
  for (const [key, value] of entries) memSet(key, value);
  if (!hasIDB()) return;
  try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [key, value] of entries) store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* ghi hỏng thì lần sau dịch lại, không fatal */ }
}

function cacheStats() {
  return { persistent: hasIDB(), mem: mem.size };
}

// Chạy một lần sau mỗi lần dựng engine: cache quá đặc thì xóa bớt nửa còn lại (giữ mới
// nhất theo thứ tự cursor — key không có timestamp thứ tự, chấp nhận xóa lọc đầu bảng).
async function cachePrune(max = MAX_ENTRIES) {
  if (!hasIDB()) return 0;
  try {
    const db = await open();
    const count = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (count <= max) return 0;
    let excess = count - Math.floor(max / 2);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const cursorReq = tx.objectStore(STORE).openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || excess <= 0) return;
        cursor.delete();
        excess--;
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return count;
  } catch { return 0; }
}

return { DICT_VERSION, cacheClear, setKeyContext, makeKey, cacheGet, cachePut, cacheStats, cachePrune };
})();

// ---- offscreen.js (engine host) ----
// Noi engine + tu dien song: mot page extension rieng (offscreen.html):
//   - Firefox: iframe an chen vao background page (khong co chrome.offscreen) — xem background.js.
//   - Chrome/Edge: offscreen document qua chrome.offscreen — xem background.js.
// Khong nam trong heap cua tab, khong bi kill nhu service worker/event page khi dang doc.
//
// KIEN TRUC: file nay TUYET DOI khong cham chrome.storage. Edge 155 khong cap
// chrome.storage (kem tabs/offscreen/runtime.getManifest) cho offscreen document - da do
// bang probe, xem README "Su co hay gap". Moi doc/ghi luu tru di qua background.js
// bang chrome.runtime.sendMessage, thu van chay duoc trong engine page.

const { decode, FILES, parseDict, parseDictBuffer, parseT2S, createRuleEngine, createEngine } = M_index;
const { maxKeyLength } = M_dict;
const { DICT_VERSION, setKeyContext, makeKey, cacheGet, cachePut, cachePrune, cacheStats, cacheClear } = M_db;

// MARKER PHIÊN BẢN ENGINE: in ra console của background/offscreen để xác minh bản
// đang chạy; 'build' kèm trong MỌI response — content/popup cảnh báo khi lệch bản
// (chống 'zombie engine view' sống sót qua Reload add-on trả kết quả cũ).
const ENGINE_BUILD = '0.8.0';
console.log('[TuiRead] engine build ' + ENGINE_BUILD + ' (DICT_VERSION ' + DICT_VERSION + ', có quy tắc 的)');

const DATA = { vp: null, names: null, pa: null, pronouns: null, t2s: null, rules: null, supplement: null };
// MaxKeyLength tính MỘT LẦN lúc parse, rebuild sau đó chỉ dùng lại (mỗi lần Lưu tiết kiệm ~200ms quét 1M key).
const DATA_MAX = {};
let engine = null;
let status = { state: 'loading', message: 'Chưa khởi động' };

// Hộp đen: 15 sự kiện gần nhất (boot, rebuild, dịch batch, save override, lỗi). Đi kèm
// status-push vào chrome.storage nên sau khi restart Edge (ví dụ sau một lần treo) vẫn
// đọc được trong popup/console để biết nó kẹt ở bước nào. Không ghi gì nhạy cảm.
const recentEvents = [];
function noteEvent(text) {
  const t = new Date();
  recentEvents.push(t.toTimeString().slice(0, 8) + '.' + String(t.getMilliseconds()).padStart(3, '0') + ' ' + text);
  if (recentEvents.length > 15) recentEvents.shift();
}

// Layer override (từ điển vá của user): nạp từ background lúc boot, cập nhật qua vp:overrides.
let overridesMap = new Map();
let overridesVersion = 0;
// Glossary RIÊNG theo truyện (F4): { bookKey: { han: vi } } nạp một lần; khi dịch thì
// background gửi kèm bookKey -> engine dựng lớp đúng cho sách đó (lưu theo bookKey).
let glossariesMap = {};
let glossariesVersion = 0;
let supplementHash = '';
// Engine đang áp dụng bookKey nào (do background gửi kèm vp:translate/vp:tokens).
let appliedBookKey = '';
// Tối đa 4 engine song song (4 truyện đang đọc xen kẽ); quá thì bỏ engine cũ nhất.
const engineByBook = new Map();
const ENGINE_CACHE_MAX = 4;

// Thu tu nap: file nho truoc de engine co the tra loi som, file 36MB cuoi cung.
// File bự (vp, names) parse STREAMING từ buffer: không giữ mảng ~1 triệu dòng trong RAM
// cùng lúc → đỉnh bộ nhớ lúc boot/rebuild thấp hơn rõ (máy ít RAM trống không "ngộp").
const LOAD_ORDER = [
  { key: 't2s', file: FILES.t2s, label: 'Bảng 繁→簡', parse: text => parseT2S(text) },
  { key: 'rules', file: FILES.rules, label: 'Rule QuickTranslate', parse: text => createRuleEngine(text) },
  { key: 'luatNhan', file: FILES.luatNhan, label: 'Luật nhân (LuatNhan)', parse: text => text },
  { key: 'pa', file: FILES.pa, label: 'Phiên âm Hán Việt', parse: text => parseDict(text, { singleChar: true }) },
  { key: 'pronouns', file: FILES.pronouns, label: 'Đại từ', parse: text => parseDict(text) },
  { key: 'pack', file: FILES.pack, label: 'Pack-UuHoa (cộng đồng)', parse: text => parseDict(text), optional: true },
  { key: 'supplement', file: FILES.supplement, label: 'Supplement dict', parse: text => parseDict(text), optional: true },
  { key: 'names', file: FILES.names, label: 'Tên riêng', parse: (text, buffer) => parseDictBuffer(buffer), maxKey: 'namesMax' },
  { key: 'vp', file: FILES.vp, label: 'VietPhrase (1.01 triệu mục từ)', parse: (text, buffer) => parseDictBuffer(buffer), maxKey: 'vpMax' }
];

// Chi nhung settings nay doi thi engine phai dung lai; mode/translateChrome la chuyen cua content.
const ENGINE_KEYS = ['firstMeaning', 'skipParticles', 'useRules', 'useNames'];

const CAN_ASK_SW = !!(typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function');

// Goi background, co tran: event page/SW bi unload sau khi idle la dung thoi quy cua MV3,
// va background ngu khong duoc phep lam engine page treo.
function askSW(message, timeoutMs = 5000) {
  if (!CAN_ASK_SW) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      chrome.runtime.sendMessage(message, response => {
        finish(chrome.runtime.lastError ? null : (response || null));
      });
    } catch {
      finish(null);
    }
  });
}

function setStatus(next) {
  if (next && next.message && next.state) noteEvent('status: ' + next.message);
  status = { ...status, ...next, recent: [...recentEvents] };
  // Day sang background de no viet chrome.storage giup (popup doc tu do).
  if (CAN_ASK_SW) { try { chrome.runtime.sendMessage({ type: 'vp:status-push', status }, () => {}); } catch { /* SW ngu */ } }
}

// Nap tung file mot, co timeout. Ban dau dung Promise.all(6 fetch) -> keo 34MB dong nghit,
// offscreen ket o buoc doc va popup chi con hiện "Đang đọc từ điển" mãi mãi.
async function fetchDict(name, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(chrome.runtime.getURL('dict/' + name), { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buffer = await res.arrayBuffer();
    if (!buffer || buffer.byteLength < 100) throw new Error('file rong (' + (buffer ? buffer.byteLength : 0) + ' byte)');
    return buffer;
  } catch (err) {
    const why = err && err.name === 'AbortError' ? 'het thoi gian cho ' + timeoutMs / 1000 + 's' : String(err && err.message || err);
    throw new Error('dict/' + name + ': ' + why);
  } finally {
    clearTimeout(timer);
  }
}

async function loadData() {
  if (DATA.vp && DATA.rules) return 0;
  const t0 = Date.now();
  const total = LOAD_ORDER.length;
  for (let i = 0; i < total; i++) {
    const step = LOAD_ORDER[i];
    if (DATA[step.key]) continue;
    setStatus({ state: 'loading', message: `Đang đọc ${i + 1}/${total}: ${step.label} (${step.file})`, progress: (i / total) });
    let buffer;
    try {
      buffer = await fetchDict(step.file);
    } catch (err) {
      if (!step.optional) throw err;
      buffer = new TextEncoder().encode('');   // file tùy chọn vắng mặt → lớp rỗng, không chặn boot
    }
    const text = decode(buffer);
    setStatus({ state: 'loading', message: `Đang phân tích ${i + 1}/${total}: ${step.label}`, progress: (i + 0.5) / total });
    DATA[step.key] = step.parse(text, buffer);
    DATA[step.key + 'Bytes'] = buffer.byteLength;
    if (step.maxKey) DATA_MAX[step.maxKey] = maxKeyLength(DATA[step.key]);
    if (step.key === 'supplement') supplementHash = fnv1a(text);
  }
  return Date.now() - t0;
}

// FNV-1a 32-bit — đủ để phát hiện Supplement.txt đổi nội dung (file chỉ vài KB, phí ~0).
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
}

// Settings duoc cache sau lan hoi background thanh cong, de lan sau van chay duoc
// neu background ngu ma ta kip danh thuc.
let settingsCache = {};

function sameEngineSettings(a, b) {
  return ENGINE_KEYS.every(key => String(a[key] === undefined ? '' : a[key]) === String(b[key] === undefined ? '' : b[key]));
}

async function fetchSettings() {
  const got = await askSW({ type: 'vp:get-settings' });
  if (got && got.ok && got.settings) {
    settingsCache = got.settings;
    return { settings: got.settings, fromWorker: true, store: got };
  }
  return { settings: settingsCache, fromWorker: false, store: null };
}

let appliedEngineSettings = {};
let appliedOverridesVersion = -1;
let userRulesVersion = 0;   // luật nhân của user (options) — version đưa vào key cache

// Luật nhân của user (options page): đọc từ store QUA background (kiến trúc: offscreen
// không chạm chrome.storage), trả về chuỗi luật nối vào LuatNhan. Luật user thắng
// LuatNhan khi cùng khớp vì nối SAU (matchAt gộp lấy khớp dài hơn; cùng dài → a=extra
// gồm cả user rules — thứ tự trong chuỗi quyết định candidates). Cache TEXT một lần
// cho tới khi version đổi — rebuild chỉ parse lại khi user thực sự sửa luật.
let userRulesCache = { version: -1, text: '' };
async function loadUserRulesText() {
  const got = await askSW({ type: 'vp:get-settings' });
  const store = got && got.ok ? got : null;
  const version = store ? (store.userRulesVersion || 0) : 0;
  if (userRulesCache.version === version && userRulesCache.text) return userRulesCache.text;
  const map = store ? (store.userRules || {}) : {};
  // {0} trong luật user là cú pháp NGƯỜI DÙNG — engine hiểu <e> (run Hán 1..8).
  // Pattern user có thể viết chữ PHỔNG (名為) — matchAt chạy trên text GIẢN THỂ
  // nên chuyển T2S trước qua bảng DATA.t2s (per-char).
  const t2sMap = DATA.t2s || new Map();
  const simplify = s => [...s].map(ch => t2sMap.get(ch) || ch).join('');
  const lines = Object.entries(map).map(([pat, vi]) =>
    simplify(pat).replace(/\{(\d+)\}/g, (_, n) => (n === '0' ? '<e>' : `{${n}}`)) + '=' + vi
  ).join('\n');
  userRulesCache = { version, text: lines };
  return lines;
}
function buildUserRulesText() {
  return userRulesCache.text || '';
}

// Gộp LuatNhan vào rule engine: dựng engine phụ rồi hợp rules (LuatNhan thắng khi
// cùng key anchor — nối sau). Không đụng rule.txt trên đĩa.
function mergeLuatNhan(ruleEngine, luatNhanText) {
  if (!ruleEngine || !luatNhanText) return ruleEngine;
  try {
    // rejectCapture giống engine/index.js: capture <e> của LuatNhan là TÊN —
    // từ thường có nghĩa trong VP/supplement thì rule nhường.
    const rejectCapture = cap => {
      if (FUNC_FIRST.includes(cap[0])) return true;
      if (DATA.vp.has(cap) || (DATA.supplement && DATA.supplement.has(cap)) || (DATA.pronouns && DATA.pronouns.has(cap))) return true;
      for (let i = 0; i + 2 <= cap.length; i++) {
        for (let len = 2; i + len <= cap.length; len++) {
          if (DATA.vp.has(cap.slice(i, i + len)) || (DATA.supplement && DATA.supplement.has(cap.slice(i, i + len)))) return true;
        }
      }
      for (const ch of cap) {
        if (DATA.pronouns && DATA.pronouns.has(ch)) return true;
        if (cap.length === 1 && DATA.vp.has(ch)) return true;
      }
      return false;
    };
    const FUNC_FIRST = '是非乃为即系而这那把被对和与跟从向到让使给有在都也就才又再还很挺蛮但可是不';
    const FUNC_LAST = '中里内间上下前后旁侧边时之者们底';
    const acceptName = cap => {
      if (FUNC_FIRST.includes(cap[0])) return false;   // '是陆鸣' — động từ đứng đầu, không phải tên
      if (FUNC_LAST.includes(cap[cap.length - 1])) return false;   // '炼中' — chữ vị trí/thời gian đuôi cụm
      const val = DATA.vp.get(cap);
      if (val !== undefined) {
        return /^[A-ZÀÁẰẲẴẸĂẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]/.test(val.split('/')[0].trim());
      }
      // Không trong VP: chỉ là TÊN MẢNH khi không ghép được từ VP nào (≥2 chữ)
      for (let i = 0; i + 2 <= cap.length; i++) {
        for (let len = 2; i + len <= cap.length; len++) {
          if (DATA.vp.has(cap.slice(i, i + len))) return false;
        }
      }
      return cap.length <= 3;
    };
    const acceptWhole = cap => DATA.vp.has(cap);
    const extra = createRuleEngine(luatNhanText, { rejectCapture, acceptName, acceptWhole });
    if (!extra || !extra.count) return ruleEngine;
    return {
      matchAt(text, pos) {
        const a = extra.matchAt(text, pos);
        const b = ruleEngine.matchAt(text, pos);
        // Cả 2 khớp: lấy khớp DÀI HƠN (end lớn) — cụm cụ thể thắng run chữ Hán chung.
        if (a && b) return a.end >= b.end ? a : b;
        return a || b;
      },
      count: ruleEngine.count + extra.count,
      stats: ruleEngine.stats
    };
  } catch { return ruleEngine; }
}

// Key cache phải chết khi bất cứ thứ gì đổi kết quả dịch: dict, supplement, settings ảnh hưởng engine,
// và layer override (bump version mỗi lần user vá một từ).
function cacheContextParts(settings) {
  return [
    'v' + DICT_VERSION,
    'sup' + (supplementHash || 0),
    'ov' + overridesVersion,
    'gl' + glossariesVersion,
    'ur' + userRulesVersion,
    ...ENGINE_KEYS.map(key => key.charAt(0) + String(settings[key] === undefined ? '' : settings[key]))
  ];
}

async function rebuild(reason) {
  noteEvent('rebuild(' + reason + ') bắt đầu');
  const t0 = Date.now();
  const parsedMs = await loadData();
  await loadUserRulesText();   // luật nhân của user (nếu đổi) — cache theo version
  const { settings, fromWorker, store } = await fetchSettings();
  // Rebuild do override/glossary/settings đổi -> engine-per-book đều stale, xoá sạch.
  // (Rebuild do đổi sách chỉ chuyển appliedBookKey, không tới đây.)
  if (engineByBook.size && !String(reason).startsWith('book:')) engineByBook.clear();
  if (store) {
    overridesMap = new Map(Object.entries(store.overrides || {}));
    overridesVersion = store.overridesVersion || 0;
    glossariesMap = store.glossaries || {};
    glossariesVersion = store.glossariesVersion || 0;
    userRulesVersion = store.userRulesVersion || 0;
  }
  setKeyContext(cacheContextParts(settings));
  setStatus({ state: 'loading', message: 'Đang dựng engine (lập chỉ mục cụm từ)...', progress: 0.95 });
  // Gộp lớp supplement: Pack-UuHoa (cộng đồng) < Supplement.txt (bản vá tay thắng khi trùng key).
  const supplementMerged = new Map([...(DATA.pack || []), ...(DATA.supplement || [])]);
  // Cache engine theo bookKey: mỗi sách có glossary riêng (F4) -> mỗi sách một engine
  // (dict dùng chung, chỉ lớp glossary khác nhau; VP/names parse một lần nên rẻ).
  const bookKey = typeof appliedBookKey === 'string' ? appliedBookKey : '';
  const bookEngineKey = bookKey || '(chung)';
  if (engineByBook.has(bookEngineKey) && sameEngineSettings(appliedEngineSettings, settings)) {
    engine = engineByBook.get(bookEngineKey);
    setStatus({
      state: 'ready', message: 'Sẵn sàng (engine sách "' + bookEngineKey + '")', progress: 1,
      info: engine.info, overrides: { count: overridesMap.size, version: overridesVersion },
      glossaries: { count: Object.keys(glossariesMap).length, version: glossariesVersion },
      settingsSource: fromWorker ? 'background' : 'cache/mac-dinh'
    });
    return engine;
  }
  const glossary = new Map(Object.entries(glossariesMap[bookEngineKey] || {}));
  engine = createEngine(
    { pa: DATA.pa, vp: DATA.vp, names: DATA.names, pronouns: DATA.pronouns, t2s: DATA.t2s, rules: mergeLuatNhan(DATA.rules, [DATA.luatNhan, buildUserRulesText()].filter(Boolean).join('\n')), overrides: overridesMap, glossary, supplement: supplementMerged, vpMax: DATA_MAX.vpMax, namesMax: DATA_MAX.namesMax },
    settings
  );
  engineByBook.set(bookEngineKey, engine);
  while (engineByBook.size > ENGINE_CACHE_MAX) {
    const oldest = engineByBook.keys().next().value;
    engineByBook.delete(oldest);
  }
  appliedEngineSettings = settings;
  appliedOverridesVersion = overridesVersion;
  const loadMs = Date.now() - t0;
  noteEvent('rebuild(' + reason + ') xong ' + loadMs + 'ms (parse ' + parsedMs + 'ms)');
  cachePrune();   // nền: dọn cache quá đặc, không chặn trả lời
  setStatus({
    state: 'ready',
    message: 'Sẵn sàng',
    progress: 1,
    loadMs,
    parsedMs,
    rebuiltFor: reason,
    info: engine.info,
    rules: { active: DATA.rules.count, unsupported: DATA.rules.stats.skippedUnsupported, invalid: DATA.rules.stats.skippedInvalid },
    t2s: DATA.t2s.size,
    bytes: { vp: DATA.vpBytes, names: DATA.namesBytes, supplement: DATA.supplementBytes },
    cache: cacheStats(),
    overrides: { count: overridesMap.size, version: overridesVersion },
    glossaries: { count: Object.keys(glossariesMap).length, version: glossariesVersion },
    book: bookEngineKey,
    settingsSource: fromWorker ? 'background' : 'cache/mac-dinh',
    warning: fromWorker ? null : 'Background không trả lời — engine dùng settings cache hoặc mặc định'
  });
  return engine;
}

// Mọi rebuild đi qua MỘT chuỗi promise: save override trong lúc boot, hoặc save liên tiếp
// (user vá nhiều từ nhanh) không được phép dựng 2 engine song song — đó là chỗ cấp phát
// đỉnh và jank dễ biến thành cảm giác "treo" trên máy ít RAM trống.
let rebuildChain = Promise.resolve();
function rebuildSerialized(reason) {
  const run = rebuildChain.then(() => rebuild(reason));
  rebuildChain = run.then(() => undefined, () => undefined);   // chuỗi sống tiếp dù lần trước lỗi
  return run;
}

let booting = null;
function boot() {
  if (!booting) booting = rebuildSerialized('boot').finally(() => { setTimeout(() => { booting = null; }, 0); });
  return booting;
}

function fail(err) {
  const message = String(err && err.message || err);
  noteEvent('LỖI: ' + message);
  console.error('[TuiRead offscreen]', message);
  setStatus({ state: 'error', message: 'Lỗi nạp từ điển: ' + message, progress: 0 });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'vp:status') {
    sendResponse(status);
    return false;
  }

  // background day settings sau khi user bam Luu: cache + dung lai engine neu lenh khac.
  if (msg.type === 'vp:settings') {
    settingsCache = msg.settings || {};
    if (engine && !sameEngineSettings(appliedEngineSettings, settingsCache)) rebuildSerialized('settings').catch(fail);
    return false;
  }

  // background day ban override moi sau khi user sua mot tu tren trang. CHO rebuild xong
  // moi tra loi de lan "dich lai" ngay sau do khong dap vao engine cu.
  if (msg.type === 'vp:overrides') {
    (async () => {
      noteEvent('nhận override version ' + (msg.version || 0));
      overridesMap = new Map(Object.entries(msg.overrides || {}));
      overridesVersion = msg.version || 0;
      if (!engine || overridesVersion !== appliedOverridesVersion) {
        appliedBookKey = '';   // buộc rebuild engine-per-book để glossary mới vào đúng sách
        await rebuildSerialized('overrides');
      }
      sendResponse({ ok: true });
    })().catch(err => { fail(err); sendResponse({ ok: false, error: String(err && err.message || err) }); });
    return true;
  }

  // Luật nhân của user đổi (options page lưu): bump version -> rebuild engine.
  if (msg.type === 'vp:user-rules') {
    (async () => {
      noteEvent('nhận user-rules version ' + (msg.version || 0));
      userRulesCache = { version: -1, text: '' };   // ép đọc lại store
      appliedBookKey = '';
      await rebuildSerialized('user-rules');
      sendResponse({ ok: true });
    })().catch(err => { fail(err); sendResponse({ ok: false, error: String(err && err.message || err) }); });
    return true;
  }

  // Glossary per-book đổi (lưu từ card/options): đọc lại từ chrome.storage QUA background
  // (invariant một-chỗ-đọc-lưu-trữ) rồi rebuild XONG mới trả lời -> lần dịch lại của trang
  // ngay sau đó chắc chắn dùng bộ mới. Version cũ hơn đang chạy thì bỏ qua (tin cũ đến sau).
  if (msg.type === 'vp:glossaries') {
    (async () => {
      noteEvent('nhận glossary version ' + (msg.version || 0));
      if (msg.version && glossariesVersion && msg.version < glossariesVersion) return sendResponse({ ok: true, stale: true });
      appliedBookKey = '';     // engine-per-book phải dựng lại để nạp glossary mới của sách
      await rebuildSerialized('glossaries');
      sendResponse({ ok: true });
    })().catch(err => { fail(err); sendResponse({ ok: false, error: String(err && err.message || err) }); });
    return true;
  }

  // Xoá toàn bộ cache dịch (IndexedDB + mem) — dùng khi nghi kết quả cũ còn dính
  // (nạp nhầm bản, bump version chưa ăn) hoặc muốn dịch lại từ đầu bằng engine hiện tại.
  if (msg.type === 'vp:cache-clear') {
    (async () => {
      await cacheClear();
      sendResponse({ ok: true, build: ENGINE_BUILD });
    })().catch(err => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }

  if (msg.type === 'vp:translate') {
    (async () => {
      try {
        const texts = msg.texts || [];
        // Đổi sách (bookKey mới) -> rebuild TRƯỚC khi dịch để lớp glossary đúng.
        if (typeof msg.bookKey === 'string' && msg.bookKey !== appliedBookKey) {
          appliedBookKey = msg.bookKey;
          await rebuildSerialized('book:' + msg.bookKey);
        }
        const keys = texts.map(makeKey);
        const hits = await cacheGet(keys);
        const results = new Array(texts.length);
        let misses = 0;
        const putEntries = [];
        let eng = null;
        for (let i = 0; i < texts.length; i++) {
          if (hits[i]) { results[i] = hits[i].vi; continue; }
          misses++;
          if (!eng) eng = engine || await boot();   // miss moi can engine: chuong da dich thi hien ngay ca khi dict chua nap xong
          const out = eng.translate(texts[i]);
          const vi = out.stats ? out.vi : texts[i];
          results[i] = vi;
          putEntries.push([keys[i], { vi, tokens: out.tokens.map(t => [t.han, t.vi, t.kind]), spans: out.spans, ts: Date.now() }]);
        }
        if (putEntries.length) cachePut(putEntries);   // nen: khong cho ghi xong moi tra loi
        if (misses) noteEvent('dịch batch ' + texts.length + ' node (miss ' + misses + ')');
        sendResponse({ ok: true, build: ENGINE_BUILD, results, stats: { hits: texts.length - misses, misses } });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message || err) });
      }
    })();
    return true;
  }

  // content script hoi tokens + spans cua mot doan DA DICH khi user bam chuot vao no
  // (tokenMap click-to-edit). Ket qua trung cache thi khong can engine.
  if (msg.type === 'vp:tokens') {
    (async () => {
      try {
        const texts = msg.texts || [];
        if (typeof msg.bookKey === 'string' && msg.bookKey !== appliedBookKey) {
          appliedBookKey = msg.bookKey;
          await rebuildSerialized('book:' + msg.bookKey);
        }
        const keys = texts.map(makeKey);
        const hits = await cacheGet(keys);
        const tokens = new Array(texts.length);
        const spans = new Array(texts.length);
        const missIdx = [];
        for (let i = 0; i < texts.length; i++) {
          if (hits[i]) { tokens[i] = hits[i].tokens; spans[i] = hits[i].spans || []; continue; }
          missIdx.push(i);
        }
        if (missIdx.length) {
          const eng = engine || await boot();
          const putEntries = [];
          for (const i of missIdx) {
            const out = eng.translate(texts[i]);
            tokens[i] = out.tokens.map(t => [t.han, t.vi, t.kind, eng.phienOf(t.han), t.raw || '']);
            spans[i] = out.spans;
            putEntries.push([keys[i], { vi: out.stats ? out.vi : texts[i], tokens: tokens[i], spans: out.spans, ts: Date.now() }]);
          }
          cachePut(putEntries);
        } else if (engine || await boot()) {
          // hit cache: token cũ 3 phần tử - bơm âm Hán Việt ngay trước khi trả về.
          for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] && tokens[i].length) {
              // token cũ 3/4 phần tử -> bơm âm Hán Việt + raw (rỗng nếu không có).
              tokens[i] = tokens[i].map(t => t.length >= 5 ? t : [...t, engine.phienOf(t[0]), '']);
            }
          }
        }
        sendResponse({ ok: true, build: ENGINE_BUILD, tokens, spans });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message || err) });
      }
    })();
    return true;
  }

  if (msg.type === 'vp:rebuild') {
    rebuild(msg.reason || 'settings').then(() => sendResponse({ ok: true, status })).catch(err => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }

  // Nap lai tu đầu, dung khi user bam "Nạp lại" sau mot lan loi.
  if (msg.type === 'vp:reload') {
    DATA.vp = null; DATA.names = null; DATA.pa = null; DATA.pronouns = null; DATA.t2s = null; DATA.rules = null;
    engine = null; booting = null; appliedEngineSettings = {};
    boot().then(() => sendResponse({ ok: true, status })).catch(err => { fail(err); sendResponse({ ok: false, error: String(err && err.message || err) }); });
    return true;
  }

  return false;
});



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
// Content script: tim text node goc truyen, gui sang engine page (background/iframe hoac
// offscreen document), ghi ket qua convert. Khong chua tu dien o day - content script dung
// chung heap voi tab.

(function () {
  'use strict';

  const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/;
  const HAN_GLOBAL = /[㐀-䶿一-鿿豈-﫿]/g;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'OPTION', 'TITLE', 'IFRAME', 'TEMPLATE']);
  const BATCH_MAX_NODES = 40;
  const BATCH_MAX_CHARS = 6000;

  const originals = new Map();   // Node -> goc (tieng Trung)
  const inserted = new Set();    // span ban chen them (che do song ngu)
  const done = new WeakSet();
  let applying = false;
  let settings = { mode: 'vi', firstMeaning: true, skipParticles: false, translateChrome: true, allowClickEdit: true };
  let hostEnabled = true;
  let observer = null;
  let queue = new Set();
  let timer = null;
  let overridesMap = {};       // ban vá của user: { chữ Hán: nghĩa } — đọc từ background, cập nhật sau mỗi lần lưu
  let siteSelectors = {};      // selector khu vực truyện theo host — cấu hình trong options, KHÔNG cứng trong code

  function host() {
    return location.hostname.replace(/^www\./, '');
  }

  // F4: key bộ từ điển riêng của truyện = host + đường dẫn sách. Chương khác nhau của
  // cùng một sách phải ra CÙNG key: uukanshu `/book/21897/16209313.html` -> `uukanshu.cc/book/21897`;
  // piaotia `/book/2342/1234567.html` -> `piaotia.com/book/2342`. Không khớp mẫu nào thì
  // dùng host + toàn bộ path (bỏ đuôi file) — vẫn gom được chương trình biểu diễn khác.
  function bookKey() {
    const path = location.pathname;
    let m = path.match(/\/book\/(\d+)\//);
    if (m) return host() + '/book/' + m[1];
    m = path.match(/^(\/[^/]+\/\d+)\//);
    if (m) return host() + m[1];
    return host() + path.replace(/[^/]+$/, '');
  }

  function hanCount(text) {
    const m = text.match(HAN_GLOBAL);
    return m ? m.length : 0;
  }

  function directHan(el) {
    let n = 0;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) n += hanCount(child.nodeValue);
    }
    return n;
  }

  // Chon vung chua noi dung: selector cua host (cau hinh trong options — default do
  // background seed cho 2 site goc), khong thi khoi phan theo khoi nhieu chu Han nhat.
  function findContainers() {
    const rules = String(siteSelectors[host()] || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const selector of rules) {
      let nodes;
      try { nodes = document.querySelectorAll(selector); } catch { continue; }
      const hit = [...nodes].filter(el => hanCount(el.textContent) > 200);
      if (hit.length) return hit;
    }
    const scored = [...document.querySelectorAll('div, td, article, section, p, body > *')]
      .map(el => ({ el, han: hanCount(el.textContent) }))
      .filter(item => item.han >= 300)
      .sort((a, b) => a.han - b.han);
    if (scored.length) return [scored[0].el];
    const loose = [...document.querySelectorAll('div, td, article, section')]
      .map(el => ({ el, han: directHan(el) }))
      .filter(item => item.han >= 60);
    if (loose.length) return loose.map(item => item.el);
    return [document.body];
  }

  function collectTextNodes(containers) {
    const out = [];
    for (const root of containers) {
      if (!(root instanceof Element)) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = node.nodeValue;
          if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
          if (!HAN_RE.test(text)) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (isOurs(node)) return NodeFilter.FILTER_REJECT;
          if (parent.closest('.vp-orig')) return NodeFilter.FILTER_REJECT;
          if (done.has(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
    }
    return out;
  }

  // ---------------------------------------------------------------- keep-alive (Firefox)
  // Giu background (event page) + engine page (iframe trong background) song trong khi user
  // dang doc trang: Firefox khong unload background khi con port/message port mo (MDN
  // Background_scripts). Chi connect thi van con khuyen/canh bao "phai thuong xuyen gui tin
  // qua port" (discourse.mozilla.org/t/124263) -> ping moi 20s cho chac. Port dong khi tab
  // dong -> background tu unload -> engine mat -> lan doc sau se tai lai (vp:ensure truoc
  // khi dich). Chrome van dung duoc port nay (van loi thuong: SW dua vao tin nhan de reset
  // idle timer). Chrome mock trong test (jsdom) khong co runtime.connect -> guard bo qua.
  let keepAlivePort = null;
  let keepAliveTimer = null;
  let keepAliveFails = 0;
  function keepAliveStop() {
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    keepAlivePort = null;
  }
  function keepAliveStart() {
    try {
      if (!chrome.runtime || typeof chrome.runtime.connect !== 'function') return;
      keepAlivePort = chrome.runtime.connect({ name: 'vp:keepalive' });
      keepAlivePort.onMessage.addListener(msg => { if (msg === 'pong') keepAliveFails = 0; });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAliveStop();
        // Background/mat port khong phai luc nao cung do tab dong: background crash/giiet la
        // mot lan. Connect lai = dayh thuc event page bang runtime (FF/event page wake on
        // connect), nhung gioi han 5 lan de khong vong vo han khi extension bi go.
        if (keepAliveFails++ < 5) setTimeout(() => keepAliveStart(), 1500);
      });
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = setInterval(() => {
        if (!keepAlivePort) { keepAliveStop(); return; }
        try { keepAlivePort.postMessage('ping'); } catch { /* port da dong -> onDisconnect lo */ }
      }, 20000);
    } catch { keepAliveStop(); }
  }

  function send(message) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      // Engine co the khong ton tai (Firefox: chua tao iframe; Edge thu hoi renderer); khong
      // co timeout thi trang khet "dang dich" vinh vien va nguoi dung khong con cach nao.
      const timer = setTimeout(() => finish({ ok: false, error: 'hết giờ chờ engine (10 phút)' }), 600000);
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) return finish({ ok: false, error: chrome.runtime.lastError.message });
          finish(response || { ok: false, error: 'khong co phan hoi' });
        });
      } catch (err) {
        finish({ ok: false, error: String(err && err.message || err) });
      }
    });
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // vp:ensure -> background tao engine page (Firefox: iframe an trong background; Chrome:
  // offscreen document) roi CHO engine page nhan onMessage (module script chua kip chay tu
  // iframe/HTML moi tao) truoc khi dich lai. Lan thu 2/3 de phong truong hop load cham.
  // build của offscreen gửi kèm response; lệch → engine trả lời là VIEW CŨ sống
  // sót qua Reload (zombie) — kết quả không tin được, cảnh báo bằng chip.
  const CONTENT_BUILD = '0.8.0';
  function warnBuildMismatch(resp) {
    if (resp && resp.build && resp.build !== CONTENT_BUILD) {
      console.warn('[TuiRead] engine view cũ (build ' + resp.build + ') đang trả lời — khởi động lại Firefox để sạch.');
      setStatusChip('⚠ Engine cũ (build ' + resp.build + ') trả lời — KHỞI ĐỘNG LẠI FIREFOX');
      return true;
    }
    return false;
  }

  async function askTranslate(texts) {
    let resp = await send({ type: 'vp:translate', texts, bookKey: bookKey() });
    warnBuildMismatch(resp);
    if (resp && resp.ok) return resp.results;
    await send({ type: 'vp:ensure' });
    for (const wait of [300, 900]) {
      await sleep(wait);
      resp = await send({ type: 'vp:translate', texts, bookKey: bookKey() });
      if (resp && resp.ok) return resp.results;
    }
    throw new Error((resp && resp.error) || 'engine khong phan hoi');
  }

  function makeBatch(nodes) {
    const batch = [];
    let chars = 0;
    for (const node of nodes) {
      batch.push(node);
      chars += node.nodeValue.length;
      if (batch.length >= BATCH_MAX_NODES || chars >= BATCH_MAX_CHARS) break;
    }
    return batch;
  }

  function applyResult(node, original, translated) {
    if (!translated || translated === original) return;
    originals.set(node, original);
    if (settings.mode === 'vi-han') {
      const span = document.createElement('span');
      span.className = 'vp-orig';
      span.textContent = original;
      node.parentNode.insertBefore(span, node.nextSibling);
      inserted.add(span);
    }
    // Font SF Pro Display cho bản dịch: text node trần không nhận được font từ CSS,
    // phải bọc span .vp-vi quanh node (span nằm trong `inserted` để restore() dọn sạch).
    const vi = document.createElement('span');
    vi.className = 'vp-vi';
    // Kế thừa kiểu chữ từ nơi text node đang sống: span mới mặc định nhận font của trang
    // chứ KHÔNG kế thừa đúng weight/style từ cha (span là phần tử mới, tính toán lại).
    const cs = getComputedStyle(node.parentElement || document.body);
    vi.style.fontSize = cs.fontSize;
    vi.style.lineHeight = cs.lineHeight;
    vi.style.fontWeight = cs.fontWeight === '400' ? '400' : cs.fontWeight;
    if (cs.fontStyle === 'italic') vi.style.fontStyle = 'italic';
    vi.style.textTransform = cs.textTransform;
    vi.style.letterSpacing = cs.letterSpacing;
    node.parentNode.insertBefore(vi, node);
    vi.appendChild(node);
    inserted.add(vi);
    node.nodeValue = translated;
    done.add(node);
  }

  async function translatePending(nodes) {
    if (!nodes.length) return;
    applying = true;
    try {
      let remaining = nodes.slice();
      while (remaining.length) {
        const batch = makeBatch(remaining);
        remaining = remaining.slice(batch.length);
        const texts = batch.map(node => (originals.get(node) || node.nodeValue));
        try {
          const results = await askTranslate(texts);
          batch.forEach((node, i) => applyResult(node, texts[i], results[i]));
        } catch (err) {
          console.warn('[TuiRead] loi engine:', err.message);
          setStatusChip('Engine chưa sẵn sàng - thử tải lại trang');
          return;
        }
      }
    } finally {
      applying = false;
    }
  }

  async function runOnce() {
    if (!hostEnabled) return;
    const nodes = collectTextNodes(findContainers());
    if (settings.translateChrome !== false) {
      // Menu/header/footer nam ngoai khoi truyen: dich sau khi than truyen xong de khong cham hua.
      const seen = new Set(nodes);
      for (const n of collectTextNodes([document.body])) if (!seen.has(n)) nodes.push(n);
    }
    if (nodes.length) await translatePending(nodes);
  }

  function restore() {
    clearHighlight();   // gỡ <mark> chọn từ (ghép lại node) trước khi trả nguyên trạng
    for (const [node, text] of originals) {
      if (node.parentNode) node.nodeValue = text;
      done.delete(node);
    }
    originals.clear();
    for (const span of inserted) {
      const parent = span.parentNode;
      if (!parent) continue;
      if (span.classList && span.classList.contains('vp-vi')) {
        // Bọc .vp-vi đang CHỨA text node gốc — unwrap (đẩy node ra chỗ cũ) trước khi
        // remove, nếu không xoá mất luôn bản gốc Hán.
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        span.remove();
      } else {
        span.remove();   // .vp-orig: chữ Hán chèn thêm, xoá thẳng là đúng
      }
    }
    inserted.clear();
  }

  function schedule(node) {
    if (node) queue.add(node);   // observer gọi schedule() KHÔNG đối số khi chỉ muốn flush
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const pending = !hostEnabled ? [] : [...queue].filter(n => n && n.parentNode && !done.has(n) && !isOurs(n) && HAN_RE.test(n.nodeValue || ''));
      queue.clear();
      if (pending.length) await translatePending(pending);
    }, 350);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(mutations => {
      if (applying) return;
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          if (added.nodeType === Node.TEXT_NODE) {
            if (added.nodeValue && HAN_RE.test(added.nodeValue) && !isOurs(added)) queue.add(added);
            continue;
          }
          if (!(added instanceof Element)) continue;
          if (added.closest('.vp-pop, .vp-orig, .vp-vi, .vp-status-chip, .vp-highlight-layer')) continue;
          const walker = document.createTreeWalker(added, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) queue.add(n);
        }
      }
      if (queue.size) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setStatusChip(text) {
    let chip = document.getElementById('vp-status-chip');
    if (!text) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'vp-status-chip';
      chip.className = 'vp-status-chip';
      (document.body || document.documentElement).appendChild(chip);
    }
    chip.textContent = text;
  }

  // ---------------------------------------------------------------- tokenMap click-to-edit
  // Bấm vào một đoạn đã dịch -> hiện card: chữ Hán gốc + nghĩa đang dùng + ô sửa nghĩa.
  // Lưu -> ghi vào layer override (chrome.storage qua background) -> engine rebuild
  // -> cache tự chết theo version -> dịch lại trang với nghĩa mới. File từ điển gốc không
  // bao giờ bị sửa; bản vá nằm riêng và export/import được từ options page.
  const KIND_LABELS = {
    ov: 'bản vá của bạn',
    vp: 'cụm từ điển',
    vp1: 'tự điển',
    name: 'tên riêng',
    rule: 'quy tắc (số/ngày)',
    pa: 'âm Hán Việt — chưa có trong từ điển'
  };

  // Text node nằm trong element DO TUIREAD tạo (card, chip, chữ Hán gốc, layer highlight,
  // status chip) thì TUYỆT ĐỐI không đưa vào hàng đợi dịch — nếu không observer tự dịch
  // chữ Hán trong card của chính mình (chip 汉 hiện nghĩa Việt sau 350ms).
  function isOurs(n) {
    try {
      const p = n && n.parentElement;
      return !!(p && p.closest && p.closest('.vp-pop, .vp-orig, .vp-vi, .vp-status-chip, .vp-highlight-layer'));
    } catch { return false; }
  }

  // el(tag, class, text): helper tạo element — bị mất trong lần cắt khối highlight,
  // mọi chỗ dựng card/chip/layer đều gọi nó.
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function closePop() {
    const pop = document.getElementById('vp-pop');
    if (pop) pop.remove();
    clearHighlight();
  }

  // ---------------------------------------------------------------- highlight từ đang chọn
  // Tô nền xanh thẫm lên đúng đoạn đã dịch đang được sửa (F1). Vẽ bằng
  // Range.getClientRects() lên một layer pointer-events:none -> KHÔNG đụng vào DOM text,
  // nên không phá originals/observer và không kích hoạt dịch lại. Layer fixed + vẽ lại khi
  // scroll/resize vì rect là toạ độ khung nhìn.
  // F1 (bản 3): đánh dấu từ đang chọn bằng <mark class="vp-sel"> THẬT — tách text node
  // thành [trước][token][sau], bọc token trong mark. DOM + CSS thuần, không phụ thuộc
  // API nào cả, hiển thị chắc chắn. Khi đóng card: replaceWith(text) + normalize() =>
  // text node ĐẦU TIÊN (chính là node gốc trong `originals`) hấp thụ lại toàn bộ chuỗi
  // -> originals/done vẫn đúng, restore() trả trang về nguyên trạng như chưa từng bọc.
  let selMark = null;
  let selMarkBase = null;   // NODE GỐC (trong originals) — ghép lại thủ công, không mất
  let selMarkAfter = null;  // text node sau mark (phần đuôi)

  function clearHighlight() {
    if (selMarkBase && selMarkBase.parentNode && selMark && selMark.parentNode) {
      // Ghép THỦ CÔNG về node gốc: orig = [0..start] + markText + [end..len].
      // KHÔNG dùng parent.normalize(): nó XOÁ text node rỗng — khi vùng chọn chạm
      // đầu/cuối chuỗi, node gốc rỗng bị xoá -> mất khỏi `originals` -> click sau
      // Esc không còn mở card (bug "mở rộng rồi Esc rồi click lại").
      const parent = selMark.parentNode;
      const start = selMarkBase.nodeValue.length;   // phần gốc hiện tại = [0..start]
      const markText = selMark.textContent || '';
      const afterLen = selMarkAfter ? selMarkAfter.nodeValue.length : 0;
      selMarkBase.nodeValue = selMarkBase.nodeValue + markText + (selMarkAfter ? selMarkAfter.nodeValue : '');
      selMark.remove();
      if (selMarkAfter && selMarkAfter.parentNode) selMarkAfter.remove();
    }
    selMark = null; selMarkBase = null; selMarkAfter = null;
  }

  function showHighlightFor(node, start, end) {
    clearHighlight();
    try {
      if (!node || !node.parentNode) return;
      const text = node.nodeValue;
      start = Math.max(0, Math.min(start, text.length));
      end = Math.max(start, Math.min(end, text.length));
      if (end <= start) return;
      node.nodeValue = text.slice(0, start);
      const mark = document.createElement('mark');
      mark.className = 'vp-sel';
      mark.textContent = text.slice(start, end);
      const afterNode = document.createTextNode(text.slice(end));
      node.parentNode.insertBefore(mark, node.nextSibling);
      node.parentNode.insertBefore(afterNode, mark.nextSibling);
      selMark = mark;
      selMarkBase = node;
      selMarkAfter = afterNode;
    } catch { /* node đã đổi giữa chừng — bỏ qua */ }
  }

  async function saveOverride(han, vi) {
    const resp = await send({ type: 'vp:override-set', han, vi });
    if (!resp || !resp.ok) {
      setStatusChip('Không lưu được bản vá: ' + ((resp && resp.error) || 'không có phản hồi'));
      setTimeout(() => setStatusChip(''), 5000);
      return false;
    }
    overridesMap = resp.overrides || {};
    closePop();
    setStatusChip('Đã vá "' + han + '" — đang dịch lại trang…');
    restore();
    await runOnce();
    setStatusChip('');
    return true;
  }

  // F4: lưu nghĩa vào bộ từ điển RIÊNG của truyện (glossary per-book). Engine rebuild
  // theo bookKey -> trang tự dịch lại với nghĩa mới; truyện khác không bị ảnh hưởng.
  async function saveGlossary(han, vi) {
    const resp = await send({ type: 'vp:glossary-set', bookKey: bookKey(), han, vi });
    if (!resp || !resp.ok) {
      setStatusChip('Không lưu được glossary: ' + ((resp && resp.error) || 'không có phản hồi'));
      setTimeout(() => setStatusChip(''), 5000);
      return false;
    }
    closePop();
    setStatusChip('Đã vá "' + han + '" vào truyện này — đang dịch lại…');
    restore();
    await runOnce();
    setStatusChip('');
    return true;
  }

  function showEditor(x, y, token, ctx) {
    // Gỡ card cũ (nếu có) nhưng GIỮ highlight: onDocClick vừa vẽ vùng chọn trước khi
    // gọi hàm này; closePop() ở đây từng xoá highlight ngay sau khi vẽ -> không thấy màu.
    const oldPop = document.getElementById('vp-pop');
    if (oldPop) oldPop.remove();
    const pop = el('div', 'vp-pop');
    pop.id = 'vp-pop';
    const state = {
      from: ctx.tokenIdx, to: ctx.tokenIdx,   // vung token dang chon [from..to]
      han: token.han, vi: token.vi, kind: token.kind
    };
    ctx.tokensRef = ctx.tokens;               // chi doc

    const head = el('div', 'vp-pop-head');
    const hanBox = el('span', 'vp-pop-han');
    head.appendChild(hanBox);
    head.appendChild(el('span', 'vp-pop-kind', KIND_LABELS[token.kind] || token.kind));
    pop.appendChild(head);

    // Hàng công cụ vùng chọn: ◀ ▶ gộp token kề, Thu gọn về 1 token.
    const regionRow = el('div', 'vp-pop-btns');
    const left = el('button', undefined, '◀');
    left.title = 'Gộp thêm token bên trái';
    left.addEventListener('click', () => {
      if (state.from > 0 && ctx.tokens[state.from - 1][2] !== 'raw') {
        state.from--;
        auto.han = auto.phien = auto.vp = true;   // đổi vùng -> nạp lại giá trị mặc định
        render();
      }
    });
    regionRow.appendChild(left);
    const shrink = el('button', undefined, 'Thu gọn');
    shrink.title = 'Thu về đúng token đầu';
    shrink.addEventListener('click', () => {
      if (state.to !== state.from) {
        state.to = state.from;
        auto.han = auto.phien = auto.vp = true;
        render();
      }
    });
    regionRow.appendChild(shrink);
    const right = el('button', undefined, '▶');
    right.title = 'Gộp thêm token bên phải';
    right.addEventListener('click', () => {
      if (state.to + 1 < ctx.tokens.length && ctx.tokens[state.to + 1][2] !== 'raw') {
        state.to++;
        auto.han = auto.phien = auto.vp = true;
        render();
      }
    });
    regionRow.appendChild(right);
    pop.appendChild(regionRow);

    // Ba khung nhập theo bố cục user yêu cầu (đều sửa được tự do):
    //   Tiếng Trung — chữ Hán của vùng chọn (chốt khoá lưu; sửa được nếu tách sai)
    //   Hán Việt    — âm Hán Việt của vùng chọn
    //   Vietphrase  — nghĩa tiếng Việt đang hiển thị
    function row(labelText) {
      const wrap = el('div', 'vp-pop-row');
      wrap.appendChild(el('span', 'vp-pop-label', labelText));
      const box = document.createElement('input');
      box.className = 'vp-pop-input';
      box.type = 'text';
      wrap.appendChild(box);
      return { box, wrap };   // KHONG tu append — thu tu xep pop chi dinh o duoi
    }
    const hanRow = row('Tiếng Trung');
    const phienRow = row('Hán Việt');
    const vpRow = row('Vietphrase');
    const hanInput = hanRow.box, phienInput = phienRow.box, vpInput = vpRow.box;

    // auto: true = ô được nạp giá trị mặc định; user gõ -> false (render không ghi đè).
    const auto = { han: true, phien: true, vp: true };
    hanInput.addEventListener('input', () => { auto.han = false; state.han = hanInput.value.trim(); });
    phienInput.addEventListener('input', () => { auto.phien = false; });
    vpInput.addEventListener('input', () => { auto.vp = false; });

    // Vung chon hien tai: han ghep tu tokens[from..to], nghia/am tuong ung.
    function selHan() {
      let h = '';
      for (let i = state.from; i <= state.to; i++) h += ctx.tokens[i][0];
      return h;
    }
    // Ghep nghia/am cua vung chon CO SUA KHOANG TRANG theo needsSpace (nhan ban logic
    // engine khi ghep out): 2 tieng chi le ma ca 2 deu chu cai thi chen 1 space —
    // "Trải qua"+"lôi hỏa" -> "Trải qua lôi hỏa", khong con 'qualôi'/'hỏanhư'.
    // Dau chấm/phẩy + dấu mở/đóng không chen space, đúng như văn bản trên trang.
    const CLOSE_NO_SPACE = new Set('.,!?:;)]}》〉"\'');
    function needsSpaceJoin(a, b) {
      if (!a || !b) return '';
      if (OPEN_SET.has(a)) return '';
      if (CLOSE_NO_SPACE.has(b)) return '';
      if ('.!?,;:'.includes(a)) return ' ';
      if (/[\p{L}0-9]/u.test(a) && /[\p{L}0-9]/u.test(b)) return ' ';
      return '';
    }
    const OPEN_SET = new Set('([「《〈"\'');
    // Ô Vietphrase mặc định: HIỂN THỊ TẤT CẢ nghĩa của từ (token[4] `raw` — danh sách
    // gốc từ VP/supplement, các nghĩa cách nhau '/'). Trang truyện vẫn chỉ hiện nghĩa
    // đầu (firstMeaning); card là nơi người dùng XEM HẾT lựa chọn rồi vá một nghĩa.
    // Token không có raw (rule/name/gl/ov/token cũ) thì dùng nghĩa hiện tại token[1].
    function selDefaultVi() {
      let v = '';
      for (let i = state.from; i <= state.to; i++) {
        const t = ctx.tokens[i];
        let vi = (t.length >= 5 && t[4]) ? t[4] : t[1];
        if (vi && vi.includes('/')) {
          const parts = vi.split('/').map(s => s.trim()).filter(Boolean);
          if (parts.length) vi = parts.join('/');   // gỡ candidate rỗng đầu/đuôi ('/lấy/mắng' -> 'lấy/mắng')
        }
        if (!vi) continue;
        v += needsSpaceJoin(v.slice(-1), vi[0]) + vi;
      }
      return v;
    }
    function selPhien() {
      let p = '';
      for (let i = state.from; i <= state.to; i++) {
        const t = ctx.tokens[i];
        const am = t.length >= 4 ? t[3] : (ctx.phienOf ? ctx.phienOf(t[0]) : '');
        if (!am) continue;
        p += (p ? ' ' : '') + am;
      }
      return p.trim();
    }

    // "Chữ" = TIẾNG (tách bằng khoảng trắng): "lâm động thiên hạ" ->
    //   hoa2       : "Lâm Động thiên hạ"   (2 tiếng đầu hoa, còn lại thường)
    //   thuongCuoi : "Lâm Động Thiên hạ"   (tất cả hoa TRỪ tiếng cuối)
    //   hoaAll     : "Lâm Động Thiên Hạ"   (viết hoa chữ đầu MỖI tiếng)
    function capWord(w) { return w ? w.charAt(0).toLocaleUpperCase('vi') + w.slice(1) : w; }
    function applyCase(mode, box) {
      const words = box.value.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return box.value.trim();
      let out;
      if (mode === 'hoa2') out = words.map((w, i) => (i < 2 ? capWord(w) : w.toLocaleLowerCase('vi'))).join(' ');
      else if (mode === 'thuongCuoi') out = words.map((w, i) => (i < words.length - 1 ? capWord(w) : w.toLocaleLowerCase('vi'))).join(' ');
      else out = words.map(w => capWord(w.toLocaleLowerCase('vi'))).join(' ');   // hoa dau MOI tieng
      box.value = out;
      return out;
    }
    function caseBtn(label, mode, box, title) {
      const b = el('button', undefined, label);
      b.title = title;
      b.addEventListener('click', () => applyCase(mode, box));
      return b;
    }

    let lastRange = state.from + '.' + state.to;
    function render() {
      // Chip từng CHỮ Hán: bấm để thu vùng chọn (F2).
      hanBox.textContent = '';
      const han = selHan();
      let charIdx = 0;
      for (let ti = state.from; ti <= state.to; ti++) {
        const t = ctx.tokens[ti];
        for (const ch of t[0]) {
          const chip = el('button', 'vp-chip');
          chip.textContent = ch;
          const ci = charIdx;
          chip.addEventListener('click', () => {
            if (ci === 0 && state.from < state.to) state.from++;
            else if (ci + 1 >= [...han].length && state.to > state.from) state.to--;
            else { state.from = ti; state.to = ti; }
            auto.han = auto.phien = auto.vp = true;
            render();
          });
          hanBox.appendChild(chip);
          charIdx++;
        }
        if (ti < state.to) hanBox.appendChild(el('span', 'vp-chip-sep', '·'));
      }
      if (auto.han) { state.han = han; hanInput.value = han; }
      if (auto.phien) phienInput.value = selPhien();
      const hasOv = overridesMap[state.han] !== undefined;
      if (auto.vp) vpInput.value = hasOv ? overridesMap[state.han] : selDefaultVi();
      pop.querySelectorAll('.vp-save').forEach(b => {
        b.textContent = state.from === state.to ? 'Lưu' : 'Lưu (' + (state.to - state.from + 1) + ' từ)';
      });
      // So voi vung LAN RENDER TRUOC -> highlight di theo vung khi mo rong/thu.
      const nowRange = state.from + '.' + state.to;
      if (ctx.setRange && nowRange !== lastRange) { lastRange = nowRange; ctx.setRange(state.from, state.to); }
    }

    // HÀNG NÚT HÁN VIỆT: lấy nội dung Ô HÁN VIỆT đang sửa, lưu vào từ điển RIÊNG truyện.
    const phienBtns = el('div', 'vp-pop-btns');
    const phienSave = el('button', 'vp-save', 'Lưu');
    phienSave.title = 'Lưu âm Hán Việt đang sửa vào từ điển riêng của truyện này';
    phienSave.addEventListener('click', () => saveGlossary(state.han, phienInput.value.trim()));
    phienBtns.appendChild(phienSave);
    phienBtns.appendChild(caseBtn('Hoa 2 chữ đầu', 'hoa2', phienInput, '2 tiếng đầu viết hoa, còn lại thường — lưu âm Hán Việt vào từ điển truyện'));
    phienBtns.appendChild(caseBtn('Thường chữ cuối', 'thuongCuoi', phienInput, 'Tất cả tiếng viết hoa trừ tiếng cuối — lưu âm Hán Việt vào từ điển truyện'));
    phienBtns.appendChild(caseBtn('Hoa toàn bộ', 'hoaAll', phienInput, 'Viết hoa chữ đầu mỗi tiếng — lưu âm Hán Việt vào từ điển truyện'));

    // Bố cục: Tiếng Trung -> Hán Việt -> [nút Hán Việt] -> Vietphrase -> [nút Vietphrase]
    pop.appendChild(hanRow.wrap);
    pop.appendChild(phienRow.wrap);
    pop.appendChild(phienBtns);
    pop.appendChild(vpRow.wrap);

    // HÀNG NÚT VIETPHRASE: lấy nội dung Ô VIETPHRASE đang sửa (KHÔNG phải ô Hán Việt).
    // "Lưu" -> riêng truyện; "Lưu vào VP" -> bản vá toàn cục cho mọi truyện.
    const vpBtns = el('div', 'vp-pop-btns');
    vpBtns.appendChild(caseBtn('Hoa 2 chữ đầu', 'hoa2', vpInput, '2 tiếng đầu viết hoa, còn lại thường — áp cho nghĩa Vietphrase đang sửa'));
    vpBtns.appendChild(caseBtn('Thường chữ cuối', 'thuongCuoi', vpInput, 'Tất cả tiếng viết hoa trừ tiếng cuối — áp cho nghĩa Vietphrase đang sửa'));
    vpBtns.appendChild(caseBtn('Hoa toàn bộ', 'hoaAll', vpInput, 'Viết hoa chữ đầu mỗi tiếng — áp cho nghĩa Vietphrase đang sửa'));
    const vpSave = el('button', 'vp-save', 'Lưu');
    vpSave.title = 'Lưu nghĩa tiếng Việt đang sửa vào từ điển riêng của truyện này';
    vpSave.addEventListener('click', () => saveGlossary(state.han, vpInput.value.trim()));
    vpBtns.appendChild(vpSave);
    const saveGlobal = el('button', undefined, 'Lưu vào VP');
    saveGlobal.title = 'Lưu nghĩa tiếng Việt đang sửa cho MỌI truyện (bản vá toàn cục)';
    saveGlobal.addEventListener('click', () => saveOverride(state.han, vpInput.value.trim()));
    vpBtns.appendChild(saveGlobal);
    if (overridesMap[state.han] !== undefined) {
      const revert = el('button', undefined, 'Bỏ vá VP');
      revert.title = 'Xoá bản vá toàn cục của từ này';
      revert.addEventListener('click', () => saveOverride(state.han, ''));
      vpBtns.appendChild(revert);
    }
    const close = el('button', undefined, 'Đóng');
    close.addEventListener('click', closePop);
    vpBtns.appendChild(close);
    pop.appendChild(vpBtns);

    pop.appendChild(el('div', 'vp-pop-hint', 'Sửa trực tiếp trong ô; nút kiểu chữ biến đổi nội dung ô của hàng nó rồi lưu. ◀ ▶ / bấm chip chữ Hán để đổi vùng chọn. Esc đóng.'));
    (document.body || document.documentElement).appendChild(pop);
    render();

    const width = pop.offsetWidth || 300;
    const height = pop.offsetHeight || 140;
    pop.style.left = Math.max(8, Math.min(x - 20, (window.innerWidth || 1024) - width - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(y + 16, (window.innerHeight || 768) - height - 8)) + 'px';
    hanInput.focus();
  }

  // caretAt(x, y): tìm text node + vị trí ký tự tại toạ độ màn hình (đường vào chính của
  // click-to-edit). Firefox có caretRangeFromPoint; chuẩn là caretPositionFromPoint.
  function caretAt(x, y) {
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range) return { node: range.startContainer, offset: range.startOffset };
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) return { node: pos.offsetNode, offset: pos.offset };
    }
    return { node: null, offset: -1 };
  }

  // Chọn token bằng HIT-TEST HÌNH HỌC: dựng Range cho từng token (biết start/end trong
  // chuỗi), lấy rect THẬT trên màn hình, token nào chứa điểm click thì chọn. Chính xác
  // tuyệt đối vì đo chữ đã render — không lệch bởi font/reflow/user-select như
  // caretRangeFromPoint (nhiều site tiểu thuyết đặt user-select:none để chống copy).
  function tokenIndexAtPoint(node, tokens, spans, x, y) {
    const len = node.nodeValue.length;
    for (let k = 0; k < spans.length; k++) {
      const [start, idx] = spans[k];
      const t = tokens[idx];
      if (!t || t[2] === 'raw') continue;
      const end = k + 1 < spans.length ? spans[k + 1][0] : len;
      if (end <= start) continue;
      let range;
      try {
        range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
      } catch { continue; }
      for (const rect of range.getClientRects()) {
        if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 3 && y <= rect.bottom + 3) return idx;
      }
    }
    return -1;
  }

  async function onDocClick(e) {
    const pop = document.getElementById('vp-pop');
    if (pop) {
      if (e.target && e.target.closest && e.target.closest('#vp-pop')) return;   // bấm trong card: để nút tự xử
      closePop();
    }
    if (!settings.allowClickEdit) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a, button, input, select, textarea, label, #vp-status-chip')) return;

    let { node, offset } = caretAt(e.clientX, e.clientY);
    // Bấm vào CHỮ HÁN GỐC (span.vp-orig, mode vi+Hán): ánh xạ về node Việt tương ứng
    // (span.vp-orig được chèn NGAY SAU node Việt trong applyResult).
    if (node && node.parentElement && node.parentElement.classList &&
        node.parentElement.classList.contains('vp-orig')) {
      const viNode = node.parentElement.previousSibling;
      if (viNode && originals.has(viNode)) { node = viNode; offset = Math.floor((viNode.nodeValue || '').length / 2); }
      else return;
    }
    // caretAt có thể trả node của TRANG (site can thiệp caret) hoặc element trực tiếp;
    // nếu node không phải text đã dịch, DÙNG TỌA ĐỘ để tìm text node đã dịch gần nhất
    // (elementFromPoint → vị trí đầu của node con .vp-vi/.vp-vi con trực tiếp).
    if (!node || node.nodeType !== Node.TEXT_NODE || !originals.has(node)) {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const viSpan = hit && (hit.classList && hit.classList.contains('vp-vi') ? hit : (hit && hit.querySelector ? hit.querySelector('.vp-vi') : null));
      const viNode = viSpan && viSpan.firstChild;
      if (viNode && viNode.nodeType === Node.TEXT_NODE && originals.has(viNode)) {
        node = viNode;
        offset = -1;   // KHONG uoc luong offset theo X (sai voi chu Viet) — tokenIndexAtPoint
                       // se chon token theo rect that; caret-offset chi la fallback.
      } else {
        return;
      }
    }

    const original = originals.get(node);
    const resp = await send({ type: 'vp:tokens', texts: [original], bookKey: bookKey() });
    if (!resp || !resp.ok) return;
    const tokens = (resp.tokens && resp.tokens[0]) || [];
    const spans = (resp.spans && resp.spans[0]) || [];
    // 1) Hit-test hình học theo rect thật của từng token (chính xác nhất).
    let tokenIdx = tokenIndexAtPoint(node, tokens, spans, e.clientX, e.clientY);
    // 2) Fallback: caret offset (trường hợp rect bị chặn/ẩn bởi overlay của trang).
    if (tokenIdx < 0 && offset >= 0) {
      for (const [start, idx] of spans) {
        if (offset >= start) tokenIdx = idx;
        else break;
      }
    }
    if (tokenIdx < 0) return;
    const token = tokens[tokenIdx];
    if (!token || token[2] === 'raw') return;   // đoạn không phải chữ Hán thì không cần vá

    // F1+F2: tô xanh thẫm vùng token đang chọn; card nhận ctx để mở rộng/thu vùng.
    const tokenStart = spans.find(([start, idx]) => idx === tokenIdx)?.[0] ?? -1;
    if (tokenStart >= 0) {
      const nextStart = spans.find(([start, idx]) => idx === tokenIdx + 1)?.[0] ?? node.nodeValue.length;
      showHighlightFor(node, tokenStart, Math.max(tokenStart + 1, nextStart));
    }

    showEditor(e.clientX, e.clientY, { han: token[0], vi: token[1], kind: token[2] }, {
      tokens, spans, tokenIdx, node,
      phienOf: resp.phienOf,
      // mở vùng chọn khi user bấm ◀ ▶ (đồng bộ highlight theo vùng mới)
      setRange(from, to) {
        const s = spans.find(([start, idx]) => idx === from)?.[0] ?? -1;
        const e2 = to + 1 < tokens.length ? (spans.find(([start, idx]) => idx === to + 1)?.[0] ?? node.nodeValue.length) : node.nodeValue.length;
        if (s >= 0) showHighlightFor(node, s, Math.max(s + 1, e2));
        else clearHighlight();
      }
    });
  }

  document.addEventListener('click', e => { onDocClick(e); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
  // Phím mũi tên khi đang gõ trong input/textarea của card KHÔNG được làm trang cuộn/chuyển
  // chương (uukanshu đổi chương bằng mũi tên). Chặn ở WINDOW pha capture = chạy trước mọi
  // handler của trang; chỉ dừng lan truyền (stopPropagation), KHÔNG preventDefault -> caret
  // trong ô nhập vẫn di chuyển sang trái/phải bình thường.
  window.addEventListener('keydown', e => {
    if (!e.key || !e.key.startsWith('Arrow')) return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing && t.closest && t.closest('.vp-pop')) e.stopPropagation();
  }, { capture: true });

  // Doc config qua background (event page), khong doc chrome.storage truc tiep:
  // background la noi luu tru duy nhat va chac chan co chrome.storage (xem background.js).
  async function loadConfig() {
    const got = await send({ type: 'vp:get-settings' });
    const store = got && got.ok ? got : {};
    settings = { ...settings, ...(store.settings || {}) };
    overridesMap = store.overrides || {};
    siteSelectors = store.siteSelectors || {};
    const state = store.hostState || {};
    hostEnabled = state[host()] !== false;
    document.body.classList.toggle('vp-mode-han', settings.mode === 'vi-han');
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'vp:command') return false;
    (async () => {
      if (msg.action === 'status') {
        sendResponse({ ok: true, host: host(), enabled: hostEnabled, translated: originals.size });
        return;
      }
      await loadConfig();
      if (msg.action === 'enable') {
        hostEnabled = true;
        startObserver();
        await runOnce();
      } else if (msg.action === 'disable') {
        hostEnabled = false;
        restore();
      } else if (msg.action === 'retranslate') {
        await loadConfig();   // nạp settings mới (theme, mode…) trước khi dịch lại
        applyPageTheme();
        restore();
        await runOnce();
      }
      sendResponse({ ok: true, host: host(), enabled: hostEnabled, translated: originals.size });
    })();
    return true;
  });

  // Font SF Pro Display: CSS của content script có URL tương đối bị resolve theo NGUỒN TRANG
  // (uukanshu.cc) -> Firefox chặn tải font từ moz-extension://. Cách đúng: đăng ký bằng
  // FontFace API với URL tuyệt đối chrome.runtime.getURL — không đụng CSP của trang.
  const FONT_FILES = [
    ['400', 'normal', 'fonts/sf-pro/SF-Pro-Display-Regular.otf'],
    ['500', 'normal', 'fonts/sf-pro/SF-Pro-Display-Medium.otf'],
    ['700', 'normal', 'fonts/sf-pro/SF-Pro-Display-Bold.otf'],
    ['400', 'italic', 'fonts/sf-pro/SF-Pro-Display-RegularItalic.otf']
  ];
  let fontsRegistered = false;
  function registerFonts() {
    if (fontsRegistered || !(window.FontFace && chrome.runtime && chrome.runtime.getURL)) return;
    fontsRegistered = true;
    for (const [weight, style, path] of FONT_FILES) {
      try {
        const face = new FontFace('SF Pro Display', 'url(' + chrome.runtime.getURL(path) + ')', { weight, style });
        face.load().then(f => document.fonts.add(f)).catch(() => { /* font lỗi thì rơi về system-ui */ });
      } catch { /* trình duyệt cũ */ }
    }
  }

  // THEME UI trên trang (card sửa chữ, chip): settings.uiTheme từ Options.
  function applyPageTheme() {
    const theme = (settings && settings.uiTheme) || '';
    const root = document.documentElement;
    if (theme) root.dataset.vpTheme = theme;
    else root.removeAttribute('data-vp-theme');
  }

  async function init() {
    keepAliveStart();
    registerFonts();
    await loadConfig();
    applyPageTheme();
    if (!hostEnabled) return;
    // MARKER BẢN: chip biến mất sau 4s; nhìn chip biết chính xác content script
    // đang chạy là bản nào (khi nghi vấn nạp nhầm .xpi / tab chưa F5).
    setTimeout(() => { const c = document.getElementById('vp-status-chip'); if (c && c.textContent === 'TuiRead content 0.8.0') c.remove(); }, 4000);
    await runOnce();
    startObserver();
  }

  init().catch(err => console.warn('[TuiRead] loi khoi dong:', err));
})();

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
