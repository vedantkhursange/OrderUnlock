// Intraday trade plans: session timing, rule-based setups, and a plain-language story of the day.
// Nothing here predicts prices. Each plan is a set of conditions plus pre-defined risk.

const IST = 19800;
export const istMin = (t) => Math.floor(((t + IST) % 86400) / 60); // minutes since IST midnight
const istDay = (t) => Math.floor((t + IST) / 86400);
const hhmm = (t) => { const m = istMin(t); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const r2 = (n) => Math.round(n * 100) / 100;

// NSE session phases (IST minutes)
const PHASES = [
  [0, 540, 'closed', 'Market closed', 'No trading. Review yesterday, build a watchlist.'],
  [540, 555, 'pre-open', 'Pre-open', 'Orders are collected, nothing trades yet. Just watch.'],
  [555, 570, 'opening-range', 'Opening range', 'First 15 minutes are wild. Do not trade — mark the high and low.'],
  [570, 660, 'prime', 'Prime time', 'Best window. Breakouts of the opening range and first pullbacks to VWAP / order blocks.'],
  [660, 810, 'midday', 'Midday lull', 'Volume dries up, fake moves are common. Trade only A+ setups, smaller size.'],
  [810, 870, 'last-hour', 'Afternoon trend', 'Trends often resume. Manage open trades; new entries only with clear structure.'],
  [870, 915, 'no-new', 'No new trades', 'After 14:30 only manage / exit open positions.'],
  [915, 930, 'square-off', 'Square-off', 'Intraday positions are closed at 15:15. Do not hold MIS overnight.'],
  [930, 1440, 'closed', 'Market closed', 'Session over. Review your trades in the journal.'],
];
export function sessionPhase(now = Date.now() / 1000) {
  const d = new Date((now + IST) * 1000).getUTCDay();
  if (d === 0 || d === 6) return { id: 'closed', label: 'Weekend', tip: 'Markets are closed. Study charts and practise reading setups.', min: istMin(now) };
  const m = istMin(now);
  const p = PHASES.find(([a, b]) => m >= a && m < b);
  return { id: p[2], label: p[3], tip: p[4], min: m, canEnter: p[2] === 'prime' || p[2] === 'midday' || p[2] === 'last-hour' };
}

function todays(c) {
  const day = istDay(c.at(-1).t);
  return c.filter((k) => istDay(k.t) === day);
}

// Main entry: returns { story[], plan } for one stock.
export function buildPlan(a, candles, quote, oi, now = Date.now() / 1000) {
  if (!a || !candles || candles.length < 30) return null;
  const tc = todays(candles);
  if (!tc.length) return null;
  const price = quote.price, prev = quote.prevClose, atr = a.atr;
  const open = tc[0].o;
  const orBars = tc.filter((k) => istMin(k.t) < 570);           // 09:15–09:30
  const orH = orBars.length ? Math.max(...orBars.map((k) => k.h)) : null;
  const orL = orBars.length ? Math.min(...orBars.map((k) => k.l)) : null;
  const hiBar = tc.reduce((x, k) => (k.h > x.h ? k : x)), loBar = tc.reduce((x, k) => (k.l < x.l ? k : x));
  const orDone = orBars.length >= 3;
  const breakUp = orDone ? tc.find((k) => istMin(k.t) >= 570 && k.c > orH) : null;
  const breakDn = orDone ? tc.find((k) => istMin(k.t) >= 570 && k.c < orL) : null;
  const gap = ((open - prev) / prev) * 100;

  // ---------------- story (facts only, in order)
  const story = [];
  story.push(`Previous close ₹${r2(prev)}. Opened at ₹${r2(open)} — ${Math.abs(gap) < 0.25 ? 'flat' : gap > 0 ? `a gap up of ${gap.toFixed(2)}%` : `a gap down of ${Math.abs(gap).toFixed(2)}%`}.`);
  if (orDone) story.push(`Opening range (09:15–09:30): ₹${r2(orL)} – ₹${r2(orH)}.`);
  if (breakUp && (!breakDn || breakUp.t < breakDn.t)) story.push(`Broke above the opening range at ${hhmm(breakUp.t)}${a.rvol > 1.2 ? ' on strong volume' : ''}.`);
  else if (breakDn) story.push(`Broke below the opening range at ${hhmm(breakDn.t)}${a.rvol > 1.2 ? ' on strong volume' : ''}.`);
  else if (orDone) story.push('Still trading inside the opening range — no decision yet.');
  story.push(`Day high ₹${r2(hiBar.h)} at ${hhmm(hiBar.t)}, day low ₹${r2(loBar.l)} at ${hhmm(loBar.t)}.`);
  story.push(`Now ₹${r2(price)} (${a.chg >= 0 ? '+' : ''}${a.chg.toFixed(2)}%), ${Math.abs(a.dvwap) < 0.1 ? 'right at' : a.dvwap > 0 ? `${a.dvwap.toFixed(2)}% above` : `${Math.abs(a.dvwap).toFixed(2)}% below`} VWAP ₹${r2(a.vwap)} — ${a.dvwap > 0 ? 'buyers have paid up on average today' : 'sellers have the upper hand on average today'}.`);
  if (oi && oi.buildup) {
    const meaning = { 'LONG BUILD-UP': 'new buyers are entering (bullish)', 'SHORT BUILD-UP': 'new sellers are entering (bearish)', 'SHORT COVERING': 'sellers are exiting (bullish, but weaker)', 'LONG UNWINDING': 'buyers are exiting (bearish, but weaker)' }[oi.buildup];
    story.push(`Futures OI ${oi.dOIpct >= 0 ? 'up' : 'down'} ${Math.abs(oi.dOIpct).toFixed(1)}% with price ${oi.futChg >= 0 ? 'up' : 'down'} → ${oi.buildup.toLowerCase()}: ${meaning}.`);
  }
  if (a.structure !== 'none') story.push(`Market structure is ${a.structure === 'bull' ? 'bullish — the last break was above a swing high' : 'bearish — the last break was below a swing low'}.`);
  story.push(`${a.bias === 'bear' ? 'Supply' : 'Demand'} zone (order block) ₹${r2(a.zone.bot)} – ₹${r2(a.zone.top)}; average 5-min range (ATR) ₹${r2(atr)}.`);

  // ---------------- choose a setup
  const phase = sessionPhase(now);
  const long = a.bias !== 'bear';
  const reasons = [], warnings = [];
  let setup, entry, stop, kind;

  const nearZone = long ? price - a.zone.top < atr * 1.5 : a.zone.bot - price < atr * 1.5;
  if (orDone && long && breakUp && price > orH && price - orH < atr * 1.5) {
    setup = 'ORB LONG'; kind = 'breakout'; entry = orH; stop = Math.max(orL, orH - atr * 1.5, a.vwap - atr * 0.3);
    reasons.push('Price broke above the opening-range high and is still close to it');
  } else if (orDone && !long && breakDn && price < orL && orL - price < atr * 1.5) {
    setup = 'ORB SHORT'; kind = 'breakout'; entry = orL; stop = Math.min(orH, orL + atr * 1.5, a.vwap + atr * 0.3);
    reasons.push('Price broke below the opening-range low and is still close to it');
  } else if (long && nearZone) {
    setup = 'OB PULLBACK LONG'; kind = 'pullback'; entry = a.zone.top; stop = a.zone.bot - atr * 0.25;
    reasons.push('Price is close to a fresh demand zone (bullish order block) — buy the dip into it');
  } else if (!long && nearZone) {
    setup = 'OB PULLBACK SHORT'; kind = 'pullback'; entry = a.zone.bot; stop = a.zone.top + atr * 0.25;
    reasons.push('Price is close to a fresh supply zone (bearish order block) — sell the bounce into it');
  } else if (long) {
    setup = 'VWAP PULLBACK LONG'; kind = 'pullback'; entry = Math.max(a.vwap, a.zone.top); stop = entry - atr * 1.2;
    reasons.push('Trend is up but price is stretched — wait for a pullback to VWAP / zone instead of chasing');
  } else {
    setup = 'VWAP PULLBACK SHORT'; kind = 'pullback'; entry = Math.min(a.vwap, a.zone.bot); stop = entry + atr * 1.2;
    reasons.push('Trend is down but price is stretched — wait for a bounce to VWAP / zone instead of chasing');
  }
  const side = setup.endsWith('LONG') ? 'BUY' : 'SELL';
  const risk = Math.max(Math.abs(entry - stop), atr * 0.4);
  stop = side === 'BUY' ? entry - risk : entry + risk;
  const t1 = side === 'BUY' ? entry + risk * 1.5 : entry - risk * 1.5;
  const t2 = side === 'BUY' ? Math.max(entry + risk * 3, a.R[1] ?? 0) : Math.min(entry - risk * 3, a.S[1] ?? Infinity);

  // ---------------- confidence: how many independent conditions agree
  const checks = [
    [side === 'BUY' ? price > a.vwap : price < a.vwap, 'Price on the right side of VWAP'],
    [a.structure === (side === 'BUY' ? 'bull' : 'bear'), 'Market structure agrees'],
    [side === 'BUY' ? a.chg > 0 : a.chg < 0, 'Day direction agrees'],
    [a.rvol >= 1.2, `Volume ${a.rvol.toFixed(1)}× normal`],
    [oi && oi.buildup ? (side === 'BUY' ? /LONG BUILD|SHORT COVER/.test(oi.buildup) : /SHORT BUILD|LONG UNWIND/.test(oi.buildup)) : false, oi?.buildup ? `Futures OI: ${oi.buildup.toLowerCase()}` : 'Futures OI confirmation'],
    [Math.abs(a.score) >= 50, `Conviction ${a.score > 0 ? '+' : ''}${a.score}`],
  ];
  const passed = checks.filter(([ok]) => ok);
  const conf = Math.round((passed.length / checks.length) * 100);
  for (const [ok, label] of checks) (ok ? reasons : warnings).push(ok ? label : `Missing: ${label.replace(/^Missing: /, '')}`);
  if (Math.abs(price - entry) > atr * 2) warnings.push('Price is far from the entry — do not chase, wait for it to come to you');
  if (!phase.canEnter) warnings.push(`${phase.label}: ${phase.tip}`);

  // ---------------- state of the plan right now
  const dist = side === 'BUY' ? price - entry : entry - price;
  let state;
  if (!orDone && phase.id !== 'closed') state = 'WAIT';
  else if ((side === 'BUY' && price <= stop) || (side === 'SELL' && price >= stop)) state = 'INVALID';
  else if (kind === 'breakout' && dist >= 0 && dist < risk * 0.6) state = 'TRIGGERED';
  else if (kind === 'pullback' && Math.abs(dist) <= atr * 0.25) state = 'TRIGGERED';
  else if (Math.abs(dist) <= atr * 0.6) state = 'ARMED';
  else state = 'WAIT';
  if (state !== 'INVALID' && (phase.id === 'no-new' || phase.id === 'square-off' || phase.id === 'closed')) state = state === 'TRIGGERED' ? 'LATE' : 'EXPIRED';

  const action = {
    WAIT: kind === 'breakout' ? `Wait. A trade only if price comes back near ₹${r2(entry)}.` : `Wait for price to reach ₹${r2(entry)} (${side === 'BUY' ? 'pullback' : 'bounce'}). Don't chase.`,
    ARMED: `Get ready — price is close to the ₹${r2(entry)} entry. Watch the next 5-min candle.`,
    TRIGGERED: `Entry zone reached. ${side} near ₹${r2(entry)}, stop ₹${r2(stop)}, first target ₹${r2(t1)}.`,
    INVALID: `Stop level already broken — this setup is dead. Skip it.`,
    EXPIRED: `Too late in the session for new trades. Watch only.`,
    LATE: `Setup is at the entry but it's after 14:30 — skip new trades now.`,
  }[state];

  return {
    story,
    plan: {
      setup, side, kind, state, action,
      entry: r2(entry), stop: r2(stop), t1: r2(t1), t2: r2(t2),
      rr: r2(Math.abs(t1 - entry) / risk), rr2: r2(Math.abs(t2 - entry) / risk), riskPerShare: r2(risk),
      conf, reasons, warnings,
      orH: orH && r2(orH), orL: orL && r2(orL),
    },
    phase,
  };
}

// Replay today's opening-range breakout on 5-min candles, the way a disciplined trader
// would have taken it. Conservative: if one candle touches both stop and target, count the stop.
// Rules: first close beyond the 09:15–09:30 range between 09:30 and 14:30 → enter at that close;
// stop = other side of the range (capped at 1.5 ATR, min 0.4 ATR); book half at 1.5R and move
// the stop to entry; the rest exits at 3R, back at entry, or 15:15.
export function replayORB(candles, atr) {
  if (!candles || candles.length < 10) return null;
  const tc = todays(candles);
  const or = tc.filter((k) => istMin(k.t) < 570);
  if (or.length < 3) return null;
  const orH = Math.max(...or.map((k) => k.h)), orL = Math.min(...or.map((k) => k.l));
  const i = tc.findIndex((k) => istMin(k.t) >= 570 && istMin(k.t) < 870 && (k.c > orH || k.c < orL));
  if (i < 0) return { orH: r2(orH), orL: r2(orL), side: null, outcome: 'NO BREAKOUT', r: 0 };
  const k = tc[i], side = k.c > orH ? 'BUY' : 'SELL', dir = side === 'BUY' ? 1 : -1;
  const entry = k.c;
  let risk = side === 'BUY' ? entry - orL : orH - entry;
  risk = Math.min(Math.max(risk, atr * 0.4), atr * 1.5);
  let stop = entry - dir * risk;
  const t1 = entry + dir * risk * 1.5, t2 = entry + dir * risk * 3;
  let half = false, outcome = 'SQUARED', exit = null, exitT = null, r = 0;
  for (let j = i + 1; j < tc.length; j++) {
    const c = tc[j];
    const lowR = ((side === 'BUY' ? c.l : c.h) - entry) * dir, highR = ((side === 'BUY' ? c.h : c.l) - entry) * dir;
    if (lowR <= (stop - entry) * dir) { exit = stop; exitT = c.t; outcome = half ? 'T1 → BREAKEVEN' : 'STOP-LOSS'; r = half ? 0.75 : -1; break; }
    if (!half && highR >= risk * 1.5) { half = true; stop = entry; }
    if (half && highR >= risk * 3) { exit = t2; exitT = c.t; outcome = 'T2 HIT'; r = 0.75 + 1.5; break; }
    if (istMin(c.t) >= 915) { exit = c.c; exitT = c.t; break; }
  }
  if (!exit) { const last = tc.at(-1); exit = last.c; exitT = last.t; outcome = istMin(last.t) >= 915 ? (half ? 'T1 + SQUARED' : 'SQUARED') : (half ? 'T1, RUNNING' : 'RUNNING'); }
  if (!/STOP|T2|BREAKEVEN/.test(outcome)) r = half ? 0.75 + (((exit - entry) * dir) / risk) * 0.5 : ((exit - entry) * dir) / risk;
  return {
    orH: r2(orH), orL: r2(orL), side, entryTime: hhmm(k.t), entry: r2(entry), stop: r2(entry - dir * risk),
    t1: r2(t1), t2: r2(t2), exit: r2(exit), exitTime: hhmm(exitT), outcome, r: r2(r),
  };
}
