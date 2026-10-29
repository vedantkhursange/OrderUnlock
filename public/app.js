import { drawStrip, drawFlow, drawFunnel, drawTile, drawSpark, drawOB, ringSVG, fmt, pct, istTime } from './charts.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let S = null;            // latest server state
let FLOW = {};           // per-stock intraday % series
const bySym = new Map();
const stockCache = new Map(); // sym -> { data, at }
let flowHL = null, stripHits = [], flowApi = null;
let sheet = null;        // { type, sym, list, idx }

// ------------------------------------------------------------------ theme
function setTheme(t) {
  document.documentElement.dataset.theme = t; store.set('theme', t);
  $$('[data-set-theme]').forEach((b) => b.classList.toggle('on', b.dataset.setTheme === t));
  if (S) renderAll(true);
}
setTheme(store.get('theme', 'dark'));
$$('[data-set-theme]').forEach((b) => (b.onclick = () => setTheme(b.dataset.setTheme)));
$$('[data-theme-toggle]').forEach((b) => (b.onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')));

// ------------------------------------------------------------------ nav
const nav = $('#nav'), scrim = $('#scrim');
$('#menuBtn').onclick = () => { nav.classList.add('open'); scrim.classList.add('on'); };
scrim.onclick = () => { nav.classList.remove('open'); scrim.classList.remove('on'); };
$$('.nav-item').forEach((a) => (a.onclick = () => { showPage(a.dataset.page); scrim.onclick(); }));
function showPage(p) {
  $$('.page').forEach((el) => el.classList.toggle('hidden', el.id !== p));
  $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.page === p));
  $('#tabs').classList.toggle('hidden', p !== 'home');
  if (p === 'journal') renderJournal();
  if (p === 'learn') renderLearn();
  if (p === 'settings') renderSettings();
  if (p === 'home' && S) requestAnimationFrame(() => renderAll(true));
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------------ tabs / scroll spy
$$('#tabs [data-jump]').forEach((b) => (b.onclick = () => jump(b.dataset.jump)));
function jump(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
const spy = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) {
    const id = e.target.id;
    const key = id.startsWith('bull') || id === 'top-bull' ? 'top-bull' : id.startsWith('bear') || id === 'top-bear' ? 'top-bear' : id;
    $$('#tabs [data-jump]').forEach((b) => b.classList.toggle('on', b.dataset.jump === key));
  }
}, { rootMargin: '-45% 0px -50% 0px' });
['market', 'flow', 'bull-contenders', 'top-bull', 'bear-contenders', 'top-bear'].forEach((id) => spy.observe(document.getElementById(id)));

// ------------------------------------------------------------------ data stream
function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('state', (e) => { S = JSON.parse(e.data); bySym.clear(); S.stocks.forEach((s) => bySym.set(s.sym, s)); patchFlow(); renderAll(); });
  es.addEventListener('flow', (e) => { FLOW = JSON.parse(e.data); patchFlow(); renderFlow(); });
  es.onerror = () => { $('#banner').classList.remove('hidden'); $('#banner span').textContent = 'Reconnecting to live feed…'; };
}
// keep the newest flow point in step with the 1s ticks
function patchFlow() {
  if (!S) return;
  for (const s of S.stocks) {
    const f = FLOW[s.sym]; if (!f || !f.t.length) continue;
    const t = Math.floor(S.asOf / 1000);
    if (t - f.t.at(-1) >= 180) { f.t.push(t); f.p.push(+s.chg.toFixed(3)); }
    else f.p[f.p.length - 1] = +s.chg.toFixed(3);
  }
}

// ------------------------------------------------------------------ render
const side = (s) => (s.side === 'bear' ? 'bear' : 'bull');
const statusLabel = (s) => (s.status === 'TOP' ? (s.side === 'bear' ? '▼ BEARISH' : '▲ BULLISH') : s.status);
const ini = (sym) => sym.replace(/[^A-Z]/g, '').slice(0, 2);
let lastTiersKey = '', lastSetupKey = '', lastSectorKey = '';

function renderAll(force) {
  if (!S || $('#home').classList.contains('hidden')) return;
  renderHeader();
  stripHits = drawStrip($('#strip'), S.stocks);
  renderSetups(force);
  renderSectors(force);
  renderFlow();
  renderTiers(force);
  renderTop('bull', force); renderTop('bear', force);
  if (sheet && sheet.type === 'stock') liveSheet();
}

function renderHeader() {
  const open = S.market === 'open';
  $$('[data-mkt]').forEach((el) => { el.classList.toggle('closed', !open); el.querySelector('b').textContent = open ? 'Open' : S.market === 'pre-open' ? 'Pre-open' : 'Closed'; });
  const stale = Date.now() - S.ts > 5000;
  const b = $('#banner');
  if (!open) { b.classList.remove('hidden'); $('#banner span').textContent = `Market closed · showing last session as of ${istTime(S.asOf / 1000)} IST`; }
  else if (stale) { b.classList.remove('hidden'); $('#banner span').textContent = 'Waiting for the next update…'; }
  else b.classList.add('hidden');
  $('#mktMeta').textContent = `${S.counts.total} STOCKS · AS OF ${new Date(S.asOf).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}`;
  $('#nBull').textContent = S.counts.bull; $('#nBear').textContent = S.counts.bear;
  $('#tFlow').textContent = S.counts.total; $('#tBull').textContent = S.counts.bull; $('#tBear').textContent = S.counts.bear;
  $('#idxRow').innerHTML = Object.entries(S.indices).map(([k, v]) => `<span class="idx">${k} <b>${fmt(v.price)}</b> <span class="${v.chg >= 0 ? 'up' : 'dn'}">${pct(v.chg)}</span></span>`).join('');
}

function renderSetups(force) {
  const bulls = S.stocks.filter((s) => s.side === 'bull').sort((a, b) => a.rank - b.rank).slice(0, 3);
  const bears = S.stocks.filter((s) => s.side === 'bear').sort((a, b) => a.rank - b.rank).slice(0, 3);
  const list = [...bulls, ...bears];
  const key = list.map((s) => s.sym).join();
  if (force || key !== lastSetupKey) {
    lastSetupKey = key;
    $('#setups').innerHTML = list.map((s) => `<div class="setup ${side(s)}" data-sym="${s.sym}"><div class="av">${ini(s.sym)}</div><div><b>${s.sym}</b><small></small></div></div>`).join('');
    $$('#setups .setup').forEach((el) => bindHold(el, () => jumpToTile(el.dataset.sym), () => openStock(el.dataset.sym, list.map((s) => s.sym))));
  }
  $$('#setups .setup').forEach((el) => { const s = bySym.get(el.dataset.sym); if (s) { const sm = el.querySelector('small'); sm.textContent = `${fmt(s.price)} ${pct(s.chg)}`; sm.className = s.chg >= 0 ? 'up' : 'dn'; } });
  $('#nSetups').textContent = list.length;
}

function bindHold(el, tap, hold) {
  let t = null, held = false;
  const start = () => { held = false; t = setTimeout(() => { held = true; hold(); }, 450); };
  const end = () => { clearTimeout(t); if (!held) tap(); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointerleave', () => clearTimeout(t));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(t); held = true; hold(); });
}

function sectors() {
  const m = new Map();
  for (const s of S.stocks) { const a = m.get(s.sector) || []; a.push(s); m.set(s.sector, a); }
  return [...m.entries()].map(([name, list]) => ({ name, list: list.sort((a, b) => b.chg - a.chg), avg: list.reduce((x, s) => x + s.chg, 0) / list.length })).sort((a, b) => b.avg - a.avg);
}
function renderSectors(force) {
  const secs = sectors();
  $('#nSectors').textContent = secs.length;
  const key = secs.map((s) => s.name).join();
  if (force || key !== lastSectorKey) {
    lastSectorKey = key;
    $('#sectors').innerHTML = secs.map((s) => `<div class="sector" data-sec="${s.name}"><div class="hd"><b>${s.name}</b><span></span></div><div class="segbar"></div></div>`).join('');
    $$('#sectors .sector').forEach((el) => (el.onclick = () => openSector(el.dataset.sec)));
  }
  for (const s of secs) {
    const el = $(`#sectors [data-sec="${CSS.escape(s.name)}"]`); if (!el) continue;
    const sp = el.querySelector('.hd span'); sp.textContent = pct(s.avg);
    sp.className = s.avg >= 0 ? 'up' : 'dn'; sp.style.background = s.avg >= 0 ? 'var(--gbg)' : 'var(--rbg)';
    el.querySelector('.segbar').innerHTML = s.list.map((x) => `<i style="background:${x.chg >= 0 ? 'var(--g)' : 'var(--r)'};opacity:${0.45 + Math.min(0.55, Math.abs(x.chg) / 3)}"></i>`).join('');
  }
}

function renderFlow() {
  if (!S) return;
  const syms = Object.keys(FLOW);
  if (syms.length) {
    const t = Math.max(...syms.map((k) => FLOW[k].t.at(-1) || 0));
    $('#flowRange').textContent = `09:15 → ${istTime(t)}`;
  }
  flowApi = drawFlow($('#flowCv'), FLOW, S.stocks, { highlight: flowHL, indices: S.indices });
}

// tiers: ranks 2–5, 6–10, 11–20 (wide→narrow towards the #1 card)
const TIERS = [[11, 20, 4], [6, 10, 3], [2, 5, 2]];
function renderTiers(force) {
  for (const sd of ['bull', 'bear']) {
    const list = S.stocks.filter((s) => s.side === sd && s.status !== 'HERD').sort((a, b) => a.rank - b.rank);
    $(sd === 'bull' ? '#nBullC' : '#nBearC').textContent = Math.max(0, list.length - 1);
    const key = sd + list.map((s) => s.sym).join();
    const host = $(sd === 'bull' ? '#tiersBull' : '#tiersBear');
    if (force || !host.dataset.key || host.dataset.key !== key) {
      host.dataset.key = key;
      host.innerHTML = TIERS.map(([a, b, cols]) => {
        const items = list.filter((s) => s.rank >= a && s.rank <= b);
        if (!items.length) return '';
        const h = cols === 4 ? 104 : cols === 3 ? 124 : 150;
        return `<div class="tier ${sd}-c"><div class="tier-h">RANK ${a}–${b}</div><div class="tier-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${items.map((s) => `
          <div class="tile ${sd}-c" data-sym="${s.sym}" style="height:${h}px"><canvas></canvas>
            <div class="lbl">${s.sym}<small class="${s.chg >= 0 ? 'up' : 'dn'}"></small></div><span class="rk">#${s.rank}</span>
            ${cols <= 2 ? `<span class="tg" style="color:var(--${sd === 'bull' ? 'g' : 'r'})">${s.tag || ''}</span>` : ''}</div>`).join('')}</div></div>`;
      }).join('');
      $$('.tile', host).forEach((el) => (el.onclick = () => openStock(el.dataset.sym, list.map((s) => s.sym))));
    }
    $$('.tile', host).forEach((el) => {
      const s = bySym.get(el.dataset.sym); if (!s) return;
      el.querySelector('small').textContent = `${fmt(s.price)} ${pct(s.chg)}`;
      drawTile(el.querySelector('canvas'), s);
    });
  }
}

async function getStock(sym, maxAge = 12000) {
  const c = stockCache.get(sym);
  if (c && Date.now() - c.at < maxAge) return c.data;
  const r = await fetch(`/api/stock/${encodeURIComponent(sym)}?bars=90`);
  if (!r.ok) return c?.data || null;
  const data = await r.json();
  stockCache.set(sym, { data, at: Date.now() });
  return data;
}

async function renderTop(sd, force) {
  const host = $(sd === 'bull' ? '#topBull' : '#topBear');
  const s = S.stocks.find((x) => x.side === sd && x.rank === 1);
  if (!s) { host.innerHTML = '<p class="muted">No setup yet</p>'; return; }
  host.className = `top-card ${sd}-c`;
  if (force || host.dataset.sym !== s.sym) {
    host.dataset.sym = s.sym;
    host.innerHTML = `
      <div class="tc-head"><div class="badge ${sd}">${sd === 'bull' ? 'BULLISH' : 'BEARISH'}</div><span data-ring></span>
        <div class="tc-sym">${s.sym}<small>${s.name} · ${s.sector}</small></div><div class="tc-px" data-px></div></div>
      <div class="tc-chart" style="--tcol:var(--${sd === 'bull' ? 'g' : 'r'})"><div class="tc-tag"><b data-tag></b><div data-sub></div></div><canvas></canvas></div>
      <div class="tc-levels" data-lv></div>`;
    host.onclick = () => openStock(s.sym, S.stocks.filter((x) => x.side === sd && x.status !== 'HERD').sort((a, b) => a.rank - b.rank).map((x) => x.sym));
  }
  host.querySelector('[data-ring]').innerHTML = ringSVG(s.score, sd);
  host.querySelector('[data-px]').innerHTML = `${fmt(s.price)}<small class="${s.chg >= 0 ? 'up' : 'dn'}">${pct(s.chg)} · ${s.chg >= 0 ? '+' : ''}${fmt(s.price - s.prev)}</small>`;
  host.querySelector('[data-tag]').textContent = s.tag || '';
  host.querySelector('[data-sub]').textContent = `RVOL ${s.rvol?.toFixed(2)}× · Δ VWAP ${pct(s.dvwap)}`;
  if (s.zone) host.querySelector('[data-lv]').innerHTML = `
    <div><span>Z</span>${fmt(s.zone.bot)} – ${fmt(s.zone.top)}</div><div class="s"><span>S1</span>${fmt(s.S[0])}</div>
    <div class="r"><span>R1</span>${fmt(s.R[0])}</div><div class="r"><span>R2</span>${fmt(s.R[1])}</div><div><span>R:R</span>${s.rr.toFixed(2)}</div>`;
  const data = await getStock(s.sym);
  if (data && host.dataset.sym === s.sym) drawOB(host.querySelector('canvas'), { ...data, analysis: { ...data.analysis, ...pick(s) } }, s);
}
const pick = (s) => ({ zone: s.zone, R: s.R, S: s.S, bias: s.bias });

function jumpToTile(sym) {
  const s = bySym.get(sym);
  let el = s && s.rank === 1 ? $(s.side === 'bear' ? '#topBear' : '#topBull') : $(`.tile[data-sym="${CSS.escape(sym)}"]`);
  if (!el) return openStock(sym);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ------------------------------------------------------------------ strip + flow interaction
const tip = $('#tip');
function showTip(e, html) { tip.innerHTML = html; tip.classList.remove('hidden'); tip.style.left = `${Math.min(innerWidth - 180, e.clientX + 12)}px`; tip.style.top = `${e.clientY + 12}px`; }
const hideTip = () => tip.classList.add('hidden');
function stripHit(e) {
  const r = e.target.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = null, bd = 10;
  for (const h of stripHits) { const d = Math.hypot(h.x - mx, h.y - my); if (d < (h.r || bd)) { bd = d; best = h.s; } }
  return best;
}
$('#strip').addEventListener('mousemove', (e) => { const s = stripHit(e); s ? showTip(e, `<b>${s.sym}</b> ${pct(s.chg)}<br>${s.sector}`) : hideTip(); });
$('#strip').addEventListener('mouseleave', hideTip);
$('#strip').addEventListener('click', (e) => { const s = stripHit(e); if (s) openStock(s.sym); });

const flowCv = $('#flowCv');
flowCv.addEventListener('mousemove', (e) => {
  if (!flowApi) return; const r = flowCv.getBoundingClientRect();
  const sym = flowApi.hit(e.clientX - r.left, e.clientY - r.top);
  const s = sym && bySym.get(sym);
  s ? showTip(e, `<b>${s.sym}</b> ${pct(s.chg)}`) : hideTip();
});
flowCv.addEventListener('mouseleave', hideTip);
flowCv.addEventListener('click', (e) => {
  if (!flowApi) return; const r = flowCv.getBoundingClientRect();
  const sym = flowApi.hit(e.clientX - r.left, e.clientY - r.top);
  flowHL = sym; renderFlow();
  if (sym) openStock(sym, null, 'compact');
});
$('#flowReset').onclick = () => { flowHL = null; renderFlow(); };

// ------------------------------------------------------------------ sheet
const sheetEl = $('#sheet'), sheetScrim = $('#sheetScrim');
function openSheet(html) { $('#sheetBody').innerHTML = html; sheetEl.classList.add('on'); sheetScrim.classList.add('on'); sheetEl.scrollTop = 0; }
function closeSheet() { sheetEl.classList.remove('on'); sheetScrim.classList.remove('on'); sheet = null; }
sheetScrim.onclick = closeSheet;
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!$('#search').classList.contains('hidden')) closeSearch(); else closeSheet(); }
  if (sheet?.list && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) step(e.key === 'ArrowRight' ? 1 : -1);
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); openSearch(); }
});
function step(d) { const { list, idx, mode } = sheet; const n = (idx + d + list.length) % list.length; openStock(list[n], list, mode); }

async function openStock(sym, list, mode = 'full') {
  const s = bySym.get(sym); if (!s) return;
  list = list && list.includes(sym) ? list : S.stocks.slice().sort((a, b) => b.score - a.score).map((x) => x.sym);
  const idx = list.indexOf(sym);
  sheet = { type: 'stock', sym, list, idx, mode };
  const sd = s.side === 'bear' ? 'bear' : 'bull';
  const st = s.status === 'HERD' ? 'herd' : '';
  openSheet(`
    <div class="sh-head ${sd}-c" style="--tcol:var(--${sd === 'bull' ? 'g' : 'r'})">
      <div class="sh-av">${ini(sym)}</div>
      <div class="sh-title"><b>${sym}</b><span class="st-badge ${st}">${statusLabel(s)}${s.rank ? ` #${s.rank}` : ''}</span><small>${s.name} · ${s.sector}</small></div>
      <div class="sh-nav"><button class="icon-btn" data-prev>‹</button><button class="icon-btn" data-next>›</button><button class="icon-btn x" data-close>✕</button></div>
    </div>
    <div class="sh-px"><b data-px></b><span data-chg></span>
      <div class="btns"><button class="pill-btn" data-go="flow">FLOW</button>${s.status !== 'HERD' ? '<button class="pill-btn" data-go="tile">TILE</button>' : ''}<button class="pill-btn" data-go="setup">SETUP</button><span class="muted">${idx + 1}/${list.length}</span></div></div>
    <div class="sh-spark"><canvas></canvas></div>
    ${mode === 'full' ? '<div class="sh-chart"><canvas></canvas></div>' : ''}
    <div class="stats" data-stats></div>
    ${mode === 'compact' ? '<p style="text-align:center;margin-top:14px"><button class="pill-btn" data-full>OPEN FULL CHART</button></p>' : ''}`);
  const b = $('#sheetBody');
  b.querySelector('[data-close]').onclick = closeSheet;
  b.querySelector('[data-prev]').onclick = () => step(-1);
  b.querySelector('[data-next]').onclick = () => step(1);
  b.querySelector('[data-full]')?.addEventListener('click', () => openStock(sym, list, 'full'));
  $$('[data-go]', b).forEach((btn) => (btn.onclick = () => {
    const go = btn.dataset.go; closeSheet();
    if (go === 'flow') { flowHL = sym; renderFlow(); jump('flow'); }
    if (go === 'tile') jumpToTile(sym);
    if (go === 'setup') {
      const el = $(`#setups [data-sym="${CSS.escape(sym)}"]`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
      else jumpToTile(sym);
    }
  }));
  liveSheet(true);
}

async function liveSheet(fetchNow) {
  if (!sheet || sheet.type !== 'stock') return;
  const sym = sheet.sym, s = bySym.get(sym); if (!s) return;
  const b = $('#sheetBody');
  b.querySelector('[data-px]').textContent = fmt(s.price);
  const ch = b.querySelector('[data-chg]'); ch.textContent = `${pct(s.chg)} · ${s.chg >= 0 ? '+' : ''}${fmt(s.price - s.prev)}`; ch.className = s.chg >= 0 ? 'up' : 'dn';
  const conv = Math.abs(s.score);
  const sd = s.side === 'bear' ? 'r' : 'g';
  b.querySelector('[data-stats]').innerHTML = s.zone ? `
    <div><span>RANK</span><b>${s.rank ? `#${s.rank} ${s.side === 'bear' ? 'BEAR' : 'BULL'}` : '—'} · ${s.status}</b></div>
    <div><span>CONV</span><b>${s.score > 0 ? '+' : ''}${s.score}<i class="conv"><i style="width:${conv}%;background:var(--${sd})"></i></i></b></div>
    <div><span>RVOL</span><b>${s.rvol.toFixed(2)}×</b></div>
    <div><span>Δ VWAP</span><b class="${s.dvwap >= 0 ? 'up' : 'dn'}">${pct(s.dvwap)}</b></div>
    <div><span>VWAP</span><b>${fmt(s.vwap)}</b></div>
    <div><span>OB</span><b>${fmt(s.zone.bot)} – ${fmt(s.zone.top)}</b></div>
    <div><span>Z / S1</span><b>${fmt(s.side === 'bear' ? s.zone.bot : s.zone.top)} / ${fmt(s.S[0])}</b></div>
    <div><span>R1 / R2</span><b>${fmt(s.R[0])} / ${fmt(s.R[1])}</b></div>
    <div><span>R:R</span><b>${s.rr.toFixed(2)}</b></div>
    <div><span>STRUCTURE</span><b>${s.structure === 'bull' ? 'BOS ↑' : s.structure === 'bear' ? 'BOS ↓' : '—'}</b></div>
    <div><span>DAY H / L</span><b>${fmt(s.dayHigh)} / ${fmt(s.dayLow)}</b></div>
    <div><span>TAG</span><b>${s.tag}</b></div>
    <div style="grid-column:1/-1"><span>RULE</span><b>${s.rule}</b></div>` : '<div><span>Loading analysis…</span></div>';
  const data = await getStock(sym, fetchNow ? 4000 : 10000);
  if (!data || !sheet || sheet.sym !== sym) return;
  drawSpark(b.querySelector('.sh-spark canvas'), { ...data.intraday, c: [...data.intraday.c.slice(0, -1), s.price] });
  const cv = b.querySelector('.sh-chart canvas');
  if (cv) drawOB(cv, { ...data, analysis: { ...data.analysis, ...pick(s) } }, s);
}

function openSector(name) {
  const sec = sectors().find((x) => x.name === name); if (!sec) return;
  sheet = { type: 'sector', name };
  const up = sec.list.filter((s) => s.chg >= 0).length;
  openSheet(`
    <div class="sh-head"><div class="sh-title"><b>${name} <span class="${sec.avg >= 0 ? 'up' : 'dn'} mono">${pct(sec.avg)}</span></b>
      <small>${sec.list.length} STOCKS · <span class="up">▲ ${up}</span> <span class="dn">▼ ${sec.list.length - up}</span></small></div>
      <div class="sh-nav"><button class="icon-btn x" data-close>✕</button></div></div>
    <div class="segbar" style="height:6px;margin:14px 0 6px">${sec.list.map((x) => `<i style="background:${x.chg >= 0 ? 'var(--g)' : 'var(--r)'}"></i>`).join('')}</div>
    <div class="sec-list">${sec.list.map((s) => `<div class="row" data-sym="${s.sym}"><b>${s.sym}</b><span class="nm">${s.name}</span>
      <span class="mono ${s.chg >= 0 ? 'up' : 'dn'}">${pct(s.chg)}</span>
      <span class="st ${s.status === 'HERD' ? '' : s.side === 'bear' ? 'dn' : 'up'}" style="${s.status === 'HERD' ? 'color:var(--tx3)' : ''}">${statusLabel(s)}${s.status !== 'HERD' ? ` #${s.rank}` : ''}</span></div>`).join('')}</div>`);
  $('#sheetBody [data-close]').onclick = closeSheet;
  $$('#sheetBody .row').forEach((r) => (r.onclick = () => openStock(r.dataset.sym, sec.list.map((s) => s.sym))));
}

// ------------------------------------------------------------------ search
const search = $('#search'), q = $('#q');
function openSearch() { search.classList.remove('hidden'); q.value = ''; runSearch(); q.focus(); }
function closeSearch() { search.classList.add('hidden'); }
$('#searchBtn').onclick = openSearch; $('#qClose').onclick = closeSearch;
q.oninput = runSearch;
q.onkeydown = (e) => { if (e.key === 'Enter') { const f = $('#qRes .q-row'); if (f) { closeSearch(); openStock(f.dataset.sym); } } };
function runSearch() {
  if (!S) return;
  const v = q.value.trim().toUpperCase();
  const res = S.stocks.filter((s) => !v || s.sym.includes(v) || s.name.toUpperCase().includes(v) || s.sector.toUpperCase().includes(v)).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 30);
  $('#qRes').innerHTML = res.map((s) => `<div class="q-row" data-sym="${s.sym}"><b>${s.sym}</b><span class="nm">${s.name} · ${s.sector}</span><span class="mono">${fmt(s.price)}</span><span class="mono ${s.chg >= 0 ? 'up' : 'dn'}">${pct(s.chg)}</span></div>`).join('');
  $$('#qRes .q-row').forEach((r) => (r.onclick = () => { closeSearch(); openStock(r.dataset.sym); }));
}

// ------------------------------------------------------------------ sub pages
function renderJournal() {
  const rows = store.get('journal', []);
  const pnl = (r) => (r.exit ? (r.side === 'LONG' ? r.exit - r.entry : r.entry - r.exit) * r.qty : null);
  const total = rows.reduce((a, r) => a + (pnl(r) || 0), 0);
  const wins = rows.filter((r) => pnl(r) > 0).length, closed = rows.filter((r) => r.exit).length;
  $('#journal').innerHTML = `<div class="subpage"><h1>Trading Journal</h1><p class="lead">Log trades from the scanner. Stored privately in this browser.</p>
    <div class="card"><div class="form">
      <input id="jSym" placeholder="Symbol" list="jSyms" /><datalist id="jSyms">${(S?.stocks || []).map((s) => `<option value="${s.sym}">`).join('')}</datalist>
      <select id="jSide"><option>LONG</option><option>SHORT</option></select>
      <input id="jEntry" type="number" step="0.05" placeholder="Entry" /><input id="jExit" type="number" step="0.05" placeholder="Exit (optional)" />
      <input id="jQty" type="number" placeholder="Qty" /><button class="btn" id="jAdd">Add trade</button>
    </div></div>
    <div class="card"><h3>Total P&amp;L <span class="mono ${total >= 0 ? 'up' : 'dn'}">₹${fmt(total)}</span> · Win rate ${closed ? Math.round((wins / closed) * 100) : 0}% · ${rows.length} trades</h3>
    <table class="j"><tr><th>Date</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>Qty</th><th>LTP</th><th>P&amp;L</th><th></th></tr>
    ${rows.map((r, i) => { const l = bySym.get(r.sym)?.price; const p = pnl(r) ?? (l ? (r.side === 'LONG' ? l - r.entry : r.entry - l) * r.qty : null);
      return `<tr><td>${r.date}</td><td><b>${r.sym}</b></td><td>${r.side}</td><td class="n">${fmt(r.entry)}</td><td class="n">${r.exit ? fmt(r.exit) : 'open'}</td><td class="n">${r.qty}</td><td class="n">${l ? fmt(l) : '—'}</td><td class="n ${p >= 0 ? 'up' : 'dn'}">${p == null ? '—' : '₹' + fmt(p)}</td><td><button data-del="${i}">✕</button></td></tr>`; }).join('')}</table></div></div>`;
  $('#jSym').oninput = (e) => { const s = bySym.get(e.target.value.toUpperCase()); if (s) $('#jEntry').value = s.price; };
  $('#jAdd').onclick = () => {
    const sym = $('#jSym').value.trim().toUpperCase(), entry = +$('#jEntry').value, qty = +$('#jQty').value;
    if (!sym || !entry || !qty) return;
    rows.unshift({ date: new Date().toLocaleDateString('en-IN'), sym, side: $('#jSide').value, entry, exit: +$('#jExit').value || null, qty });
    store.set('journal', rows); renderJournal();
  };
  $$('[data-del]').forEach((b) => (b.onclick = () => { rows.splice(+b.dataset.del, 1); store.set('journal', rows); renderJournal(); }));
}

function renderLearn() {
  const items = [
    ['Order Block (OB)', 'The last opposite-colour candle before an impulsive move that breaks market structure. Bullish OB = last red candle before a rally that closes above a swing high; bearish OB = last green candle before a drop below a swing low. Price often revisits these zones.'],
    ['Break of Structure (BOS)', 'A close beyond the most recent fractal swing high (bullish) or swing low (bearish). The direction of the latest BOS is the stock\'s structure.'],
    ['Mitigation', 'An order block is mitigated (invalidated) once a candle closes through it. Only unmitigated blocks are used for the active zone Z.'],
    ['Z / S1–S3 / R1–R3', 'Z is the active order block edge. S levels are swing lows / supports below price, R levels are swing highs / resistances above. All are derived from 5-minute candles over the last 5 sessions.'],
    ['Fair Value Gap (FVG)', 'A three-candle imbalance where candle 1 and candle 3 do not overlap. Unfilled gaps are shaded faintly on the chart.'],
    ['VWAP & Δ VWAP', 'Volume-weighted average price for today (blue dashed line). Δ VWAP is the distance of price from VWAP in %.'],
    ['Conviction score', 'A −100…+100 blend of day change, distance from VWAP, EMA-20 slope, EMA 20/50 trend, last BOS direction, proximity to a live order block, scaled by relative volume.'],
    ['TOP · CONTENDER · HERD', 'Stocks are ranked per side by conviction. #1 is the TOP setup, ranks 2–20 are contenders shown as tiles, everyone else is herd.'],
    ['R:R', 'Reward-to-risk: distance from price to the first target at least 1 ATR away, divided by distance to the stop just beyond the order block.'],
    ['Flow', 'Every stock\'s % change from previous close through the session. Green lines finish up, red finish down; blue lines are NIFTY and BANKNIFTY. Click any line to isolate it.'],
    ['Tiles', 'Volume-by-price profile: green bars from the left are up-candle volume, red bars from the right are down-candle volume. Dashed line = live price, shaded band = active OB.'],
  ];
  $('#learn').innerHTML = `<div class="subpage"><h1>Learn</h1><p class="lead">How OrderUnlock reads the market.</p>${items.map(([h, p]) => `<div class="card"><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>`;
}

function renderSettings() {
  $('#settings').innerHTML = `<div class="subpage"><h1>Settings</h1><p class="lead">Everything is free and unlocked. Preferences stay in this browser.</p>
    <div class="card"><h3>Theme</h3><p><button class="pill-btn" data-t="dark">Dark</button> <button class="pill-btn" data-t="light">Light</button></p></div>
    <div class="card"><h3>Data</h3><p>Prices: Yahoo Finance public NSE feed, polled about once a second for ${S?.counts.total ?? '—'} F&amp;O stocks. Structure: 5-minute candles, last 5 sessions, refreshed continuously.</p></div>
    <div class="card"><h3>Shortcuts</h3><p><b>/</b> search · <b>←/→</b> previous / next stock in a modal · <b>Esc</b> close</p></div></div>`;
  $$('[data-t]').forEach((b) => (b.onclick = () => setTheme(b.dataset.t)));
}

// ------------------------------------------------------------------ loops
let ft = 0;
function animate(t) {
  if (!$('#home').classList.contains('hidden') && S) {
    const nb = S.stocks.filter((s) => s.side === 'bull' && s.status !== 'HERD').length;
    const nr = S.stocks.filter((s) => s.side === 'bear' && s.status !== 'HERD').length;
    if (t - ft > 33) { drawFunnel($('#funnelBull'), nb, '--g', t); drawFunnel($('#funnelBear'), nr, '--r', t); ft = t; }
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
addEventListener('resize', () => renderAll(true));
connect();
