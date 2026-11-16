// ==UserScript==
// @name         FINN Keyword Filter
// @namespace    https://github.com/loooveee
// @version      1.0.2
// @description  Type or click keywords (tvangssalg, oppussingsobjekt, dødsbo …) to filter real estate listings on finn.no, and highlight the keywords on the ad page.
// @author       loooveee
// @homepageURL  https://github.com/loooveee/script/tree/main/finn-keyword-filter
// @supportURL   https://github.com/loooveee/script/issues
// @downloadURL  https://raw.githubusercontent.com/loooveee/script/main/finn-keyword-filter/finn-keyword-filter.user.js
// @updateURL    https://raw.githubusercontent.com/loooveee/script/main/finn-keyword-filter/finn-keyword-filter.user.js
// @match        https://www.finn.no/realestate/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  // Built-in keywords. Add/remove freely — keywords typed into the input box are saved automatically too.
  const DEFAULT_KEYWORDS = [
    'tvangssalg',
    'oppussingsobjekt',
    'oppussingsbehov',
    'renoveringsobjekt',
    'moderniseringsbehov',
    'oppgraderingsbehov',
    'trenger oppussing',
    'dødsbo',
    'selges som den er',
    'rivningsobjekt',
    'utleiedel',
    'hybel',
  ];

  // ---------- storage ----------
  const KEY = 'finnKwFilter';
  const hasGM = typeof GM_getValue === 'function';
  function load() {
    let s = null;
    try {
      s = hasGM ? GM_getValue(KEY, null) : JSON.parse(localStorage.getItem(KEY));
    } catch (e) { /* ignore */ }
    if (!s || typeof s !== 'object') s = {};
    return {
      keywords: Array.isArray(s.keywords) ? s.keywords : DEFAULT_KEYWORDS.slice(),
      sel: s.sel && typeof s.sel === 'object' ? s.sel : {}, // keyword -> 1 (include) | -1 (exclude)
      mode: s.mode === 'AND' ? 'AND' : 'OR',
      collapsed: !!s.collapsed,
    };
  }
  function save() {
    try {
      if (hasGM) GM_setValue(KEY, state);
      else localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }
  const state = load();

  // ---------- build the query for finn's ?q= parameter ----------
  // finn supports: space = AND, OR = OR, -word = exclude, "phrase" = exact phrase match.
  const quote = (t) => (/\s/.test(t) ? '"' + t + '"' : t);
  function buildQuery() {
    const inc = state.keywords.filter((k) => state.sel[k] === 1).map(quote);
    const exc = state.keywords.filter((k) => state.sel[k] === -1).map((k) => '-' + quote(k));
    let q = inc.join(state.mode === 'OR' ? ' OR ' : ' ');
    if (state.mode === 'OR' && inc.length > 1 && exc.length) q = '(' + q + ')';
    return [q].concat(exc).filter(Boolean).join(' ');
  }
  function apply() {
    save();
    const url = new URL(location.href);
    const q = buildQuery();
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    url.searchParams.delete('page');
    if (url.href !== location.href) location.assign(url.href);
    else render();
  }

  const css = `
#fkf{position:fixed;right:16px;bottom:16px;z-index:99999;width:320px;max-width:calc(100vw - 32px);
  background:#fff;color:#1b1b1f;border:1px solid #c3ccd9;border-radius:10px;
  box-shadow:0 6px 24px rgba(0,0,0,.18);font:14px/1.4 system-ui,sans-serif}
#fkf *{box-sizing:border-box}
#fkf header{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;font-weight:600;user-select:none}
#fkf header span{flex:1}
#fkf header b{background:#0063fb;color:#fff;border-radius:10px;padding:0 7px;font-size:12px}
#fkf.fkf-min .fkf-body{display:none}
#fkf .fkf-body{padding:0 12px 12px}
#fkf input[type=text]{width:100%;padding:8px 10px;border:1px solid #8b94a3;border-radius:6px;font:inherit;background:#fff;color:inherit}
#fkf .fkf-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;max-height:220px;overflow:auto}
#fkf .fkf-chip{display:inline-flex;align-items:center;border:1px solid #c3ccd9;border-radius:14px;background:#f6f8fb;cursor:pointer;font-size:13px}
#fkf .fkf-chip span{padding:3px 4px 3px 10px}
#fkf .fkf-chip i{font-style:normal;padding:3px 8px 3px 2px;color:#8b94a3}
#fkf .fkf-chip i:hover{color:#d91f0a}
#fkf .fkf-chip.inc{background:#d7f5df;border-color:#1c9c46;color:#0b5a26}
#fkf .fkf-chip.exc{background:#ffe1dc;border-color:#d91f0a;color:#8a1305;text-decoration:line-through}
#fkf .fkf-row{display:flex;gap:6px;align-items:center}
#fkf button{font:inherit;padding:6px 10px;border-radius:6px;border:1px solid #c3ccd9;background:#fff;color:inherit;cursor:pointer}
#fkf button.fkf-primary{background:#0063fb;border-color:#0063fb;color:#fff;flex:1}
#fkf small{display:block;margin-top:8px;color:#5c6676;font-size:12px}
mark.fkf-hit{background:#ffe14d;color:#000;padding:0 2px;border-radius:2px}
#fkf-ad{position:fixed;right:16px;bottom:16px;z-index:99999;background:#fff;color:#1b1b1f;border:1px solid #c3ccd9;
  border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:8px 12px;font:13px/1.4 system-ui,sans-serif;cursor:pointer;max-width:300px}
`;
  function addStyle() {
    if (typeof GM_addStyle === 'function') return GM_addStyle(css);
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }
  function el(tag, props, children) {
    const e = Object.assign(document.createElement(tag), props || {});
    (children || []).forEach((c) => e.append(c));
    return e;
  }

  // ---------- filter panel on the search results page ----------
  let panel;
  function render() {
    if (!panel) {
      panel = el('div', { id: 'fkf' });
      document.body.appendChild(panel);
    }
    panel.className = state.collapsed ? 'fkf-min' : '';
    panel.textContent = '';

    const active = Object.keys(state.sel).length;
    const head = el('header', { title: 'Collapse / expand' }, [
      el('span', { textContent: '🔎 Keyword filter' }),
      active ? el('b', { textContent: String(active) }) : '',
      state.collapsed ? '▴' : '▾',
    ]);
    head.onclick = () => { state.collapsed = !state.collapsed; save(); render(); };

    const input = el('input', { type: 'text', placeholder: 'Type keywords, press Enter (comma to separate, -word to exclude)' });
    input.onkeydown = (ev) => {
      if (ev.key !== 'Enter') return;
      const terms = input.value.split(',').map((t) => t.trim().replace(/"/g, '')).filter(Boolean);
      if (!terms.length) return apply();
      terms.forEach((t) => {
        const neg = t.startsWith('-');
        const k = (neg ? t.slice(1) : t).trim().toLowerCase();
        if (!k) return;
        if (!state.keywords.includes(k)) state.keywords.push(k);
        state.sel[k] = neg ? -1 : 1;
      });
      apply();
    };

    const chips = el('div', { className: 'fkf-chips' });
    state.keywords.forEach((k) => {
      const v = state.sel[k] || 0;
      const chip = el('div', {
        className: 'fkf-chip' + (v === 1 ? ' inc' : v === -1 ? ' exc' : ''),
        title: 'Click: include this keyword · Click again: exclude · Again: off',
      });
      const label = el('span', { textContent: k });
      label.onclick = () => {
        if (v === 0) state.sel[k] = 1;
        else if (v === 1) state.sel[k] = -1;
        else delete state.sel[k];
        apply();
      };
      const del = el('i', { textContent: '×', title: 'Remove keyword from the list' });
      del.onclick = () => {
        state.keywords = state.keywords.filter((x) => x !== k);
        const was = state.sel[k];
        delete state.sel[k];
        if (was) apply(); else { save(); render(); }
      };
      chip.append(label, del);
      chips.append(chip);
    });

    const modeBtn = el('button', {
      textContent: state.mode === 'OR' ? 'Match: ANY keyword' : 'Match: ALL keywords',
      title: 'Toggle between OR and AND',
    });
    modeBtn.onclick = () => { state.mode = state.mode === 'OR' ? 'AND' : 'OR'; apply(); };
    const clearBtn = el('button', { textContent: 'Clear' });
    clearBtn.onclick = () => { state.sel = {}; apply(); };

    const q = buildQuery();
    panel.append(head, el('div', { className: 'fkf-body' }, [
      input,
      chips,
      el('div', { className: 'fkf-row' }, [modeBtn, clearBtn]),
      el('small', { textContent: q ? 'Filtering: ' + q : 'Green = must have · Red = exclude. FINN\'s other filters (area, price…) are kept.' }),
    ]));
  }

  // Sync the selection with the current ?q= in the URL (e.g. you opened a link that already has q, or typed into FINN's own search box).
  // Only accepted when every term in q is a known keyword; otherwise treat it as no selection.
  function syncWithUrl() {
    const q = (new URL(location.href).searchParams.get('q') || '').trim();
    if (q === buildQuery()) return;
    const sel = {};
    const tokens = (q.match(/-?"[^"]+"|[^\s()]+/g) || []).filter((t) => t !== 'OR');
    const known = tokens.every((t) => {
      const neg = t.startsWith('-');
      const k = t.replace(/^-/, '').replace(/"/g, '').toLowerCase();
      if (!state.keywords.includes(k)) return false;
      sel[k] = neg ? -1 : 1;
      return true;
    });
    state.sel = known ? sel : {};
    if (known && tokens.length > 1) state.mode = /\sOR\s/.test(q) ? 'OR' : 'AND';
    save();
    if (panel) render();
  }

  // ---------- highlight keywords on the ad page ----------
  function highlightAd() {
    const terms = state.keywords.filter((k) => state.sel[k] === 1);
    if (!terms.length) return;
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp('(' + terms.map(esc).join('|') + ')', 'gi');
    const root = document.querySelector('main') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement && !n.parentElement.closest('script,style,noscript,textarea,mark.fkf-hit,#fkf-ad') && re.test(n.nodeValue)
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const hits = [];
    nodes.forEach((n) => {
      const frag = document.createDocumentFragment();
      n.nodeValue.split(re).forEach((part, i) => {
        if (i % 2) {
          const m = el('mark', { className: 'fkf-hit', textContent: part });
          hits.push(m);
          frag.append(m);
        } else if (part) frag.append(part);
      });
      n.replaceWith(frag);
    });
    document.getElementById('fkf-ad')?.remove();
    let i = -1;
    const badge = el('div', { id: 'fkf-ad' });
    badge.textContent = hits.length
      ? `🔎 ${hits.length} match${hits.length === 1 ? '' : 'es'}: ${terms.join(', ')} — click to jump`
      : `🔎 "${terms.join(', ')}" not found in the visible text (it may be in an attachment / salgsoppgave)`;
    badge.onclick = () => {
      if (!hits.length) return badge.remove();
      i = (i + 1) % hits.length;
      hits[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    document.body.appendChild(badge);
  }

  // ---------- init ----------
  addStyle();
  if (/\/search\.html$/.test(location.pathname)) {
    syncWithUrl();
    render();
    // FINN changes the URL via pushState when you adjust its own filters → re-check periodically.
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) { last = location.href; syncWithUrl(); }
    }, 1000);
  } else if (/\/ad\.html$/.test(location.pathname)) {
    // Wait for the page to finish rendering its content before highlighting.
    setTimeout(highlightAd, 1200);
  }
})();
