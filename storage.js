// storage.js
export class Storage {
  constructor() {
    this.events = []; // { id, ts, domain, type, payload }
    this.max = 5000;
  }
  pushEvent(domain, type, payload = {}) {
    const item = {
      id: cryptoRandom(),
      ts: Date.now(),
      domain,
      type,
      payload
    };
    this.events.push(item);
    if (this.events.length > this.max) this.events.shift();
    return item;
  }
  query(q = '') {
    const qq = q.toLowerCase();
    if (!qq) return this.events.slice(-500);
    return this.events.filter(e =>
      e.domain.toLowerCase().includes(qq) ||
      e.type.toLowerCase().includes(qq) ||
      JSON.stringify(e.payload).toLowerCase().includes(qq)
    ).slice(-500);
  }
  exportJSON() {
    return JSON.stringify(this.events, null, 2);
  }
}

function cryptoRandom() {
  // Lightweight unique id
  return Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}