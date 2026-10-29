// Canvas renderers for every OrderUnlock visual.
export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const istTime = (t) => new Date(t * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);

function alpha(hex, a) {
  if (hex.startsWith('rgb')) return hex.replace(/rgba?\(([^)]+?)(,\s*[\d.]+)?\)/, (_, c) => `rgba(${c},${a})`);
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export { alpha };

export function setup(cv) {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  const w = Math.max(10, r.width), h = Math.max(10, r.height);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const font = (px, w = 600, mono = true) => `${w} ${px}px ${mono ? "'JetBrains Mono', monospace" : 'Inter, sans-serif'}`;

// ---------------------------------------------------------------- market strip
export function drawStrip(cv, stocks) {
  const { ctx, w, h } = setup(cv);
  const G = css('--g'), R = css('--r'), TX = css('--tx'), TX3 = css('--tx3'), LINE = css('--line');
  const padL = 30, padR = w < 500 ? 84 : 110, mid = h * 0.58;
  const max = Math.max(1, ...stocks.map((s) => Math.abs(s.chg))) * 1.05;
  const X = (v) => padL + ((v + max) / (2 * max)) * (w - padL - padR);
  const hits = [];

  // glow band
  const gr = ctx.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, alpha(R, 0.08)); gr.addColorStop(0.5, 'transparent'); gr.addColorStop(1, alpha(G, 0.08));
  ctx.fillStyle = gr; ctx.fillRect(padL, 8, w - padL - padR, h - 16);

  ctx.strokeStyle = LINE; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, mid); ctx.lineTo(w - padR, mid); ctx.stroke();

  // histogram stacks
  const bw = 7; const bins = new Map();
  for (const s of stocks) {
    const b = Math.round(X(s.chg) / bw);
    const arr = bins.get(b) || []; arr.push(s); bins.set(b, arr);
  }
  for (const [b, arr] of bins) {
    arr.sort((a, c) => Math.abs(a.chg) - Math.abs(c.chg));
    arr.forEach((s, k) => {
      const x = b * bw, up = s.chg >= 0;
      const y = up ? mid - 6 - k * 6 : mid + 6 + k * 6;
      const c = up ? G : R;
      ctx.fillStyle = alpha(c, 0.35 + Math.min(0.6, Math.abs(s.chg) / max));
      ctx.fillRect(x - 2, y - 2, 4, 4);
      if (s.status === 'TOP' || s.status === 'CONTENDER') { ctx.strokeStyle = c; ctx.strokeRect(x - 3, y - 3, 6, 6); }
      hits.push({ x, y, s });
    });
  }
  // zero marker
  const zx = X(0);
  ctx.strokeStyle = alpha(TX, 0.35); ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(zx, 12); ctx.lineTo(zx, h - 12); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = TX; ctx.shadowColor = TX; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(zx, mid, 4, 0, 7); ctx.fill(); ctx.shadowBlur = 0;

  // extremes
  const sorted = [...stocks].sort((a, b) => a.chg - b.chg);
  const ext = [[sorted[0], R, -1], [sorted.at(-1), G, 1]];
  for (const [s, c, dir] of ext) {
    if (!s) continue;
    const x = X(s.chg);
    ctx.strokeStyle = c; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, mid, 7, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, mid, 11, 0, 7); ctx.strokeStyle = alpha(c, 0.4); ctx.stroke();
    ctx.setLineDash([2, 3]); ctx.strokeStyle = alpha(c, 0.6);
    ctx.beginPath(); ctx.moveTo(x, mid - 12); ctx.lineTo(x, 26); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = font(11, 700); ctx.fillStyle = c;
    const label = `${s.sym} ${pct(s.chg)}`;
    const tw = ctx.measureText(label).width;
    const lx = Math.min(w - padR - tw, Math.max(4, x - tw / 2));
    ctx.fillText(label, lx, 20);
    ctx.fillText(dir > 0 ? '↗' : '↘', lx + tw + 4, 20);
    hits.push({ x, y: mid, s, r: 12 });
  }
  // axis labels
  ctx.font = font(10, 500); ctx.fillStyle = TX3;
  ctx.fillText(pct(-max).replace('+', ''), padL, h - 4);
  const t = pct(max); ctx.fillText(t, w - padR - ctx.measureText(t).width, h - 4);
  return hits;
}

// ---------------------------------------------------------------- flow
// Each stock's % change from previous close across the session.
export function drawFlow(cv, flow, stocks, opts = {}) {
  const { ctx, w, h } = setup(cv);
  const G = css('--g'), R = css('--r'), TX = css('--tx'), TX3 = css('--tx3'), LINE = css('--line'), BLUE = css('--blue');
  const padL = 46, padR = 70, padT = 16, padB = 28;
  const series = Object.entries(flow).filter(([, s]) => s.t.length);
  if (!series.length) { ctx.fillStyle = TX3; ctx.font = font(12); ctx.fillText('Loading session flow…', padL, h / 2); return { hit: () => null }; }

  const day0 = series[0][1].t[0];
  const istMid = day0 - ((day0 + 19800) % 86400);
  const t0 = istMid + 9 * 3600 + 15 * 60, t1 = istMid + 15 * 3600 + 30 * 60;
  let max = 0.5;
  for (const [, s] of series) for (const p of s.p) max = Math.max(max, Math.abs(p));
  max *= 1.08;
  const plotR = w - padR;
  const X = (t) => padL + ((t - t0) / (t1 - t0)) * (plotR - padL);
  const Y = (p) => padT + ((max - p) / (2 * max)) * (h - padT - padB);
  const byS = new Map(stocks.map((s) => [s.sym, s]));

  // grid + labels
  ctx.font = font(10, 500); ctx.fillStyle = TX3; ctx.strokeStyle = LINE; ctx.lineWidth = 1;
  const step = max > 6 ? 2 : max > 3 ? 1 : 0.5;
  for (let p = -Math.floor(max / step) * step; p <= max; p += step) {
    const y = Y(p);
    ctx.globalAlpha = p === 0 ? 0 : 0.5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(plotR, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(`${p > 0 ? '+' : ''}${p.toFixed(1)}`, 4, y + 3);
  }
  for (const hh of [10, 11, 12, 13, 14, 15]) {
    const t = istMid + hh * 3600; const x = X(t);
    ctx.fillText(`${hh}:00`, x - 14, h - 8);
  }
  // side gauge
  ctx.fillStyle = alpha(G, 0.7); ctx.fillRect(padL - 12, padT, 3, Y(0) - padT);
  ctx.fillStyle = alpha(R, 0.7); ctx.fillRect(padL - 12, Y(0), 3, h - padB - Y(0));

  // distribution on the right
  const ends = series.map(([, s]) => s.p.at(-1));
  const bins = 60, dens = new Array(bins).fill(0);
  for (const e of ends) dens[Math.max(0, Math.min(bins - 1, Math.floor(((max - e) / (2 * max)) * bins)))]++;
  const dmax = Math.max(...dens);
  for (let i = 0; i < bins; i++) {
    const y = padT + (i / bins) * (h - padT - padB), bh = (h - padT - padB) / bins;
    const p = max - (i + 0.5) * (2 * max / bins);
    ctx.fillStyle = alpha(p >= 0 ? G : R, 0.12 + 0.5 * dens[i] / dmax);
    ctx.fillRect(plotR + 6, y, (dens[i] / dmax) * (padR - 12), bh - 1);
  }

  // lines
  const hl = opts.highlight;
  const drawLine = (sym, s, style) => {
    ctx.beginPath();
    s.t.forEach((t, i) => { const x = X(t), y = Y(s.p[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    Object.assign(ctx, style); ctx.stroke();
  };
  ctx.lineJoin = 'round';
  for (const [sym, s] of series) {
    const st = byS.get(sym); const last = s.p.at(-1);
    const c = last >= 0 ? G : R;
    const strong = st && (st.status === 'TOP' || st.status === 'CONTENDER');
    drawLine(sym, s, { strokeStyle: alpha(c, hl ? 0.07 : strong ? 0.55 : 0.18), lineWidth: strong ? 1.2 : 0.8, shadowBlur: 0 });
  }
  // indices
  for (const [name, val] of Object.entries(opts.indices || {})) {
    const y = Y(val.chg);
    ctx.strokeStyle = alpha(BLUE, 0.8); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(plotR, y); ctx.stroke();
    ctx.fillStyle = BLUE; ctx.font = font(10, 700); ctx.fillText(`${name} ${pct(val.chg)}`, padL + 6, y - 4);
  }
  // zero line
  ctx.strokeStyle = TX; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(plotR, Y(0)); ctx.stroke();
  for (const x of [padL, plotR]) { ctx.fillStyle = TX; ctx.beginPath(); ctx.arc(x, Y(0), 4, 0, 7); ctx.fill(); }
  // now marker
  const lastT = Math.max(...series.map(([, s]) => s.t.at(-1)));
  ctx.strokeStyle = alpha(TX, 0.6); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X(lastT), padT); ctx.lineTo(X(lastT), h - padB); ctx.stroke();
  ctx.fillStyle = TX; ctx.font = font(10, 700); ctx.fillText(istTime(lastT), X(lastT) - 16, h - 8);

  // TOP boxes around the 5 strongest endpoints on each side
  const box = (list, c, label, top) => {
    if (!list.length) return;
    const ys = list.map((sym) => Y(flow[sym].p.at(-1)));
    const y0 = Math.min(...ys) - 8, y1 = Math.max(...ys) + 8, x0 = X(lastT) - 4, x1 = plotR + 4;
    ctx.fillStyle = alpha(c, 0.12); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + dx * 8, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * 8); ctx.stroke();
    }
    ctx.font = font(10, 800); ctx.fillStyle = c;
    ctx.fillText(label, x1 - 52, top ? y0 - 6 : y1 + 14);
  };
  const ranked = (side) => stocks.filter((s) => s.side === side && s.rank <= 5 && flow[s.sym]).map((s) => s.sym);
  box(ranked('bull'), G, '▲ TOP 5', true);
  box(ranked('bear'), R, '▼ TOP 5', false);

  if (hl && flow[hl]) {
    const s = flow[hl]; const c = s.p.at(-1) >= 0 ? G : R;
    drawLine(hl, s, { strokeStyle: c, lineWidth: 2.5, shadowColor: c, shadowBlur: 14 });
    ctx.shadowBlur = 0;
    const lx = X(s.t.at(-1)), ly = Y(s.p.at(-1));
    ctx.setLineDash([3, 3]); ctx.strokeStyle = alpha(TX, 0.5); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(plotR, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = TX; ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 7); ctx.fill();
    ctx.strokeStyle = TX; ctx.beginPath(); ctx.arc(lx, ly, 9, 0, 7); ctx.stroke();
    ctx.font = font(12, 800); ctx.fillStyle = c; ctx.fillText(`${hl} ${pct(s.p.at(-1))}`, padL + 8, ly - 8);
  }

  return {
    hit(mx, my) {
      let best = null, bd = 14;
      for (const [sym, s] of series) {
        for (let i = 0; i < s.t.length; i++) {
          const x = X(s.t[i]); if (Math.abs(x - mx) > 6) continue;
          const d = Math.abs(Y(s.p[i]) - my); if (d < bd) { bd = d; best = sym; }
        }
      }
      return best;
    },
  };
}

// ---------------------------------------------------------------- funnel
export function drawFunnel(cv, n, color, phase) {
  const { ctx, w, h } = setup(cv);
  const c = css(color);
  const bx0 = w * 0.25, bx1 = w * 0.75, by = 12;
  ctx.strokeStyle = c; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx0 + 6, by - 6); ctx.lineTo(bx0, by - 6); ctx.lineTo(bx0, by + 6); ctx.lineTo(bx0 + 6, by + 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx1 - 6, by - 6); ctx.lineTo(bx1, by - 6); ctx.lineTo(bx1, by + 6); ctx.lineTo(bx1 - 6, by + 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx0, by); ctx.lineTo(bx1, by); ctx.stroke();
  const k = Math.max(4, Math.min(20, n));
  for (let i = 0; i < k; i++) {
    const sx = bx0 + ((i + 0.5) / k) * (bx1 - bx0);
    ctx.beginPath(); ctx.moveTo(sx, by - 4); ctx.lineTo(sx, by + 4); ctx.stroke();
    const ex = 16 + (((i * 7) % k) + 0.5) / k * (w - 32);
    ctx.strokeStyle = alpha(c, 0.45); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, by); ctx.bezierCurveTo(sx, h * 0.6, ex, h * 0.3, ex, h - 6); ctx.stroke();
    // particle
    const t = (phase / 2400 + i / k) % 1;
    const u = 1 - t;
    const px = u * u * u * sx + 3 * u * u * t * sx + 3 * u * t * t * ex + t * t * t * ex;
    const py = u * u * u * by + 3 * u * u * t * h * 0.6 + 3 * u * t * t * h * 0.3 + t * t * t * (h - 6);
    ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(px, py, 1.8, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = c; ctx.lineWidth = 1.5;
  }
  ctx.strokeStyle = alpha(c, 0.6);
  ctx.beginPath(); ctx.moveTo(8, h - 6); ctx.quadraticCurveTo(w / 2, h - 40, w - 8, h - 6); ctx.stroke();
}

// ---------------------------------------------------------------- tile (volume by price)
export function drawTile(cv, s) {
  const { ctx, w, h } = setup(cv);
  const G = css('--g'), R = css('--r'), TX = css('--tx'), AM = css('--amber');
  const p = s.profile; if (!p) return;
  const n = p.up.length, rowH = (h - 40) / n, top = 30;
  const vmax = Math.max(1, ...p.up.map((u, i) => u + p.dn[i]));
  const Y = (price) => top + ((p.hi - price) / (p.hi - p.lo || 1)) * (h - 40);
  for (let i = 0; i < n; i++) {
    const y = top + (n - 1 - i) * rowH;
    const gu = (p.up[i] / vmax) * (w * 0.7), gd = (p.dn[i] / vmax) * (w * 0.7);
    ctx.fillStyle = alpha(G, 0.65); ctx.fillRect(8, y, gu, rowH - 1.5);
    ctx.fillStyle = alpha(R, 0.65); ctx.fillRect(w - 8 - gd, y, gd, rowH - 1.5);
  }
  if (s.zone) {
    const y0 = Y(s.zone.top), y1 = Y(s.zone.bot);
    ctx.fillStyle = alpha(s.side === 'bear' ? R : G, 0.18); ctx.fillRect(0, Math.min(y0, y1), w, Math.max(2, Math.abs(y1 - y0)));
  }
  const py = Y(s.price);
  ctx.setLineDash([3, 3]); ctx.strokeStyle = alpha(TX, 0.8); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(4, py); ctx.lineTo(w - 10, py); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = TX; ctx.beginPath(); ctx.moveTo(w - 2, py - 4); ctx.lineTo(w - 9, py); ctx.lineTo(w - 2, py + 4); ctx.fill();
  if (s.vwap) { const vy = Y(s.vwap); ctx.fillStyle = AM; ctx.fillRect(2, vy - 1, 4, 2); }
}

// ---------------------------------------------------------------- sparkline
export function drawSpark(cv, intraday) {
  const { ctx, w, h } = setup(cv);
  const { c, prev } = intraday; if (!c || !c.length) return;
  const lo = Math.min(prev, ...c), hi = Math.max(prev, ...c);
  const X = (i) => (i / Math.max(1, c.length - 1)) * (w - 8) + 2;
  const Y = (v) => 4 + ((hi - v) / (hi - lo || 1)) * (h - 8);
  const col = css(c.at(-1) >= prev ? '--g' : '--r');
  ctx.setLineDash([2, 3]); ctx.strokeStyle = alpha(css('--tx3'), 0.6);
  ctx.beginPath(); ctx.moveTo(0, Y(prev)); ctx.lineTo(w, Y(prev)); ctx.stroke(); ctx.setLineDash([]);
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, alpha(col, 0.25)); g.addColorStop(1, alpha(col, 0));
  ctx.beginPath(); c.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.lineTo(X(c.length - 1), h); ctx.lineTo(X(0), h); ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = css('--tx'); ctx.beginPath(); ctx.arc(X(c.length - 1), Y(c.at(-1)), 3, 0, 7); ctx.fill();
}

// ---------------------------------------------------------------- order block chart
export function drawOB(cv, data, live) {
  const { ctx, w, h } = setup(cv);
  const G = css('--g'), R = css('--r'), TX = css('--tx'), TX3 = css('--tx3'), LINE = css('--line'), AM = css('--amber'), BLUE = css('--blue');
  const a = data.analysis; const { c, vwap, ema } = data.series;
  if (!c.length) return;
  const candles = c.map((k) => ({ ...k }));
  if (live && live.price) { const L = candles.at(-1); L.c = live.price; L.h = Math.max(L.h, live.price); L.l = Math.min(L.l, live.price); }
  const price = candles.at(-1).c;
  const padL = 8, padR = 92, padT = 14, padB = 22;
  const levels = a ? [...a.R, ...a.S, a.zone.top, a.zone.bot] : [];
  let lo = Math.min(...candles.map((k) => k.l)), hi = Math.max(...candles.map((k) => k.h));
  for (const l of levels) { if (l > lo - (hi - lo) * 0.25 && l < hi + (hi - lo) * 0.25) { lo = Math.min(lo, l); hi = Math.max(hi, l); } }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const n = candles.length, cw = (w - padL - padR) / n;
  const X = (i) => padL + i * cw + cw / 2;
  const Y = (v) => padT + ((hi - v) / (hi - lo)) * (h - padT - padB);
  const idxOf = (t) => { let i = candles.findIndex((k) => k.t >= t); return i < 0 ? -1 : i; };

  // grid
  ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.font = font(9, 500); ctx.fillStyle = TX3;
  for (let i = 0; i <= 4; i++) { const y = padT + (i / 4) * (h - padT - padB); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.globalAlpha = 1; }
  for (let i = 0; i < n; i += Math.ceil(n / 6)) { ctx.fillText(istTime(candles[i].t), X(i) - 12, h - 6); ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(X(i), padT); ctx.lineTo(X(i), h - padB); ctx.stroke(); ctx.globalAlpha = 1; }

  if (a) {
    // historical order blocks
    for (const ob of a.obs) {
      const i = idxOf(ob.t); if (i < 0) continue;
      const col = ob.dir === 'bull' ? G : R;
      ctx.fillStyle = alpha(col, ob.mitigated ? 0.05 : 0.12);
      ctx.strokeStyle = alpha(col, ob.mitigated ? 0.15 : 0.45);
      const x0 = X(i) - cw / 2, x1 = ob.mitigated ? Math.min(w - padR, x0 + cw * 14) : w - padR;
      ctx.fillRect(x0, Y(ob.top), x1 - x0, Y(ob.bot) - Y(ob.top));
      ctx.strokeRect(x0, Y(ob.top), x1 - x0, Y(ob.bot) - Y(ob.top));
    }
    for (const g of a.fvg) {
      const i = idxOf(g.t); if (i < 0) continue;
      ctx.fillStyle = alpha(g.dir === 'bull' ? G : R, 0.06);
      ctx.fillRect(X(i), Y(g.top), w - padR - X(i), Y(g.bot) - Y(g.top));
    }
    // active zone
    const zc = a.bias === 'bear' ? R : G;
    ctx.fillStyle = alpha(zc, 0.22); ctx.fillRect(padL, Y(a.zone.top), w - padR - padL, Math.max(2, Y(a.zone.bot) - Y(a.zone.top)));
    ctx.strokeStyle = zc; ctx.lineWidth = 1; ctx.strokeRect(padL, Y(a.zone.top), w - padR - padL, Math.max(2, Y(a.zone.bot) - Y(a.zone.top)));
    ctx.font = font(10, 800); ctx.fillStyle = TX; ctx.fillText('OB', w - padR - 70, Y(a.zone.bot) + 11);
  }

  // VWAP + EMA
  const line = (arr, col, dash, width) => {
    ctx.beginPath(); ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = width;
    arr.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke(); ctx.setLineDash([]);
  };
  line(vwap, alpha(BLUE, 0.9), [4, 3], 1.3);
  line(ema, alpha(TX, 0.35), [], 1);

  // candles
  candles.forEach((k, i) => {
    const up = k.c >= k.o, col = up ? G : R;
    ctx.strokeStyle = col; ctx.fillStyle = up ? alpha(G, 0.9) : alpha(R, 0.9); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(i), Y(k.h)); ctx.lineTo(X(i), Y(k.l)); ctx.stroke();
    const bw = Math.max(1.5, cw * 0.62), y0 = Y(Math.max(k.o, k.c)), y1 = Y(Math.min(k.o, k.c));
    ctx.fillRect(X(i) - bw / 2, y0, bw, Math.max(1, y1 - y0));
  });

  // levels with right-hand labels
  const lbl = (y, text, val, col) => {
    ctx.strokeStyle = alpha(col, 0.7); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR + 4, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = font(10, 800); ctx.fillStyle = col; ctx.fillText(text, w - padR + 8, y + 3);
    ctx.font = font(10, 600); ctx.fillStyle = alpha(col, 0.85); ctx.fillText(fmt(val, val > 1000 ? 0 : 1), w - padR + 30, y + 3);
  };
  if (a) {
    const placed = [];
    const put = (text, v, col) => { const y = Y(v); if (y < padT - 2 || y > h - padB + 2) return; if (placed.some((p) => Math.abs(p - y) < 11)) return; placed.push(y); lbl(y, text, v, col); };
    put('Z', a.bias === 'bear' ? a.zone.bot : a.zone.top, TX);
    a.R.forEach((v, i) => put(`R${i + 1}`, v, G));
    a.S.forEach((v, i) => put(`S${i + 1}`, v, AM));
  }

  // price
  const py = Y(price), px = X(n - 1);
  ctx.strokeStyle = alpha(TX, 0.55); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(w - padR + 4, py); ctx.stroke();
  ctx.fillStyle = TX; ctx.shadowColor = TX; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(w - padR + 4, py, 3.5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = alpha(TX, 0.5); ctx.beginPath(); ctx.arc(w - padR + 4, py, 8, 0, 7); ctx.stroke();
}

export function ringSVG(score, side) {
  const v = Math.min(100, Math.abs(score)), r = 19, C = 2 * Math.PI * r;
  const col = side === 'bear' ? 'var(--r)' : 'var(--g)';
  return `<svg class="ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r="${r}" stroke="var(--line2)" stroke-width="4" fill="none"/><circle cx="24" cy="24" r="${r}" stroke="${col}" stroke-width="4" fill="none" stroke-dasharray="${(v / 100) * C} ${C}" transform="rotate(-90 24 24)" stroke-linecap="round"/><text x="24" y="28" text-anchor="middle" font-size="12" font-weight="800" fill="var(--tx)" stroke="none" font-family="JetBrains Mono">${v}</text></svg>`;
}
