// Order block / market structure engine. Pure functions over 5m OHLCV candles.

const IST_OFFSET = 19800;
const istDay = (t) => Math.floor((t + IST_OFFSET) / 86400);

export function atr(c, n = 14) {
  if (c.length < 2) return 0;
  let s = 0, k = 0;
  for (let i = Math.max(1, c.length - n); i < c.length; i++) {
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    k++;
  }
  return s / k;
}

export function ema(values, n) {
  const k = 2 / (n + 1);
  const out = [];
  let e = values[0];
  for (const v of values) { e = v * k + e * (1 - k); out.push(e); }
  return out;
}

// Session VWAP series (resets every IST day).
export function vwap(c) {
  const out = [];
  let pv = 0, vv = 0, day = null;
  for (const k of c) {
    const d = istDay(k.t);
    if (d !== day) { day = d; pv = 0; vv = 0; }
    const tp = (k.h + k.l + k.c) / 3;
    pv += tp * (k.v || 1); vv += k.v || 1;
    out.push(pv / vv);
  }
  return out;
}

// Fractal pivots: bar whose high/low is the extreme of `w` bars on each side.
export function pivots(c, w = 3) {
  const highs = [], lows = [];
  for (let i = w; i < c.length - w; i++) {
    let hi = true, lo = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h) hi = false;
      if (c[j].l <= c[i].l) lo = false;
    }
    if (hi) highs.push({ i, p: c[i].h, t: c[i].t });
    if (lo) lows.push({ i, p: c[i].l, t: c[i].t });
  }
  return { highs, lows };
}

// Order blocks from breaks of structure (BOS):
//  bullish OB = last down candle before the impulse that closed above a swing high
//  bearish OB = last up candle before the impulse that closed below a swing low
export function orderBlocks(c, piv, a) {
  const blocks = [];
  const used = new Set();
  const scan = (swings, dir) => {
    for (const s of swings) {
      for (let i = s.i + 1; i < c.length; i++) {
        const broke = dir === 'bull' ? c[i].c > s.p : c[i].c < s.p;
        if (!broke) continue;
        // walk back to the origin candle of the impulse
        let j = i;
        while (j > Math.max(0, i - 12)) {
          const isOpp = dir === 'bull' ? c[j].c < c[j].o : c[j].c > c[j].o;
          if (isOpp) break;
          j--;
        }
        if (used.has(`${dir}${j}`)) break;
        used.add(`${dir}${j}`);
        const k = c[j];
        const move = dir === 'bull' ? c[i].c - k.l : k.h - c[i].c;
        if (move < a * 1.2) break; // needs displacement
        const ob = { dir, i: j, t: k.t, top: k.h, bot: k.l, bos: s.p, bosI: i, mitigated: false, tested: false };
        for (let m = i + 1; m < c.length; m++) {
          if (dir === 'bull') {
            if (c[m].c < ob.bot) { ob.mitigated = true; ob.mitI = m; break; }
            if (c[m].l <= ob.top) ob.tested = true;
          } else {
            if (c[m].c > ob.top) { ob.mitigated = true; ob.mitI = m; break; }
            if (c[m].h >= ob.bot) ob.tested = true;
          }
        }
        blocks.push(ob);
        break;
      }
    }
  };
  scan(piv.highs, 'bull');
  scan(piv.lows, 'bear');
  return blocks.sort((x, y) => x.i - y.i);
}

// Fair value gaps (3-candle imbalance), unfilled only.
export function fvgs(c) {
  const out = [];
  for (let i = 2; i < c.length; i++) {
    if (c[i].l > c[i - 2].h) out.push({ dir: 'bull', i: i - 1, top: c[i].l, bot: c[i - 2].h });
    if (c[i].h < c[i - 2].l) out.push({ dir: 'bear', i: i - 1, top: c[i - 2].l, bot: c[i].h });
  }
  return out.filter((g) => {
    for (let m = g.i + 2; m < c.length; m++) {
      if (g.dir === 'bull' && c[m].l <= g.bot) return false;
      if (g.dir === 'bear' && c[m].h >= g.top) return false;
    }
    return true;
  }).slice(-6);
}

const uniqLevels = (arr, gap) => {
  const out = [];
  for (const p of arr) if (!out.some((q) => Math.abs(q - p) < gap)) out.push(p);
  return out;
};

// Volume-by-price profile for the current session (used by tiles).
export function profile(c, bins = 24) {
  if (!c.length) return null;
  const lo = Math.min(...c.map((k) => k.l)), hi = Math.max(...c.map((k) => k.h));
  const step = (hi - lo) / bins || 1;
  const up = new Array(bins).fill(0), dn = new Array(bins).fill(0);
  for (const k of c) {
    const b = Math.min(bins - 1, Math.floor(((k.h + k.l) / 2 - lo) / step));
    (k.c >= k.o ? up : dn)[b] += k.v || 1;
  }
  return { lo, hi, up, dn };
}

export function analyze(sym, candles, quote, oi = null) {
  if (!candles || candles.length < 30 || !quote) return null;
  const c = candles;
  const price = quote.price;
  const prev = quote.prevClose || c[0].o;
  const a = atr(c) || price * 0.003;
  const piv = pivots(c);
  const obs = orderBlocks(c, piv, a);
  const gaps = fvgs(c);
  const vw = vwap(c);
  const e20 = ema(c.map((k) => k.c), 20);
  const e50 = ema(c.map((k) => k.c), 50);
  const today = istDay(c.at(-1).t);
  const todays = c.filter((k) => istDay(k.t) === today);
  const vwapNow = vw.at(-1);
  const chg = ((price - prev) / prev) * 100;

  const liveBull = obs.filter((o) => o.dir === 'bull' && !o.mitigated && o.bot < price);
  const liveBear = obs.filter((o) => o.dir === 'bear' && !o.mitigated && o.top > price);
  const nearBull = liveBull.sort((x, y) => y.top - x.top)[0];
  const nearBear = liveBear.sort((x, y) => x.bot - y.bot)[0];

  // Structure: direction of the most recent break of structure.
  const lastBos = obs.length ? obs.reduce((x, y) => (y.bosI > x.bosI ? y : x)) : null;
  const structure = lastBos ? lastBos.dir : 'none';

  // Relative volume: today vs same number of bars on prior days.
  const priorDays = c.filter((k) => istDay(k.t) < today);
  const avgBar = priorDays.length ? priorDays.reduce((s, k) => s + k.v, 0) / priorDays.length : 0;
  const todayBar = todays.length ? todays.reduce((s, k) => s + k.v, 0) / todays.length : 0;
  const rvol = avgBar ? todayBar / avgBar : 1;

  // Conviction score in [-100, 100]: positive = bullish.
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  const slope = (e20.at(-1) - e20.at(-7)) / a;
  let s = 0;
  s += clamp(chg * 9, 30);                                  // day move
  s += clamp(((price - vwapNow) / a) * 8, 18);              // vs VWAP
  s += clamp(slope * 6, 14);                                // EMA20 slope
  s += e20.at(-1) > e50.at(-1) ? 8 : -8;                    // trend stack
  s += structure === 'bull' ? 12 : structure === 'bear' ? -12 : 0;
  if (nearBull && price - nearBull.top < a * 1.5) s += 6;   // sitting on demand
  if (nearBear && nearBear.bot - price < a * 1.5) s -= 6;   // under supply
  if (oi && oi.buildup) {                                   // futures OI confirmation
    const w = Math.min(1, Math.abs(oi.dOIpct || 0) / 5);
    s += { 'LONG BUILD-UP': 14, 'SHORT COVERING': 7, 'LONG UNWINDING': -7, 'SHORT BUILD-UP': -14 }[oi.buildup] * (0.4 + 0.6 * w);
  }
  s *= Math.min(1.35, 0.8 + rvol * 0.25);                   // volume confirmation
  const score = Math.round(100 * Math.tanh(s / 70));
  const bias = score >= 25 ? 'bull' : score <= -25 ? 'bear' : 'neutral';

  // Levels
  const gap = a * 0.6;
  const highsAbove = uniqLevels(piv.highs.map((p) => p.p).filter((p) => p > price).sort((x, y) => x - y), gap);
  const lowsBelow = uniqLevels(piv.lows.map((p) => p.p).filter((p) => p < price).sort((x, y) => y - x), gap);
  const dayHigh = Math.max(...todays.map((k) => k.h)), dayLow = Math.min(...todays.map((k) => k.l));
  const R = uniqLevels([...highsAbove, ...(dayHigh > price ? [dayHigh] : [])].sort((x, y) => x - y), gap);
  const S = uniqLevels([...lowsBelow, ...(dayLow < price ? [dayLow] : [])].sort((x, y) => y - x), gap);
  while (R.length < 3) R.push((R.at(-1) ?? price) + a * 1.5);
  while (S.length < 3) S.push((S.at(-1) ?? price) - a * 1.5);

  const zone = bias === 'bear'
    ? (nearBear ? { top: nearBear.top, bot: nearBear.bot } : { top: price + a * 0.5, bot: price })
    : (nearBull ? { top: nearBull.top, bot: nearBull.bot } : { top: price, bot: price - a * 0.5 });

  let rr, stop, target;
  if (bias === 'bear') {
    stop = zone.top + a * 0.15; target = S.find((l) => price - l >= a) ?? S.at(-1);
    rr = (price - target) / Math.max(stop - price, a * 0.25);
  } else {
    stop = zone.bot - a * 0.15; target = R.find((l) => l - price >= a) ?? R.at(-1);
    rr = (target - price) / Math.max(price - stop, a * 0.25);
  }

  // Pattern tag from price/volume behaviour.
  let pattern = 'RANGE';
  const inBull = nearBull && price <= nearBull.top + a * 0.3;
  const inBear = nearBear && price >= nearBear.bot - a * 0.3;
  if (lastBos && lastBos.bosI >= c.length - 6) pattern = lastBos.dir === 'bull' ? 'BOS ↑ BREAKOUT' : 'BOS ↓ BREAKDOWN';
  else if (inBull && bias !== 'bear') pattern = 'DEMAND RETEST';
  else if (inBear && bias !== 'bull') pattern = 'SUPPLY RETEST';
  else if (chg > 0 && rvol > 1.2) pattern = 'VOLUME SURGE ↑';
  else if (chg < 0 && rvol > 1.2) pattern = 'VOLUME SURGE ↓';
  else if (chg > 0) pattern = 'BUYERS IN CONTROL';
  else if (chg < 0) pattern = 'SELLERS IN CONTROL';

  const tag = oi?.buildup || pattern;

  const rule = bias === 'bull'
    ? `Buy ${zone.bot.toFixed(1)}–${zone.top.toFixed(1)} · SL ${stop.toFixed(1)} · T ${target.toFixed(1)}`
    : bias === 'bear'
      ? `Sell ${zone.bot.toFixed(1)}–${zone.top.toFixed(1)} · SL ${stop.toFixed(1)} · T ${target.toFixed(1)}`
      : 'Wait for break of structure';

  return {
    sym, price, prev, chg, score, bias, tag, pattern, rule, rvol, atr: a,
    vwap: vwapNow, dvwap: ((price - vwapNow) / vwapNow) * 100,
    zone, stop, target, rr: Math.max(0, rr),
    R: R.slice(0, 3), S: S.slice(0, 3),
    dayHigh, dayLow, structure,
    obs: obs.slice(-8).map(({ dir, t, top, bot, mitigated, tested }) => ({ dir, t, top, bot, mitigated, tested })),
    fvg: gaps.map(({ dir, i, top, bot }) => ({ dir, t: c[i].t, top, bot })),
  };
}

export function seriesFor(candles, bars = 75) {
  const c = candles.slice(-bars);
  const vw = vwap(candles).slice(-bars);
  const e = ema(candles.map((k) => k.c), 20).slice(-bars);
  return { c, vwap: vw, ema: e };
}
