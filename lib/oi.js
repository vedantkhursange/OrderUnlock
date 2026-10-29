// Futures open interest from Upstox.
//  - public mode: Upstox historical/intraday candle API (no login) — prev-day OI + 1-minute OI
//  - login mode:  Upstox full market quotes for every contract in one call, every 2s
import fs from 'node:fs';
import zlib from 'node:zlib';

const API = 'https://api.upstox.com/v2';
const MASTER = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const istDate = (ms) => new Date(ms + 19800000).toISOString().slice(0, 10);

export function classify(dPrice, dOI) {
  if (dOI == null || dPrice == null) return null;
  if (dPrice >= 0 && dOI >= 0) return 'LONG BUILD-UP';
  if (dPrice < 0 && dOI >= 0) return 'SHORT BUILD-UP';
  if (dPrice >= 0 && dOI < 0) return 'SHORT COVERING';
  return 'LONG UNWINDING';
}

export class OpenInterest {
  constructor(symbols, { apiKey, apiSecret, redirectUri, tokenFile }) {
    this.symbols = symbols;
    this.apiKey = apiKey; this.apiSecret = apiSecret; this.redirectUri = redirectUri;
    this.tokenFile = tokenFile;
    this.contracts = new Map(); // sym -> { key, expiry, lot, tsym }
    this.data = new Map();      // sym -> { oi, prevOI, dOI, dOIpct, fut, futPrev, buildup, at }
    this.token = this.loadToken();
    this.mode = 'public';
    this.lastQuoteError = null;
  }

  // ---------------- auth (Upstox OAuth; token is valid until ~3:30 AM IST next day)
  get configured() { return Boolean(this.apiKey && this.apiSecret); }
  get loggedIn() { return Boolean(this.token && this.token.expires > Date.now()); }
  authUrl() {
    const q = new URLSearchParams({ response_type: 'code', client_id: this.apiKey, redirect_uri: this.redirectUri });
    return `${API}/login/authorization/dialog?${q}`;
  }
  loadToken() {
    try { const t = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')); return t.expires > Date.now() ? t : null; } catch { return null; }
  }
  async exchangeCode(code) {
    const body = new URLSearchParams({ code, client_id: this.apiKey, client_secret: this.apiSecret, redirect_uri: this.redirectUri, grant_type: 'authorization_code' });
    const res = await fetch(`${API}/login/authorization/token`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = await res.json();
    if (!res.ok || !j.access_token) throw new Error(j.errors?.[0]?.message || `token exchange failed (${res.status})`);
    // expires at the next 03:30 IST
    const now = Date.now(), ist = new Date(now + 19800000);
    const exp = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + (ist.getUTCHours() >= 3 ? 1 : 0), 3, 30) - 19800000;
    this.token = { access_token: j.access_token, user: j.user_name || j.user_id || '', expires: exp };
    try { fs.writeFileSync(this.tokenFile, JSON.stringify(this.token), { mode: 0o600 }); } catch {}
    return this.token;
  }
  logout() { this.token = null; try { fs.unlinkSync(this.tokenFile); } catch {} }

  async get(path) {
    const headers = { Accept: 'application/json' };
    if (path.startsWith('/market-quote') && this.token) headers.Authorization = `Bearer ${this.token.access_token}`;
    const res = await fetch(`${API}${path}`, { headers });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.status !== 'success') { const e = new Error(j.errors?.[0]?.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return j.data;
  }

  // ---------------- contracts: nearest-expiry stock future per symbol
  async loadContracts() {
    const res = await fetch(MASTER);
    const all = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())));
    const want = new Set(this.symbols), now = Date.now();
    for (const x of all) {
      if (x.segment !== 'NSE_FO' || x.instrument_type !== 'FUT') continue;
      const sym = x.underlying_symbol || x.asset_symbol;
      if (!want.has(sym) || x.expiry < now) continue;
      const cur = this.contracts.get(sym);
      if (!cur || x.expiry < cur.expiry) this.contracts.set(sym, { key: x.instrument_key, expiry: x.expiry, lot: x.lot_size, tsym: x.trading_symbol });
    }
    return this.contracts.size;
  }

  set(sym, patch) {
    const d = { ...(this.data.get(sym) || {}), ...patch, at: Date.now() };
    if (d.oi != null && d.prevOI) { d.dOI = d.oi - d.prevOI; d.dOIpct = (d.dOI / d.prevOI) * 100; }
    if (d.fut != null && d.futPrev) d.futChg = ((d.fut - d.futPrev) / d.futPrev) * 100;
    d.buildup = classify(d.futChg, d.dOI);
    this.data.set(sym, d);
  }

  // previous session's closing OI + futures close (daily candles, public)
  async loadPrev(sym) {
    const c = this.contracts.get(sym); if (!c) return;
    const to = istDate(Date.now()), from = istDate(Date.now() - 12 * 86400000);
    const d = await this.get(`/historical-candle/${encodeURIComponent(c.key)}/day/${to}/${from}`);
    const today = to;
    const prev = (d.candles || []).find((k) => k[0].slice(0, 10) < today);
    if (prev) this.set(sym, { prevOI: prev[6], futPrev: prev[4] });
  }

  // today's latest OI from 1-minute candles (public)
  async loadIntraday(sym) {
    const c = this.contracts.get(sym); if (!c) return;
    const d = await this.get(`/historical-candle/intraday/${encodeURIComponent(c.key)}/1minute`);
    const k = d.candles?.[0]; // newest first
    if (k) this.set(sym, { oi: k[6], fut: k[4], oiTs: Date.parse(k[0]) });
  }

  // all contracts in one call (login)
  async loadQuotes() {
    const keys = [...this.contracts.entries()];
    const bySym = new Map(keys.map(([s, c]) => [c.key, s]));
    for (let i = 0; i < keys.length; i += 450) {
      const batch = keys.slice(i, i + 450).map(([, c]) => c.key).join(',');
      const d = await this.get(`/market-quote/quotes?instrument_key=${encodeURIComponent(batch)}`);
      for (const q of Object.values(d)) {
        const sym = bySym.get(q.instrument_token); if (!sym) continue;
        this.set(sym, { oi: q.oi, fut: q.last_price, ...(q.net_change != null && !this.data.get(sym)?.futPrev ? { futPrev: q.last_price - q.net_change } : {}), oiTs: Date.now() });
      }
    }
  }

  async run() {
    const n = await this.loadContracts();
    console.log(`OI: ${n} stock futures mapped`);
    // first sweep: previous close OI + today's OI for every contract
    for (const sym of this.contracts.keys()) {
      await this.loadPrev(sym).catch(() => {});
      if (!this.loggedIn) await this.loadIntraday(sym).catch(() => {});
      await sleep(300);
    }
    let i = 0;
    for (;;) {
      if (this.loggedIn) {
        this.mode = 'live';
        try { await this.loadQuotes(); this.lastQuoteError = null; }
        catch (e) { this.lastQuoteError = e.message; if (e.status === 401) this.logout(); }
        await sleep(2000);
      } else {
        // ~50 calls/min keeps well inside Upstox's per-30-minute limit
        this.mode = 'public';
        const syms = [...this.contracts.keys()];
        const sym = syms[i++ % syms.length];
        await this.loadIntraday(sym).catch(() => {});
        await sleep(1200);
      }
    }
  }

  status() {
    const ages = [...this.data.values()].filter((d) => d.oiTs).map((d) => Date.now() - d.oiTs);
    return {
      mode: this.mode, configured: this.configured, loggedIn: this.loggedIn, user: this.token?.user || null,
      contracts: this.contracts.size, withOI: ages.length, error: this.lastQuoteError,
      oldestSec: ages.length ? Math.round(Math.max(...ages) / 1000) : null,
    };
  }
}
