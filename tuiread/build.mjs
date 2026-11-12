// Dựng tuiread.user.js từ mã nguồn gốc của extension (memories169/tuiread-firefox).
//
//   node build.mjs [đường-dẫn-tới-bản-clone-repo]
//
// Không truyền đường dẫn thì script tự `git clone` repo vào ./upstream.
// Engine (engine/*.js, db.js, offscreen.js) và content.js được nhúng NGUYÊN VĂN, chỉ vá
// vài dòng có kiểm tra (assert) — repo gốc đổi làm lệch chỗ vá thì build báo lỗi ngay
// thay vì ra một userscript hỏng âm thầm.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Tăng số này mỗi lần sửa userscript mà bản gốc không đổi version, để trình quản lý tự cập nhật.
const USERSCRIPT_REV = 1;
const REPO_URL = 'https://github.com/memories169/tuiread-firefox';
let repo = process.argv[2] ? resolve(process.argv[2]) : join(here, 'upstream');
if (!existsSync(join(repo, 'manifest.json'))) {
  console.log('Clone ' + REPO_URL + ' -> ' + repo);
  execFileSync('git', ['clone', '--depth', '1', REPO_URL, repo], { stdio: 'inherit' });
}

const read = rel => readFileSync(join(repo, rel), 'utf8').replace(/\r\n/g, '\n');
const manifest = JSON.parse(read('manifest.json'));
const dictRef = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

// Thay đúng MỘT chỗ, không thấy thì dừng build.
function patch(src, from, to, label) {
  const parts = src.split(from);
  if (parts.length !== 2) throw new Error(`Chỗ vá "${label}" khớp ${parts.length - 1} lần (cần đúng 1) — repo gốc đã đổi?`);
  return parts.join(to);
}

// import/export của ES module -> biến thường trong một IIFE (mỗi module một scope riêng,
// vì db.js và offscreen.js cùng có hàm fnv1a nhưng cho kết quả khác nhau).
function convertImports(src) {
  return src.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/(?:engine\/)?(\w+)\.js';?[ \t]*$/gm,
    (m, names, mod) => `const {${names}} = M_${mod};`);
}
function wrapModule(name, src) {
  const exported = new Set();
  const body = convertImports(src)
    .replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (m, names) => { names.split(',').forEach(n => exported.add(n.trim())); return ''; })
    .replace(/^export\s+(async\s+function|function|const|let)\s+(\w+)/gm, (m, kind, id) => { exported.add(id); return kind + ' ' + id; });
  if (/^(import|export)\b/m.test(body)) throw new Error('Còn import/export chưa chuyển trong ' + name);
  return `// ---- ${name}.js ----\nconst M_${name} = (() => {\n${body}\nreturn { ${[...exported].join(', ')} };\n})();\n`;
}

let db = read('db.js');
db = patch(db, 'const db = await openDB();', 'const db = await open();', 'db.js: cacheClear gọi hàm không tồn tại');

let engineHost = convertImports(read('offscreen.js'));
if (/^(import|export)\b/m.test(engineHost)) throw new Error('Còn import/export trong offscreen.js');
// Hàm không gửi được qua postMessage của Worker (và bản gốc tham chiếu biến `eng` ngoài scope).
engineHost = patch(engineHost, ', phienOf: (engine || eng).phienOf });', ' });', 'offscreen.js: bỏ phienOf khỏi response');
// Userscript nạp engine lười: bấm vào đoạn đã có trong cache vẫn phải có engine để lấy âm Hán Việt.
engineHost = patch(engineHost, '} else if (engine) {', '} else if (engine || await boot()) {', 'offscreen.js: boot khi cần token');
// Không nạp 45MB từ điển ngay khi tạo engine — chỉ nạp khi có đoạn chưa dịch (cache miss).
engineHost = patch(engineHost, '\nboot().catch(fail);\n', '\n', 'offscreen.js: bỏ boot tự động');

const engine = [
  wrapModule('numbers', read('engine/numbers.js')),
  wrapModule('dict', read('engine/dict.js')),
  wrapModule('t2s', read('engine/t2s.js')),
  wrapModule('rules', read('engine/rules.js')),
  wrapModule('translate', read('engine/translate.js')),
  wrapModule('index', read('engine/index.js')),
  wrapModule('db', db),
  '// ---- offscreen.js (engine host) ----\n' + engineHost
].join('\n');

let content = read('content.js');
// Lần đầu phải tải ~45MB từ điển: 15s của bản extension là không đủ.
content = patch(content, "'hết giờ chờ engine (15s)' }), 15000);", "'hết giờ chờ engine (10 phút)' }), 600000);", 'content.js: timeout chờ engine');

// Bản gốc: tắt dịch -> restore() trả chữ Hán về -> MutationObserver thấy node "mới" và dịch lại ngay.
content = patch(content, 'const pending = [...queue].filter(', 'const pending = !hostEnabled ? [] : [...queue].filter(', 'content.js: observer không dịch khi site đang tắt');

// Chip "TuiRead content 0.8.0" là dấu debug của extension; ở userscript mỗi lần sang chương
// là một lần tải trang nên nó nháy 4 giây ở MỌI chương.
content = patch(content, "    setStatusChip('TuiRead content 0.8.0');\n", '', 'content.js: bỏ chip phiên bản');

const fill = { ENGINE: engine, CONTENT: content };
let out = readFileSync(join(here, 'src', 'userscript.template.js'), 'utf8').replace(/\r\n/g, '\n');
out = out.replace(/^[ \t]*\/\*@@(ENGINE|CONTENT)@@\*\/[ \t]*$/gm, (m, key) => fill[key]);
out = out.replace(/@@VERSION@@/g, () => manifest.version + '.' + USERSCRIPT_REV)
  .replace(/@@DICT_REF@@/g, () => dictRef)
  .replace(/"@@CSS@@"/g, () => JSON.stringify(read('styles/content.css')));
if (/@@\w+@@/.test(out)) throw new Error('Còn placeholder chưa điền');

const target = join(here, 'tuiread.user.js');
writeFileSync(target, out);
console.log(`OK ${target} (${(out.length / 1024).toFixed(0)} KB) — bản gốc ${manifest.version}, từ điển ghim tại ${dictRef.slice(0, 7)}`);
