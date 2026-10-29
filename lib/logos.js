// Company logos: each symbol maps to its official website, whose icon is
// fetched once through Google's favicon service and cached on disk.
// Unknown or failed symbols get a generated monogram instead.
import fs from 'node:fs';
import path from 'node:path';

export const DOMAINS = {
  HDFCBANK: 'hdfcbank.com', ICICIBANK: 'icicibank.com', SBIN: 'sbi.co.in', AXISBANK: 'axisbank.com', KOTAKBANK: 'kotak.com',
  INDUSINDBK: 'indusind.com', BANKBARODA: 'bankofbaroda.in', PNB: 'pnbindia.in', CANBK: 'canarabank.com', FEDERALBNK: 'federalbank.co.in',
  IDFCFIRSTB: 'idfcfirstbank.com', AUBANK: 'aubank.in',
  BAJFINANCE: 'bajajfinserv.in', BAJAJFINSV: 'bajajfinserv.in', SHRIRAMFIN: 'shriramfinance.in', CHOLAFIN: 'cholamandalam.com',
  MUTHOOTFIN: 'muthootfinance.com', LICHSGFIN: 'lichousing.com', PFC: 'pfcindia.com', RECLTD: 'recindia.nic.in', JIOFIN: 'jfs.in',
  HDFCLIFE: 'hdfclife.com', SBILIFE: 'sbilife.co.in', ICICIPRULI: 'iciciprulife.com', ICICIGI: 'icicilombard.com', LICI: 'licindia.in',
  BSE: 'bseindia.com', MCX: 'mcxindia.com', CDSL: 'cdslindia.com', ANGELONE: 'angelone.in', HDFCAMC: 'hdfcfund.com', CAMS: 'camsonline.com',
  TCS: 'tcs.com', INFY: 'infosys.com', HCLTECH: 'hcltech.com', WIPRO: 'wipro.com', TECHM: 'techmahindra.com', LTIM: 'ltimindtree.com',
  PERSISTENT: 'persistent.com', COFORGE: 'coforge.com', MPHASIS: 'mphasis.com',
  MARUTI: 'marutisuzuki.com', TMPV: 'tatamotors.com', 'M&M': 'mahindra.com', 'BAJAJ-AUTO': 'bajajauto.com', EICHERMOT: 'royalenfield.com',
  HEROMOTOCO: 'heromotocorp.com', TVSMOTOR: 'tvsmotor.com', ASHOKLEY: 'ashokleyland.com',
  BOSCHLTD: 'bosch.in', MOTHERSON: 'motherson.com', BHARATFORG: 'bharatforge.com', EXIDEIND: 'exideindustries.com', SONACOMS: 'sonacomstar.com',
  TATASTEEL: 'tatasteel.com', JSWSTEEL: 'jsw.in', HINDALCO: 'hindalco.com', VEDL: 'vedantalimited.com', SAIL: 'sail.co.in', NMDC: 'nmdc.co.in',
  JINDALSTEL: 'jindalsteel.com', NATIONALUM: 'nalcoindia.com',
  RELIANCE: 'ril.com', ONGC: 'ongcindia.com', BPCL: 'bharatpetroleum.in', IOC: 'iocl.com', GAIL: 'gailonline.com', HINDPETRO: 'hindustanpetroleum.com',
  COALINDIA: 'coalindia.in',
  NTPC: 'ntpc.co.in', POWERGRID: 'powergrid.in', TATAPOWER: 'tatapower.com', ADANIPOWER: 'adanipower.com', NHPC: 'nhpcindia.com', JSWENERGY: 'jsw.in',
  SUNPHARMA: 'sunpharma.com', CIPLA: 'cipla.com', DRREDDY: 'drreddys.com', DIVISLAB: 'divislabs.com', LUPIN: 'lupin.com', AUROPHARMA: 'aurobindo.com',
  ZYDUSLIFE: 'zyduslife.com', TORNTPHARM: 'torrentpharma.com',
  APOLLOHOSP: 'apollohospitals.com', MAXHEALTH: 'maxhealthcare.in', FORTIS: 'fortishealthcare.com',
  HINDUNILVR: 'hul.co.in', ITC: 'itcportal.com', NESTLEIND: 'nestle.in', BRITANNIA: 'britannia.co.in', TATACONSUM: 'tataconsumer.com',
  DABUR: 'dabur.com', MARICO: 'marico.com', GODREJCP: 'godrejcp.com', COLPAL: 'colgatepalmolive.co.in',
  TITAN: 'titancompany.in', ASIANPAINT: 'asianpaints.com', TRENT: 'westside.com', DMART: 'dmartindia.com', VOLTAS: 'voltas.com',
  HAVELLS: 'havells.com', DIXON: 'dixoninfo.com',
  ULTRACEMCO: 'ultratechcement.com', SHREECEM: 'shreecement.com', AMBUJACEM: 'ambujacement.com', GRASIM: 'grasim.com', DALBHARAT: 'dalmiacement.com',
  LT: 'larsentoubro.com', ADANIPORTS: 'adaniports.com', ADANIENT: 'adanienterprises.com', GMRAIRPORT: 'gmrgroup.in', IRB: 'irb.co.in',
  SIEMENS: 'siemens.co.in', ABB: 'abb.com', BHEL: 'bhel.com', CGPOWER: 'cgglobal.com', CUMMINSIND: 'cummins.com', POLYCAB: 'polycab.com',
  HAL: 'hal-india.co.in', BEL: 'bel-india.in', BDL: 'bdl-india.in', MAZDOCK: 'mazagondock.in',
  DLF: 'dlf.in', GODREJPROP: 'godrejproperties.com', OBEROIRLTY: 'oberoirealty.com', LODHA: 'lodhagroup.com', PRESTIGE: 'prestigeconstructions.com',
  BHARTIARTL: 'airtel.in', IDEA: 'myvi.in', INDUSTOWER: 'industowers.com',
  ETERNAL: 'zomato.com', NYKAA: 'nykaa.com', PAYTM: 'paytm.com', POLICYBZR: 'policybazaar.com', SWIGGY: 'swiggy.com',
  INDIGO: 'goindigo.in', CONCOR: 'concorindia.co.in', DELHIVERY: 'delhivery.com',
  IRFC: 'irfc.co.in', RVNL: 'rvnl.org', IRCTC: 'irctc.co.in', HUDCO: 'hudco.org.in', IREDA: 'ireda.in',
};

const PALETTE = ['#4f7cff', '#13b07d', '#e5484d', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ec4899', '#64748b'];

export function monogram(sym) {
  const h = [...sym].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const t = sym.replace(/[^A-Z]/g, '').slice(0, 2) || '?';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${PALETTE[h % PALETTE.length]}"/><text x="32" y="41" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="800" fill="#fff" text-anchor="middle">${t}</text></svg>`;
}

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };

async function grab(url, headers) {
  if (url.startsWith('data:image')) {
    const [, type, b64] = url.match(/^data:([^;,]+);base64,(.*)$/s) || [];
    return b64 ? { type, body: Buffer.from(b64, 'base64') } : null;
  }
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(7000) });
    const body = Buffer.from(await r.arrayBuffer());
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || body.length < 100 || body.length > 400_000 || !/image|icon/.test(type)) return null;
    return { type, body };
  } catch { return null; }
}

// The site's own <link rel="icon">, then /favicon.ico.
async function siteIcon(domain) {
  for (const base of [`https://www.${domain}/`, `https://${domain}/`]) {
    try {
      const r = await fetch(base, { headers: UA, signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const html = await r.text();
      const hrefs = [...html.matchAll(/<link[^>]+>/gi)].map((m) => m[0]).filter((l) => /rel=["'][^"']*icon/i.test(l))
        .map((l) => (l.match(/href=["']([^"']+)/i) || [])[1]).filter(Boolean);
      for (const h of [...hrefs, '/favicon.ico']) {
        const got = await grab(h.startsWith('data:') ? h : new URL(h, r.url).href, UA);
        if (got) return got;
      }
    } catch {}
  }
  return null;
}

export class Logos {
  constructor(dir) {
    this.dir = dir;
    this.pending = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  file(sym) { return path.join(this.dir, sym.replace(/[^A-Z0-9-]/gi, '_')); }

  // Resolves to { type, body }: the cached icon, or a monogram SVG if none was found.
  async get(sym) {
    const f = this.file(sym);
    if (fs.existsSync(f + '.img')) return { type: fs.readFileSync(f + '.type', 'utf8'), body: fs.readFileSync(f + '.img') };
    if (fs.existsSync(f + '.none') || !DOMAINS[sym]) return { type: 'image/svg+xml', body: monogram(sym) };
    if (!this.pending.has(sym)) this.pending.set(sym, this.fetch(sym, f).finally(() => this.pending.delete(sym)));
    return (await this.pending.get(sym)) || { type: 'image/svg+xml', body: monogram(sym) };
  }

  // Google's favicon service (bare and www host), DuckDuckGo, then the site itself.
  // Google answers 404 with a generic globe when it has no icon, which grab() rejects.
  async fetch(sym, f) {
    const d = DOMAINS[sym];
    const got = (await grab(`https://www.google.com/s2/favicons?domain=${d}&sz=64`))
      || (await grab(`https://www.google.com/s2/favicons?domain=www.${d}&sz=64`))
      || (await grab(`https://icons.duckduckgo.com/ip3/${d}.ico`))
      || (await siteIcon(d));
    if (!got) { fs.writeFileSync(f + '.none', ''); return null; }
    fs.writeFileSync(f + '.img', got.body);
    fs.writeFileSync(f + '.type', got.type);
    return got;
  }
}
