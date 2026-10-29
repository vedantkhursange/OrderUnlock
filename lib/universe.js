// Liquid NSE F&O stocks grouped by sector. Symbols that fail to load at
// startup are dropped automatically, so the list can be edited freely.
export const UNIVERSE = {
  Banks: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'INDUSINDBK', 'BANKBARODA', 'PNB', 'CANBK', 'FEDERALBNK', 'IDFCFIRSTB', 'AUBANK'],
  Finance: ['BAJFINANCE', 'BAJAJFINSV', 'SHRIRAMFIN', 'CHOLAFIN', 'MUTHOOTFIN', 'LICHSGFIN', 'PFC', 'RECLTD', 'JIOFIN'],
  Insurance: ['HDFCLIFE', 'SBILIFE', 'ICICIPRULI', 'ICICIGI', 'LICI'],
  'Capital Mkts': ['BSE', 'MCX', 'CDSL', 'ANGELONE', 'HDFCAMC', 'CAMS'],
  IT: ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'LTIM', 'PERSISTENT', 'COFORGE', 'MPHASIS'],
  Auto: ['MARUTI', 'TMPV', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO', 'TVSMOTOR', 'ASHOKLEY'],
  'Auto Anc': ['BOSCHLTD', 'MOTHERSON', 'BHARATFORG', 'EXIDEIND', 'SONACOMS'],
  Metals: ['TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'SAIL', 'NMDC', 'JINDALSTEL', 'NATIONALUM'],
  Energy: ['RELIANCE', 'ONGC', 'BPCL', 'IOC', 'GAIL', 'HINDPETRO', 'COALINDIA'],
  Power: ['NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIPOWER', 'NHPC', 'JSWENERGY'],
  Pharma: ['SUNPHARMA', 'CIPLA', 'DRREDDY', 'DIVISLAB', 'LUPIN', 'AUROPHARMA', 'ZYDUSLIFE', 'TORNTPHARM'],
  Healthcare: ['APOLLOHOSP', 'MAXHEALTH', 'FORTIS'],
  FMCG: ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM', 'DABUR', 'MARICO', 'GODREJCP', 'COLPAL'],
  Consumer: ['TITAN', 'ASIANPAINT', 'TRENT', 'DMART', 'VOLTAS', 'HAVELLS', 'DIXON'],
  Cement: ['ULTRACEMCO', 'SHREECEM', 'AMBUJACEM', 'GRASIM', 'DALBHARAT'],
  Infra: ['LT', 'ADANIPORTS', 'ADANIENT', 'GMRAIRPORT', 'IRB'],
  'Cap Goods': ['SIEMENS', 'ABB', 'BHEL', 'CGPOWER', 'CUMMINSIND', 'POLYCAB'],
  Defence: ['HAL', 'BEL', 'BDL', 'MAZDOCK'],
  Realty: ['DLF', 'GODREJPROP', 'OBEROIRLTY', 'LODHA', 'PRESTIGE'],
  Telecom: ['BHARTIARTL', 'IDEA', 'INDUSTOWER'],
  'New Age': ['ETERNAL', 'NYKAA', 'PAYTM', 'POLICYBZR', 'SWIGGY'],
  Logistics: ['INDIGO', 'CONCOR', 'DELHIVERY'],
  PSU: ['IRFC', 'RVNL', 'IRCTC', 'HUDCO', 'IREDA'],
};

export const INDICES = { NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK' };

export const yahooSymbol = (s) => (s.startsWith('^') ? s : `${s}.NS`);

export function allStocks() {
  const out = [];
  for (const [sector, list] of Object.entries(UNIVERSE)) for (const sym of list) out.push({ sym, sector });
  return out;
}
