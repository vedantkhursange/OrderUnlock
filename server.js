// OrderUnlock server: live NSE feed -> order block engine -> SSE stream (1s).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allStocks, INDICES } from './lib/universe.js';
import { Feed } from './lib/feed.js';
import { analyze, seriesFor, profile } from './lib/engine.js';
import { OpenInterest } from './lib/oi.js';
import { buildPlan, sessionPhase, replayORB } from './lib/plans.js';
import { SignalTracker } from './lib/signals.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// minimal .env loader (UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI, PORT)
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const PORT = Number(process.env.PORT) || 4173;
const CONTENDERS = 24;

const stocks = allStocks();
const sectorOf = new Map(stocks.map((s) => [s.sym, s.sector]));
const feed = new Feed([...stocks.map((s) => s.sym), ...Object.values(INDICES)]);
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const signals = new SignalTracker(DATA);
const plans = new Map(); // sym -> { story, plan }
const oi = new OpenInterest(stocks.map((s) => s.sym), {
  apiKey: process.env.UPSTOX_API_KEY, apiSecret: process.env.UPSTOX_API_SECRET,
  redirectUri: process.env.UPSTOX_REDIRECT_URI || `http://localhost:${PORT}/auth/upstox/callback`,
  tokenFile: path.join(ROOT, '.upstox-token.json'),
});

// ---- market clock (IST) -------------------------------------------------
function marketStatus(now = new Date()) {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  const d = ist.getDay(), m = ist.getHours() * 60 + ist.getMinutes();
  if (d === 0 || d === 6) return 'closed';
  if (m >= 555 && m < 930) return 'open';
  if (m >= 540 && m < 555) return 'pre-open';
  return 'closed';
}

// ---- state -------------------------------------------------------------
let state = { ts: 0, stocks: [] };
const analysis = new Map();

const downsample = (arr, step) => arr.filter((_, i) => i % step === 0 || i === arr.length - 1);

function rebuild() {
  const rows = [];
  for (const { sym, sector } of stocks) {
    const q = feed.quotes.get(sym);
    if (!q) continue;
    const o = oi.data.get(sym);
    const a = analyze(sym, feed.candles.get(sym), q, o);
    if (a) analysis.set(sym, a);
    const prev = analysis.get(sym);
    const pl = prev ? buildPlan(prev, feed.candles.get(sym), q, o) : null;
    if (pl) plans.set(sym, pl);
    rows.push({
      ...(pl ? { plan: (({ setup, side, state, entry, stop, t1, t2, rr, conf, action }) => ({ setup, side, state, entry, stop, t1, t2, rr, conf, action }))(pl.plan) } : {}),
      sym, sector, name: feed.names.get(sym) || sym,
      price: q.price, prev: q.prevClose, chg: ((q.price - q.prevClose) / q.prevClose) * 100,
      tickDir: Math.sign(q.price - q.prevPrice),
      ...(o && o.oi != null ? { oi: o.oi, prevOI: o.prevOI, dOI: o.dOI, dOIpct: o.dOIpct, buildup: o.buildup, fut: o.fut, futChg: o.futChg, lot: oi.contracts.get(sym)?.lot } : {}),
      ...(prev ? {
        score: prev.score, bias: prev.bias, tag: prev.tag, pattern: prev.pattern, rule: prev.rule,
        zone: prev.zone, R: prev.R, S: prev.S, rr: prev.rr, stop: prev.stop, target: prev.target,
        vwap: prev.vwap, dvwap: prev.dvwap, rvol: prev.rvol, structure: prev.structure,
        dayHigh: prev.dayHigh, dayLow: prev.dayLow,
      } : { score: 0, bias: 'neutral' }),
    });
  }
  // Rank each side by conviction.
  const bulls = rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  const bears = rows.filter((r) => r.score < 0).sort((a, b) => a.score - b.score);
  for (const r of rows) { r.status = 'HERD'; r.rank = null; r.side = null; }
  bulls.forEach((r, i) => { r.rank = i + 1; r.side = 'bull'; r.status = i === 0 ? 'TOP' : i < CONTENDERS ? 'CONTENDER' : 'HERD'; });
  bears.forEach((r, i) => { r.rank = i + 1; r.side = 'bear'; r.status = i === 0 ? 'TOP' : i < CONTENDERS ? 'CONTENDER' : 'HERD'; });
  for (const r of [...bulls.slice(0, CONTENDERS), ...bears.slice(0, CONTENDERS)]) {
    const cs = feed.candles.get(r.sym);
    if (cs) r.profile = profile(cs.slice(-75), 20);
  }

  signals.update(rows);

  const idx = {};
  for (const [name, y] of Object.entries(INDICES)) {
    const q = feed.quotes.get(y);
    if (q) idx[name] = { price: q.price, chg: ((q.price - q.prevClose) / q.prevClose) * 100 };
  }
  state = {
    ts: Date.now(), market: marketStatus(), lastTick: feed.lastTick,
    asOf: Math.max(0, ...rows.map((r) => feed.quotes.get(r.sym).ts)) * 1000,
    counts: { total: rows.length, bull: bulls.length, bear: bears.length },
    oi: oi.status(), session: sessionPhase(), signals: signals.summary(),
    indices: idx, stocks: rows,
  };
}

function flowPayload() {
  const out = {};
  for (const { sym } of stocks) {
    const q = feed.quotes.get(sym);
    if (!q || !q.closes.length) continue;
    const t = downsample(q.times, 3), c = downsample(q.closes, 3);
    out[sym] = { t, p: c.map((v) => +(((v - q.prevClose) / q.prevClose) * 100).toFixed(3)) };
  }
  return out;
}

// ---- http ---------------------------------------------------------------
const clients = new Set();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function json(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    res.write(`event: flow\ndata: ${JSON.stringify(flowPayload())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') return json(res, state);
  if (url.pathname === '/api/oi/status') return json(res, oi.status());
  if (url.pathname === '/api/signals') {
    const replay = [];
    for (const { sym, sector } of stocks) {
      const a = analysis.get(sym), rp = a && replayORB(feed.candles.get(sym), a.atr);
      if (rp && rp.side) replay.push({ sym, sector, ...rp });
    }
    const done = replay.filter((x) => !/RUNNING/.test(x.outcome));
    const wins = done.filter((x) => x.r > 0).length;
    return json(res, {
      summary: signals.summary(), list: signals.list, session: sessionPhase(),
      plans: state.stocks.filter((r) => r.plan).map((r) => ({ sym: r.sym, sector: r.sector, price: r.price, chg: r.chg, score: r.score, ...r.plan })),
      replay: replay.sort((x, y) => y.r - x.r),
      replaySummary: { trades: replay.length, closed: done.length, wins, losses: done.length - wins, winRate: done.length ? Math.round((wins / done.length) * 100) : null, totalR: +replay.reduce((t, x) => t + x.r, 0).toFixed(2), avgR: replay.length ? +(replay.reduce((t, x) => t + x.r, 0) / replay.length).toFixed(2) : 0 },
    });
  }
  if (url.pathname === '/auth/upstox') {
    if (!oi.configured) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('Add UPSTOX_API_KEY and UPSTOX_API_SECRET to .env, then restart.'); }
    res.writeHead(302, { Location: oi.authUrl() }); return res.end();
  }
  if (url.pathname === '/auth/upstox/callback') {
    const code = url.searchParams.get('code');
    oi.exchangeCode(code || '')
      .then(() => { res.writeHead(302, { Location: '/?upstox=connected' }); res.end(); })
      .catch((e) => { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end(`Upstox login failed: ${e.message}`); });
    return;
  }
  if (url.pathname === '/auth/upstox/logout') { oi.logout(); res.writeHead(302, { Location: '/' }); return res.end(); }
  if (url.pathname === '/api/flow') return json(res, flowPayload());
  if (url.pathname.startsWith('/api/stock/')) {
    const sym = decodeURIComponent(url.pathname.slice(11));
    const cs = feed.candles.get(sym), q = feed.quotes.get(sym);
    if (!cs || !q) { res.writeHead(404); return res.end('{}'); }
    return json(res, {
      sym, name: feed.names.get(sym) || sym, sector: sectorOf.get(sym),
      analysis: analysis.get(sym) || null,
      plan: plans.get(sym) || null,
      replay: analysis.get(sym) ? replayORB(cs, analysis.get(sym).atr) : null,
      series: seriesFor(cs, Number(url.searchParams.get('bars')) || 75),
      intraday: { t: q.times, c: q.closes, prev: q.prevClose },
    });
  }
  let file = path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { // SPA fallback
      return fs.readFile(path.join(ROOT, 'public', 'index.html'), (e2, b2) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(b2); });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}

(async () => {
  console.log('OrderUnlock: loading NSE universe…');
  const boot = await feed.bootstrap();
  console.log(`Live symbols: ${boot.live}. Dropped: ${boot.dropped.join(', ') || 'none'}`);
  feed.runSpark();
  feed.runCandles();
  oi.run().catch((e) => console.warn('OI feed stopped:', e.message));
  rebuild();
  setInterval(() => { rebuild(); broadcast('state', state); }, 1000);
  setInterval(() => broadcast('flow', flowPayload()), 15000);
  server.listen(PORT, () => console.log(`OrderUnlock running → http://localhost:${PORT}`));
})();
