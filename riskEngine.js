// riskEngine.js
export class RiskEngine {
  constructor() {
    this.models = {
      keyLatency: new EWMA(0.15),
      mouseSpeed: new EWMA(0.15),
      pasteFreq: new EWMA(0.2),
      reqRate: new EWMA(0.15)
    };
    this.flags = {
      focused: true,
      devtoolsOpen: false,
      badHeaders: false
    };
    this.counters = {
      failedAuth: 0,
      badIp: 0
    };
    this.lastRisk = 0;

    // Seed baselines
    [50, 60, 55, 52].forEach(v => this.models.keyLatency.update(v));
    [0.05, 0.09, 0.06].forEach(v => this.models.mouseSpeed.update(v));
    [0, 0, 1].forEach(v => this.models.pasteFreq.update(v));
    [4, 6, 5].forEach(v => this.models.reqRate.update(v));
  }

  update(key, value) {
    const m = this.models[key];
    if (!m || !Number.isFinite(value)) return;
    m.update(value);
  }

  increment(key, delta = 1) {
    if (key in this.counters) this.counters[key] += delta;
    else if (key in this.models) this.models[key].update((this.models[key].mean || 0) + delta);
  }

  bumpFailedAuth(n = 1) { this.counters.failedAuth += n; }
  setFlag(name, val) { this.flags[name] = Boolean(val); }

  compute() {
    const keyZ = Math.abs(this.models.keyLatency.zscore(this.models.keyLatency.mean));
    const mouseZ = Math.abs(this.models.mouseSpeed.zscore(this.models.mouseSpeed.mean));
    const pasteZ = Math.abs(this.models.pasteFreq.zscore(this.models.pasteFreq.mean));
    const reqZ = Math.abs(this.models.reqRate.zscore(this.models.reqRate.mean));

    const focusPenalty = this.flags.focused ? 0 : 8;
    const devtoolsPenalty = this.flags.devtoolsOpen ? 22 : 0;
    const failedPenalty = clamp(this.counters.failedAuth * 4, 0, 28);
    const badHeadersPenalty = this.flags.badHeaders ? 10 : 0;
    const badIpPenalty = clamp(this.counters.badIp * 3, 0, 20);

    const weighted = (
      clamp(keyZ * 6, 0, 22) +
      clamp(mouseZ * 4, 0, 18) +
      clamp(pasteZ * 3, 0, 15) +
      clamp(reqZ * 6, 0, 22) +
      focusPenalty + devtoolsPenalty + failedPenalty +
      badHeadersPenalty + badIpPenalty
    );

    this.lastRisk = clamp(weighted, 0, 100);
    return this.lastRisk;
  }
}

class EWMA {
  constructor(alpha = 0.15) {
    this.alpha = alpha;
    this.mean = 0;
    this.var = 0;
    this.n = 0;
  }
  update(x) {
    if (!Number.isFinite(x)) return;
    this.n += 1;
    if (this.n === 1) { this.mean = x; this.var = 0.0001; return; }
    const prevMean = this.mean;
    this.mean = this.alpha * x + (1 - this.alpha) * this.mean;
    this.var = this.alpha * Math.pow(x - prevMean, 2) + (1 - this.alpha) * this.var;
  }
  zscore(x) {
    const sd = Math.sqrt(this.var || 1e-6);
    return (x - this.mean) / (sd || 1e-6);
  }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }