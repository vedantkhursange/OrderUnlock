// Records every plan that triggers and tracks what actually happened, so the
// scorecard shows honestly whether the setups work.
// Exit rule: stop = -1R; at T1 book half and move the stop to entry; the rest exits at T2,
// back at entry, or at the 15:15 square-off.
import fs from 'node:fs';
import path from 'node:path';
import { istMin } from './plans.js';

const istDate = (ms = Date.now()) => new Date(ms + 19800000).toISOString().slice(0, 10);

export class SignalTracker {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.date = istDate();
    this.list = this.load(this.date);
  }
  file(date) { return path.join(this.dir, `signals-${date}.json`); }
  load(date) { try { return JSON.parse(fs.readFileSync(this.file(date), 'utf8')); } catch { return []; } }
  save() { try { fs.writeFileSync(this.file(this.date), JSON.stringify(this.list, null, 1)); } catch {} }

  // rows: [{ sym, price, plan }] from the latest rebuild
  update(rows, now = Date.now()) {
    if (istDate(now) !== this.date) { this.date = istDate(now); this.list = this.load(this.date); }
    const min = istMin(now / 1000);
    let changed = false;
    const price = new Map(rows.map((r) => [r.sym, r.price]));

    for (const r of rows) {
      const p = r.plan;
      if (!p || p.state !== 'TRIGGERED' || p.conf < 50) continue;
      if (this.list.some((s) => s.sym === r.sym && s.setup === p.setup)) continue;
      this.list.push({
        id: `${r.sym}-${p.setup}-${now}`, sym: r.sym, setup: p.setup, side: p.side, conf: p.conf,
        at: now, entry: r.price, stop: p.stop, t1: p.t1, t2: p.t2, risk: Math.abs(r.price - p.stop) || p.riskPerShare,
        status: 'OPEN', best: 0, exit: null, exitAt: null, r: 0,
      });
      changed = true;
    }

    for (const s of this.list) {
      if (s.closed || (s.status !== 'OPEN' && s.status !== 'T1')) continue;
      const px = price.get(s.sym); if (px == null) continue;
      const dir = s.side === 'BUY' ? 1 : -1;
      const r = ((px - s.entry) * dir) / s.risk;
      s.best = Math.max(s.best, r);
      s.r = +(s.status === 'T1' ? (((s.t1 - s.entry) * dir) / s.risk) * 0.5 + r * 0.5 : r).toFixed(2);
      const hitStop = (px - s.stop) * dir <= 0;
      const hitT1 = (px - s.t1) * dir >= 0, hitT2 = (px - s.t2) * dir >= 0;
      if (s.status === 'OPEN' && hitStop) Object.assign(s, { status: 'SL', exit: s.stop, exitAt: now, r: -1 });
      else if (hitT2) Object.assign(s, { status: 'T2', exit: s.t2, exitAt: now, r: +((((s.t1 - s.entry) * dir) / s.risk) * 0.5 + (((s.t2 - s.entry) * dir) / s.risk) * 0.5).toFixed(2) });
      else if (s.status === 'OPEN' && hitT1) { s.status = 'T1'; s.t1At = now; }
      else if (s.status === 'T1' && (px - s.entry) * dir <= 0) Object.assign(s, { status: 'T1', exit: s.entry, exitAt: now, r: +(((s.t1 - s.entry) * dir) / s.risk * 0.5).toFixed(2), closed: true });
      if (min >= 915 && !s.exit) {
        const t1r = ((s.t1 - s.entry) * dir) / s.risk;
        Object.assign(s, { exit: px, exitAt: now, closed: true, r: +(s.status === 'T1' ? t1r * 0.5 + r * 0.5 : r).toFixed(2), status: s.status === 'OPEN' ? 'SQUARED' : s.status });
      }
      if (s.exit) s.closed = true;
      changed = true;
    }
    if (changed) this.save();
  }

  summary() {
    const done = this.list.filter((s) => s.closed || s.status === 'SL' || s.status === 'T2');
    const wins = done.filter((s) => s.r > 0).length;
    const totalR = this.list.reduce((a, s) => a + (s.r || 0), 0);
    return {
      date: this.date, total: this.list.length, open: this.list.filter((s) => !s.closed && s.status !== 'SL' && s.status !== 'T2').length,
      closed: done.length, wins, losses: done.filter((s) => s.r <= 0).length,
      winRate: done.length ? Math.round((wins / done.length) * 100) : null,
      hitT1: this.list.filter((s) => s.t1At || s.status === 'T2').length,
      totalR: +totalR.toFixed(2),
    };
  }
}
