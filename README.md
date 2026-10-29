# OrderUnlock

Free, real-time order block scanner for NSE F&O stocks. Every feature is open — no plans, no locks.

```bash
npm start            # http://localhost:4173
```

Needs Node 20+. No dependencies.

## What it shows

| Section | What it is |
|---|---|
| **Market strip** | Every stock as a dot by % change; stacks show breadth; best/worst ringed. Click a dot → stock modal. |
| **Setups** | Top 3 bullish + top 3 bearish by conviction. Tap → jump to its tile, hold (or right-click) → modal. |
| **Sectors** | Avg % change + one bar segment per stock. Click → sector list with TOP / CONTENDER / HERD status. |
| **Flow** | Each stock's % from previous close through the session, NIFTY/BANKNIFTY lines, end-of-day distribution, TOP-5 boxes. Click a line to isolate it. |
| **Contenders** | Ranks 2–20 per side in tiers (11–20, 6–10, 2–5). Tiles are volume-by-price profiles with live price and active OB. |
| **Top card** | #1 bullish / #1 bearish: candles, order blocks, FVGs, VWAP, EMA-20, Z / S1–S3 / R1–R3, R:R, tag. |
| **Stock modal** | Intraday sparkline, full OB chart, Rank, Conviction, RVOL, Δ VWAP, OB, Z/S1, R1/R2, R:R, structure, rule; FLOW / TILE / SETUP jumps, ←/→ to step. |
| **Journal / Learn / Settings** | Local trading journal with live P&L, glossary of every metric, theme. |

## How it works

- `lib/feed.js` — polls Yahoo Finance's public chart API: 20-symbol `spark` batches (~1s cycle, backs off on HTTP 429) for live prices and 1-minute session closes; per-symbol 5-minute candles (5 sessions) round-robin for structure. The live price patches the newest candle every tick.
- `lib/engine.js` — fractal pivots → break of structure → order blocks (last opposite candle before a displacement move), mitigation, FVGs, VWAP, EMA, levels, conviction score (−100…+100), R:R, tags.
- `server.js` — ranks both sides, pushes state over Server-Sent Events every second and flow series every 15s.
- `public/` — vanilla JS + canvas, no build step.

## Limits

- Yahoo's NSE feed can lag the exchange slightly; for true tick data plug a broker websocket (Upstox / Kite / Dhan) into `Feed`.
- Futures open interest is not included (no free public API); build-up tags use price + relative volume.
- Educational tool, not investment advice.
