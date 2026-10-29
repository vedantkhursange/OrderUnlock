// Desktop pipeline: flow → narrowing contender columns → top 3 per side, all on one screen.
import { setup, css, alpha, fmt, pct, istTime, drawTile, drawOB, drawStrip, ringSVG } from './charts.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// columns left → right: [from rank, to rank, kind]
const COLS = [[18, 24, 'mini'], [11, 17, 'mini'], [7, 10, 'tag'], [4, 6, 'prof'], [1, 3, 'top']];

let ctx = null;          // { getS, getFlow, bySym, getStock, openStock }
let geo = null;          // flow geometry for hit tests
let spot = null;         // spotlighted symbol
let sectorSpot = null;   // spotlighted sector
let key = '';
let popSym = null;

export function initPipeline(c) {
  ctx = c;
  const root = $('#pipeline');
  root.innerHTML = `
    <div class="p-top"><canvas id="pStrip"></canvas></div>
    <div class="p-body" id="pBody">
      <canvas id="pFlow"></canvas>
      <canvas id="pLinks"></canvas>
      <div class="p-sectors" id="pSectors"></div>
      <div class="p-cols" id="pCols"><div class="p-half bull" id="pBull"></div><div class="p-half bear" id="pBear"></div></div>
      <div class="p-pop hidden" id="pPop"></div>
    </div>`;
  const fl = $('#pFlow');
  fl.addEventListener('mousemove', (e) => {
    const r = fl.getBoundingClientRect();
    const sym = hit(e.clientX - r.left, e.clientY - r.top);
    if (sym) { if (sym !== spot) setSpot(sym, true); }
  });
  fl.addEventListener('mouseleave', (e) => { if (!e.relatedTarget?.closest?.('#pPop')) clearSpot(); });
  fl.addEventListener('click', () => { if (spot) ctx.openStock(spot); });
  $('#pPop').addEventListener('mouseleave', clearSpot);
  $('#pPop').addEventListener('click', () => popSym && ctx.openStock(popSym));
  $('#pStrip').addEventListener('click', (e) => {
    const S = ctx.getS(); if (!S) return;
    const r = e.target.getBoundingClientRect();
    const hits = drawStrip(e.target, S.stocks);
    let best = null, bd = 12;
    for (const h of hits) { const d = Math.hypot(h.x - (e.clientX - r.left), h.y - (e.clientY - r.top)); if (d < bd) { bd = d; best = h.s; } }
    if (best) ctx.openStock(best.sym);
  });
}

export function spotlight(sym, withPop = true) { setSpot(sym, withPop); }

function setSpot(sym, withPop) {
  spot = sym; sectorSpot = null;
  $('#pBody').classList.add('dim');
  $$('.p-card.spot').forEach((el) => el.classList.remove('spot'));
  $(`.p-card[data-sym="${CSS.escape(sym)}"]`)?.classList.add('spot');
  const s = ctx.bySym.get(sym);
  $$('.p-sec').forEach((el) => el.classList.toggle('on', s && el.dataset.sec === s.sector));
  drawFlowAndLinks();
  if (withPop) showPop(sym); else $('#pPop').classList.add('hidden');
}
function clearSpot() {
  spot = null; sectorSpot = null; popSym = null;
  $('#pBody').classList.remove('dim');
  $$('.p-card.spot').forEach((el) => el.classList.remove('spot'));
  $$('.p-sec.on').forEach((el) => el.classList.remove('on'));
  $('#pPop').classList.add('hidden');
  drawFlowAndLinks();
}

// ------------------------------------------------------------------ render
export function renderPipeline(force) {
  const S = ctx.getS(); if (!S) return;
  drawStrip($('#pStrip'), S.stocks);
  buildCols(force);
  updateCards();
  buildSectors();
  drawFlowAndLinks();
  if (popSym) showPop(popSym);
}

function sideList(side) {
  return ctx.getS().stocks.filter((s) => s.side === side && s.rank && s.rank <= 24).sort((a, b) => a.rank - b.rank);
}

function buildCols(force) {
  const k = ['bull', 'bear'].map((sd) => sideList(sd).map((s) => s.sym).join()).join('|');
  if (!force && k === key) return;
  key = k;
  for (const sd of ['bull', 'bear']) {
    const list = sideList(sd);
    $(sd === 'bull' ? '#pBull' : '#pBear').innerHTML = COLS.map(([a, b, kind]) => `
      <div class="p-col ${kind}">${list.filter((s) => s.rank >= a && s.rank <= b).map((s) => card(s, kind, sd)).join('')}</div>`).join('');
  }
  $$('.p-card').forEach((el) => {
    el.onmouseenter = () => setSpot(el.dataset.sym, false);
    el.onmouseleave = clearSpot;
    el.onclick = () => ctx.openStock(el.dataset.sym, sideList(el.dataset.side).map((s) => s.sym));
  });
  if (spot) $(`.p-card[data-sym="${CSS.escape(spot)}"]`)?.classList.add('spot');
}

function card(s, kind, sd) {
  const c = sd === 'bull' ? 'g' : 'r';
  if (kind === 'top') return `
    <div class="p-card top ${sd}-c" data-sym="${s.sym}" data-side="${sd}">
      <div class="pt-l">
        <div class="pt-sym"><b>${s.sym}</b><small>#${s.rank}</small></div>
        <div class="pt-badge-row"><span class="badge ${sd}">${sd === 'bull' ? 'BULLISH' : 'BEARISH'}</span><span data-ring></span></div>
        <div class="pt-px mono" data-px></div>
      </div>
      <div class="pt-r"><span class="pt-tag" style="color:var(--${c})" data-tag></span><canvas data-chart></canvas></div>
      <div class="pt-lv mono" data-lv></div>
    </div>`;
  return `
    <div class="p-card ${kind} ${sd}-c" data-sym="${s.sym}" data-side="${sd}">
      <canvas data-prof></canvas>
      <div class="pc-lbl"><b>${s.sym}</b><small class="mono" data-chg></small></div>
      <span class="pc-rk mono">#${s.rank}</span>
      ${kind !== 'mini' ? `<span class="pc-tag" style="color:var(--${c})" data-tag></span>` : ''}
    </div>`;
}

function updateCards() {
  for (const el of $$('.p-card')) {
    const s = ctx.bySym.get(el.dataset.sym); if (!s) continue;
    const chg = el.querySelector('[data-chg]');
    if (chg) { chg.textContent = pct(s.chg); chg.className = `mono ${s.chg >= 0 ? 'up' : 'dn'}`; }
    const tag = el.querySelector('[data-tag]');
    if (tag) tag.textContent = s.tag || '';
    const prof = el.querySelector('[data-prof]');
    if (prof) drawTile(prof, s);
    if (el.classList.contains('top')) {
      el.querySelector('[data-ring]').innerHTML = ringSVG(s.score, el.dataset.side);
      el.querySelector('[data-px]').innerHTML = `${fmt(s.price)} <span class="${s.chg >= 0 ? 'up' : 'dn'}">${pct(s.chg)}</span>`;
      if (s.zone) el.querySelector('[data-lv]').innerHTML = s.side === 'bear'
        ? `<span><i>RES</i>${fmt(s.zone.top)}</span><span><i>ZONE</i>${fmt(s.zone.bot)}</span><span class="s"><i>S1</i>${fmt(s.S[0])}</span><span class="s"><i>S2</i>${fmt(s.S[1])}</span><span><i>R:R</i>${s.rr.toFixed(2)}</span>`
        : `<span class="s"><i>SUP</i>${fmt(s.S[0])}</span><span><i>ZONE</i>${fmt(s.zone.top)}</span><span class="r"><i>R1</i>${fmt(s.R[0])}</span><span class="r"><i>R2</i>${fmt(s.R[1])}</span><span><i>R:R</i>${s.rr.toFixed(2)}</span>`;
      const cv = el.querySelector('[data-chart]');
      ctx.getStock(s.sym).then((d) => { if (d && cv.isConnected) drawOB(cv, { ...d, series: { ...d.series, c: d.series.c.slice(-60), vwap: d.series.vwap.slice(-60), ema: d.series.ema.slice(-60) }, analysis: { ...d.analysis, zone: s.zone, R: s.R, S: s.S, bias: s.bias } }, s, { compact: true }); });
    }
  }
}

// ------------------------------------------------------------------ flow + links
function drawFlowAndLinks() {
  const S = ctx.getS(), FLOW = ctx.getFlow(); if (!S) return;
  const body = $('#pBody');
  const W = body.clientWidth, H = body.clientHeight;
  const colsX = $('#pCols').offsetLeft;
  const fl = $('#pFlow'); fl.style.width = `${colsX}px`;
  const { ctx: g, w, h } = setup(fl);
  const G = css('--g'), R = css('--r'), TX = css('--tx'), TX3 = css('--tx3'), LINE = css('--line'), BLUE = css('--blue');
  const series = Object.entries(FLOW).filter(([, s]) => s.t.length);
  if (!series.length) return;

  const day0 = series[0][1].t[0];
  const istMid = day0 - ((day0 + 19800) % 86400);
  const t0 = istMid + 9 * 3600 + 15 * 60, t1 = istMid + 15 * 3600 + 30 * 60;
  const lastT = Math.max(...series.map(([, s]) => s.t.at(-1)));
  let max = 0.5; for (const [, s] of series) for (const p of s.p) max = Math.max(max, Math.abs(p)); max *= 1.06;
  const padT = 10, padB = 22, mid = h / 2;
  const nowX = w * 0.72;
  const X = (t) => 4 + ((t - t0) / (Math.max(lastT, t0 + 3600) - t0)) * (nowX - 4);
  const Y = (p) => mid - (p / max) * (mid - padT);
  geo = { X, Y, series, nowX };

  // axes
  g.font = "500 9px 'JetBrains Mono'"; g.fillStyle = TX3;
  for (const hh of [10, 11, 12, 13, 14, 15]) { const t = istMid + hh * 3600; if (t > lastT - 1500) break; g.fillText(`${hh}:00`, X(t) - 12, h - 6); }
  g.strokeStyle = LINE; g.lineWidth = 1;
  for (const p of [-4, -3, -2, -1, 1, 2, 3, 4, 5, 6]) { if (Math.abs(p) > max) continue; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(0, Y(p)); g.lineTo(nowX, Y(p)); g.stroke(); g.globalAlpha = 1; g.fillText(`${p > 0 ? '+' : ''}${p}%`, nowX - 30, Y(p) - 2); }
  // side gauges
  g.fillStyle = alpha(G, 0.8); g.fillRect(0, padT, 2, mid - padT);
  g.fillStyle = alpha(R, 0.8); g.fillRect(0, mid, 2, h - padB - mid);

  const by = ctx.bySym;
  const dim = Boolean(spot || sectorSpot);
  g.lineJoin = 'round';
  for (const [sym, s] of series) {
    const st = by.get(sym); const c = s.p.at(-1) >= 0 ? G : R;
    const inSec = sectorSpot && st && st.sector === sectorSpot;
    const strong = st && st.status !== 'HERD';
    g.beginPath(); s.t.forEach((t, i) => (i ? g.lineTo(X(t), Y(s.p[i])) : g.moveTo(X(t), Y(s.p[i]))));
    g.strokeStyle = alpha(c, dim ? (inSec ? 0.8 : 0.05) : strong ? 0.5 : 0.16);
    g.lineWidth = inSec ? 1.4 : strong ? 1.1 : 0.8; g.stroke();
  }
  // index lines
  for (const [name, v] of Object.entries(S.indices || {})) {
    const y = Y(v.chg); g.strokeStyle = alpha(BLUE, dim ? 0.25 : 0.85); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, y); g.lineTo(nowX, y); g.stroke();
    g.fillStyle = BLUE; g.font = "700 9px 'JetBrains Mono'"; g.fillText(`${name} ${pct(v.chg)}`, nowX - 120, y - 3);
  }
  // now bar + zero line
  g.fillStyle = alpha(TX, 0.85); g.fillRect(nowX - 1, padT, 2, h - padT - padB);
  g.font = "700 9px 'JetBrains Mono'"; g.fillText(istTime(lastT), nowX - 15, h - 6);
  g.strokeStyle = TX; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
  g.fillStyle = TX; g.beginPath(); g.arc(4, mid, 3.5, 0, 7); g.fill();

  // end-of-session density between now bar and the columns
  const ends = series.map(([sym, s]) => ({ sym, p: s.p.at(-1) }));
  const bins = 70, dens = new Array(bins).fill(0);
  for (const e of ends) dens[Math.max(0, Math.min(bins - 1, Math.floor(((max - e.p) / (2 * max)) * bins)))]++;
  const dmax = Math.max(...dens), dw = w - nowX - 14;
  for (let i = 0; i < bins; i++) {
    const y0 = padT + (i / bins) * (h - padT - padB), bh = (h - padT - padB) / bins;
    const p = max - (i + 0.5) * (2 * max / bins);
    g.fillStyle = alpha(p >= 0 ? G : R, dim ? 0.06 : 0.1 + 0.35 * dens[i] / dmax);
    g.fillRect(nowX + 4, y0, (dens[i] / dmax) * dw * 0.55, bh - 1);
  }

  // spotlight
  if (spot && FLOW[spot]) {
    const s = FLOW[spot], c = s.p.at(-1) >= 0 ? G : R;
    g.beginPath(); s.t.forEach((t, i) => (i ? g.lineTo(X(t), Y(s.p[i])) : g.moveTo(X(t), Y(s.p[i]))));
    g.strokeStyle = c; g.lineWidth = 2.6; g.shadowColor = c; g.shadowBlur = 16; g.stroke(); g.shadowBlur = 0;
    const ly = Y(s.p.at(-1));
    g.setLineDash([3, 3]); g.strokeStyle = alpha(TX, 0.45); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, ly); g.lineTo(nowX, ly); g.stroke(); g.setLineDash([]);
    g.fillStyle = TX; g.beginPath(); g.arc(nowX, ly, 4, 0, 7); g.fill();
    g.strokeStyle = TX; g.beginPath(); g.arc(nowX, ly, 9, 0, 7); g.stroke();
  }

  drawLinks(W, H, colsX, nowX, Y, mid, ends);
}

function drawLinks(W, H, colsX, nowX, Y, mid, ends) {
  const lk = $('#pLinks');
  const { ctx: g } = setup(lk);
  const G = css('--g'), R = css('--r'), TX = css('--tx');
  const bodyR = $('#pBody').getBoundingClientRect();
  // zero line continues through the columns
  g.strokeStyle = alpha(TX, 0.7); g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(colsX, mid); g.lineTo(W, mid); g.stroke();
  for (const el of $$('.p-card')) {
    const sym = el.dataset.sym, e = ends.find((x) => x.sym === sym); if (!e) continue;
    const r = el.getBoundingClientRect();
    const x1 = r.left - bodyR.left, y1 = r.top - bodyR.top + r.height / 2;
    const x0 = nowX + 2, y0 = Y(e.p);
    // only the first column connects straight from the flow; later columns hand off from the previous one
    const col = el.parentElement, first = col === col.parentElement.firstElementChild;
    if (!first) continue;
    const c = el.dataset.side === 'bull' ? G : R;
    const on = spot === sym;
    g.strokeStyle = alpha(c, spot ? (on ? 1 : 0.06) : 0.35); g.lineWidth = on ? 2 : 1;
    if (on) { g.shadowColor = c; g.shadowBlur = 10; }
    g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(x0 + (x1 - x0) * 0.5, y0, x0 + (x1 - x0) * 0.5, y1, x1, y1); g.stroke();
    g.shadowBlur = 0;
  }
  // spotlighted card in a later column: draw its hand-off path
  if (spot) {
    const el = $(`.p-card[data-sym="${CSS.escape(spot)}"]`), e = ends.find((x) => x.sym === spot);
    if (el && e && el.parentElement !== el.parentElement.parentElement.firstElementChild) {
      const r = el.getBoundingClientRect(), c = el.dataset.side === 'bull' ? G : R;
      const x1 = r.left - bodyR.left, y1 = r.top - bodyR.top + r.height / 2, x0 = nowX + 2, y0 = Y(e.p);
      g.strokeStyle = c; g.lineWidth = 2; g.shadowColor = c; g.shadowBlur = 10;
      g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(x0 + (x1 - x0) * 0.4, y0, x0 + (x1 - x0) * 0.6, y1, x1, y1); g.stroke(); g.shadowBlur = 0;
    }
  }
}

function hit(mx, my) {
  if (!geo) return null;
  const FLOW = ctx.getFlow();
  let best = null, bd = 12;
  for (const [sym, s] of geo.series) {
    if (mx > geo.nowX + 4) { const d = Math.abs(geo.Y(s.p.at(-1)) - my); if (d < bd) { bd = d; best = sym; } continue; }
    for (let i = 0; i < s.t.length; i++) {
      const x = geo.X(s.t[i]); if (Math.abs(x - mx) > 5) continue;
      const d = Math.abs(geo.Y(FLOW[sym].p[i]) - my); if (d < bd) { bd = d; best = sym; }
    }
  }
  return best;
}

// ------------------------------------------------------------------ sectors aligned to the flow scale
function buildSectors() {
  const S = ctx.getS(); if (!geo) return;
  const m = new Map();
  for (const s of S.stocks) { const a = m.get(s.sector) || []; a.push(s); m.set(s.sector, a); }
  const secs = [...m.entries()].map(([name, list]) => ({ name, list: list.sort((a, b) => b.chg - a.chg), avg: list.reduce((x, s) => x + s.chg, 0) / list.length })).sort((a, b) => b.avg - a.avg);
  const host = $('#pSectors');
  if (host.childElementCount !== secs.length) {
    host.innerHTML = secs.map((s) => `<div class="p-sec" data-sec="${s.name}"><span class="nm"></span><span class="v mono"></span><div class="segbar"></div></div>`).join('');
    $$('.p-sec', host).forEach((el) => {
      el.onmouseenter = () => { sectorSpot = el.dataset.sec; spot = null; $('#pBody').classList.add('dim'); el.classList.add('on'); drawFlowAndLinks(); };
      el.onmouseleave = () => { el.classList.remove('on'); clearSpot(); };
      el.onclick = () => ctx.openSector(el.dataset.sec);
    });
  }
  // stack rows by avg %, nudged apart so they never overlap
  const rowH = 17; const placed = [];
  const H = $('#pBody').clientHeight;
  for (const s of secs) {
    let y = geo.Y(s.avg) - rowH / 2;
    for (const p of placed) if (Math.abs(p - y) < rowH) y = p + (s.avg >= 0 ? rowH : rowH);
    y = Math.max(4, Math.min(H - 30, y)); placed.push(y);
    const el = $(`.p-sec[data-sec="${CSS.escape(s.name)}"]`, host);
    el.style.transform = `translateY(${y}px)`;
    el.querySelector('.nm').textContent = s.name;
    const v = el.querySelector('.v'); v.textContent = pct(s.avg); v.className = `v mono ${s.avg >= 0 ? 'up' : 'dn'}`;
    el.querySelector('.segbar').innerHTML = s.list.map((x) => `<i style="background:${x.chg >= 0 ? 'var(--g)' : 'var(--r)'}"></i>`).join('');
  }
}

// ------------------------------------------------------------------ hover card
function showPop(sym) {
  const s = ctx.bySym.get(sym), f = ctx.getFlow()[sym]; if (!s || !f || !geo) return;
  popSym = sym;
  const pop = $('#pPop');
  const y = geo.Y(f.p.at(-1));
  const c = s.side === 'bear' ? 'r' : 'g';
  pop.innerHTML = `
    <div class="pp-h"><b>${s.sym}</b><span class="st-badge ${s.status === 'HERD' ? 'herd' : ''}" style="--tc:var(--${c});--tcol:var(--${c})">${s.status}${s.rank ? ` #${s.rank}` : ''}</span></div>
    <div class="pp-n">${s.name} · ${s.sector}</div>
    <div class="pp-px mono">${fmt(s.price)} <span class="${s.chg >= 0 ? 'up' : 'dn'}">${pct(s.chg)}</span></div>
    <canvas class="pp-spark"></canvas>
    <div class="pp-g mono">
      <span>CONV</span><b>${s.score > 0 ? '+' : ''}${s.score}</b>
      <span>Δ VWAP</span><b class="${s.dvwap >= 0 ? 'up' : 'dn'}">${pct(s.dvwap)}</b>
      <span>OI</span><b>${s.oi != null ? `${fmtL(s.oi)} <em class="${s.dOIpct >= 0 ? 'up' : 'dn'}">${pct(s.dOIpct)}</em>` : '—'}</b>
      <span>TAG</span><b>${s.tag || '—'}</b>
    </div>
    <div class="pp-f">Click for full chart →</div>`;
  const bw = $('#pBody').clientWidth;
  const left = Math.min(geo.nowX - 250, bw - 250);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${Math.max(6, Math.min($('#pBody').clientHeight - 200, y - (y < $('#pBody').clientHeight / 2 ? -14 : 196)))}px`;
  pop.classList.remove('hidden');
  // tiny sparkline from the session flow
  const cv = pop.querySelector('.pp-spark');
  const { ctx: g, w, h } = setup(cv);
  const lo = Math.min(0, ...f.p), hi = Math.max(0, ...f.p);
  const col = css(f.p.at(-1) >= 0 ? '--g' : '--r');
  g.beginPath(); f.p.forEach((p, i) => { const x = (i / (f.p.length - 1)) * w, yy = 2 + ((hi - p) / (hi - lo || 1)) * (h - 4); i ? g.lineTo(x, yy) : g.moveTo(x, yy); });
  g.strokeStyle = col; g.lineWidth = 1.5; g.stroke();
}

export const fmtL = (n) => (n >= 1e7 ? `${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`);
