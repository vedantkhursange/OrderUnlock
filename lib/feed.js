// Live NSE price feed built on Yahoo Finance's public chart endpoints.
//  - spark (20 symbols / request): last traded price + full-day 1m closes, refreshed continuously
//  - chart (1 symbol / request):   5-day 5m OHLCV candles for structure, refreshed round-robin
import { yahooSymbol } from './universe.js';

const UA = 'OrderUnlock/0.1';
const BASE = 'https://query1.finance.yahoo.com';

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) { const e = new Error(`${res.status} ${url}`); e.status = res.status; throw e; }
  return res.json();
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export class Feed {
  constructor(symbols) {
    this.symbols = symbols; // plain NSE symbols (and ^ indices)
    this.quotes = new Map(); // sym -> { price, prevClose, ts, closes:[], times:[] }
    this.candles = new Map(); // sym -> { t,o,h,l,c,v }[] (5m)
    this.names = new Map(); // sym -> company name
    this.dead = new Set();
    this.lastTick = 0;
    this.interval = 1000; // spark cycle, widens on HTTP 429 and recovers back to 1s
  }

  async spark(batch) {
    const ys = batch.map(yahooSymbol);
    const url = `${BASE}/v8/finance/spark?symbols=${ys.map(encodeURIComponent).join(',')}&range=1d&interval=1m`;
    const j = await getJSON(url);
    const now = Date.now();
    for (const sym of batch) {
      const r = j[yahooSymbol(sym)];
      if (!r || !r.close || !r.close.length) continue;
      const times = [], closes = [];
      r.timestamp.forEach((t, i) => { if (r.close[i] != null) { times.push(t); closes.push(r.close[i]); } });
      if (!closes.length) continue;
      const prev = this.quotes.get(sym);
      const price = closes.at(-1);
      this.quotes.set(sym, {
        price,
        prevClose: r.chartPreviousClose ?? r.previousClose,
        ts: times.at(-1),
        times, closes,
        prevPrice: prev ? prev.price : price,
        updated: now,
      });
      this.patchLastCandle(sym, price, times.at(-1));
    }
    this.lastTick = now;
  }

  // Keep the newest 5m candle moving with every tick between full candle refreshes.
  patchLastCandle(sym, price, ts) {
    const cs = this.candles.get(sym);
    if (!cs || !cs.length) return;
    const last = cs.at(-1);
    const bucket = ts - (ts % 300);
    if (bucket > last.t) cs.push({ t: bucket, o: price, h: price, l: price, c: price, v: 0 });
    else { last.c = price; last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); }
  }

  async chart(sym) {
    const url = `${BASE}/v8/finance/chart/${encodeURIComponent(yahooSymbol(sym))}?range=5d&interval=5m`;
    const j = await getJSON(url);
    const r = j.chart?.result?.[0];
    if (!r || !r.timestamp) throw new Error(`no chart ${sym}`);
    const q = r.indicators.quote[0];
    const out = [];
    r.timestamp.forEach((t, i) => {
      if (q.close[i] == null || q.open[i] == null) return;
      out.push({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
    });
    this.candles.set(sym, out);
    if (r.meta.longName || r.meta.shortName) this.names.set(sym, r.meta.longName || r.meta.shortName);
    return r.meta;
  }

  live() { return this.symbols.filter((s) => !this.dead.has(s)); }

  // Spark loop: every symbol is refreshed roughly once a second.
  async runSpark() {
    for (;;) {
      const t0 = Date.now();
      const batches = chunk(this.live(), 20);
      let limited = false;
      await Promise.all(batches.map((b) => this.spark(b).catch((e) => { if (e.status === 429) limited = true; })));
      this.interval = limited ? Math.min(8000, this.interval * 2) : Math.max(1000, this.interval * 0.8);
      await new Promise((r) => setTimeout(r, Math.max(200, this.interval - (Date.now() - t0))));
    }
  }

  // Candle loop: walks the universe a few symbols at a time.
  async runCandles() {
    let i = 0;
    for (;;) {
      const list = this.live();
      const batch = [0, 1].map((k) => list[(i + k) % list.length]);
      i = (i + 2) % list.length;
      await Promise.all(batch.map((s) => this.chart(s).catch(() => {})));
      await new Promise((r) => setTimeout(r, this.interval));
    }
  }

  async bootstrap() {
    for (const b of chunk(this.symbols, 20)) await this.spark(b).catch((e) => console.warn('spark', e.message));
    for (const s of this.symbols) if (!this.quotes.has(s)) this.dead.add(s);
    const list = this.live();
    for (const b of chunk(list, 4)) {
      await Promise.all(b.map((s) => this.chart(s).catch(() => {})));
      await new Promise((r) => setTimeout(r, 150));
    }
    return { live: list.length, dropped: [...this.dead] };
  }
}
