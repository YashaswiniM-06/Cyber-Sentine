// app.js — CyberSentinel frontend (integrated, ready to run)

/* ========= Utilities ========= */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const nowTs = () => new Date().toLocaleTimeString();
const toFixed = (n, d = 2) => Number.isFinite(n) ? n.toFixed(d) : '0.00';

function log(tag, message, kind = 'behavior') {
  const logStream = document.getElementById('logStream');
  if (!logStream) return;
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `<span class="ts">[${nowTs()}]</span><span class="tag ${kind}">${tag}</span>${message}`;
  logStream.appendChild(el);
  logStream.scrollTop = logStream.scrollHeight;
}

/* ========= Backend Integration ========= */
const API_BASE = 'http://localhost:8081';
let authToken = null;

async function backendLogin(username, password) {
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.ok) {
      authToken = data.token;
      log('BACKEND', 'Authenticated with backend', 'behavior');
    } else {
      log('BACKEND', `Login failed: ${data.msg || res.status}`, 'intrusion');
    }
  } catch (err) {
    log('BACKEND', `Login error: ${err.message}`, 'intrusion');
  }
}

async function sendEvent(type, value, meta = {}) {
  if (!authToken) {
    log('BACKEND', 'No auth token — login first', 'intrusion');
    return;
  }
  try {
    const r = await fetch(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ type, value, meta })
    });
    const risk = Number(r.headers.get('x-risk-score') || 0);
    const data = await r.json();
    if (data.ok) {
      el.riskGauge.draw(risk);
      log('BACKEND', `Event ${type} -> risk ${toFixed(risk, 1)}%`, 'behavior');
    } else {
      log('BACKEND', `Event ${type} failed: ${data.msg || r.status}`, 'intrusion');
    }
  } catch (e) {
    log('BACKEND', `sendEvent error: ${e.message}`, 'intrusion');
  }
}

// WebSocket risk updates (backend push)
(function connectWS() {
  try {
    const ws = new WebSocket('ws://localhost:8081/ws');
    ws.onopen = () => log('BACKEND', 'WebSocket connected', 'behavior');
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.kind === 'risk') {
        el.riskGauge.draw(msg.risk);
        log('BACKEND', `Risk update ${toFixed(msg.risk, 1)}%`, msg.risk > 70 ? 'alert' : 'behavior');
      }
    };
    ws.onerror = () => log('BACKEND', 'WebSocket error', 'intrusion');
    ws.onclose = () => log('BACKEND', 'WebSocket closed', 'intrusion');
  } catch (err) {
    log('BACKEND', `WS init error: ${err.message}`, 'intrusion');
  }
})();

/* ========= Sparkline Renderer ========= */
class Spark {
  constructor(canvas, maxPoints = 80, color = '#4f9cff') {
    this.ctx = canvas.getContext('2d');
    this.w = canvas.width;
    this.h = canvas.height;
    this.max = maxPoints;
    this.color = color;
    this.data = [];
  }
  push(v) {
    this.data.push(v);
    if (this.data.length > this.max) this.data.shift();
    this.draw();
  }
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const pad = 6;
    const maxV = Math.max(...this.data, 1);
    const minV = Math.min(...this.data, 0);
    const range = Math.max(maxV - minV, 1);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.data.forEach((v, i) => {
      const x = pad + (i / Math.max(this.data.length - 1, 1)) * (this.w - pad * 2);
      const y = pad + (1 - (v - minV) / range) * (this.h - pad * 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

/* ========= Gauge Renderer ========= */
class Gauge {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    this.w = canvas.width;
    this.h = canvas.height;
    this.value = 0;
  }
  draw(v) {
    this.value = clamp(v, 0, 100);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const center = { x: this.w / 2, y: this.h - 10 };
    const radius = Math.min(this.w, this.h * 2) / 2 - 20;
    const start = Math.PI;
    const end = 2 * Math.PI;

    // Track
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, start, end);
    ctx.strokeStyle = '#1e2a38';
    ctx.lineWidth = 14;
    ctx.stroke();

    // Progress
    const pEnd = start + (this.value / 100) * (end - start);
    const grad = ctx.createLinearGradient(0, 0, this.w, 0);
    grad.addColorStop(0, '#37d67a'); // green
    grad.addColorStop(0.6, '#ffc857'); // yellow
    grad.addColorStop(1, '#ff5252'); // red
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, start, pEnd);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Needle
    const angle = pEnd;
    const nx = center.x + (radius - 8) * Math.cos(angle);
    const ny = center.y + (radius - 8) * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = '#cfe0f7';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Text
    ctx.fillStyle = '#cfe0f7';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Risk: ${toFixed(this.value, 1)}%`, center.x, center.y - radius - 10);
  }
}

/* ========= Behavioral Model (EWMA) ========= */
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

const model = {
  keyLatency: new EWMA(0.15),
  mouseSpeed: new EWMA(0.15),
  pasteFreq: new EWMA(0.2),
  reqRate: new EWMA(0.15),
};

/* ========= State ========= */
let monitoring = false;
let lastKeyTime = 0;
let lastMouse = { x: 0, y: 0, t: performance.now() };
let pasteCount = 0;
let failedAuth = 0;
let reqWindow = [];
let devtoolsOpen = false;
let windowFocused = true;

/* ========= UI Elements ========= */
const el = {
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnSimAttack: document.getElementById('btnSimAttack'),
  searchLogs: document.getElementById('searchLogs'),
  btnClearLogs: document.getElementById('btnClearLogs'),
  btnExport: document.getElementById('btnExport'),
  sigKeyRhythm: document.getElementById('sigKeyRhythm'),
  sigMouseVel: document.getElementById('sigMouseVel'),
  sigPasteFreq: document.getElementById('sigPasteFreq'),
  sigWindowFocus: document.getElementById('sigWindowFocus'),
  sigDevtools: document.getElementById('sigDevtools'),
  sigFailedAuth: document.getElementById('sigFailedAuth'),
  sigRapidReq: document.getElementById('sigRapidReq'),
  sigHeaders: document.getElementById('sigHeaders'),
  sigBadIp: document.getElementById('sigBadIp'),
  demoUsername: document.getElementById('demoUsername'),
  demoPassword: document.getElementById('demoPassword'),
  btnLogin: document.getElementById('btnLogin'),
  btnPaste: document.getElementById('btnPaste'),
  btnRapidReq: document.getElementById('btnRapidReq'),
  riskGauge: new Gauge(document.getElementById('riskGauge')),
  sparkKey: new Spark(document.getElementById('sparkKey'), 80, '#4f9cff'),
  sparkMouse: new Spark(document.getElementById('sparkMouse'), 80, '#37d67a'),
  sparkReq: new Spark(document.getElementById('sparkReq'), 80, '#ffc857'),
};

/* ========= Event Capture ========= */
function onKeydown(ev) {
  if (!monitoring) return;
  const t = performance.now();
  if (lastKeyTime > 0) {
    const latencyMs = t - lastKeyTime;
    model.keyLatency.update(latencyMs);
    const z = Math.abs(model.keyLatency.zscore(latencyMs));
    el.sigKeyRhythm.textContent = `${toFixed(latencyMs)} ms (z=${toFixed(z)})`;
    el.sparkKey.push(latencyMs);
    log('KEY', `Latency ${toFixed(latencyMs)}ms`, 'behavior');
    sendEvent('keyLatency', latencyMs);
  }
  lastKeyTime = t;
}

function onMousemove(ev) {
  if (!monitoring) return;
  const t = performance.now();
  const dx = ev.clientX - lastMouse.x;
  const dy = ev.clientY - lastMouse.y;
  const dt = t - lastMouse.t;
  if (dt > 0) {
    const dist = Math.hypot(dx, dy);
    const speed = dist / dt; // px/ms
    model.mouseSpeed.update(speed);
    const z = Math.abs(model.mouseSpeed.zscore(speed));
    el.sigMouseVel.textContent = `${toFixed(speed)} px/ms (z=${toFixed(z)})`;
    el.sparkMouse.push(speed);
    sendEvent('mouseSpeed', speed);
  }
  lastMouse = { x: ev.clientX, y: ev.clientY, t };
}

function onPaste() {
  if (!monitoring) return;
  pasteCount += 1;
  model.pasteFreq.update(pasteCount);
  const z = Math.abs(model.pasteFreq.zscore(pasteCount));
  el.sigPasteFreq.textContent = `${pasteCount} (z=${toFixed(z)})`;
  log('PASTE', `Clipboard paste detected [count=${pasteCount}]`, 'behavior');
  sendEvent('paste', 1, { source: 'userPaste' });
}

function onFocus() {
  windowFocused = true;
  if (!monitoring) return;
  el.sigWindowFocus.textContent = 'Focused';
  log('WINDOW', 'Focus gained', 'behavior');
  sendEvent('windowFocus', true);
}

function onBlur() {
  windowFocused = false;
  if (!monitoring) return;
  el.sigWindowFocus.textContent = 'Blurred';
  log('WINDOW', 'Focus lost', 'behavior');
  sendEvent('windowFocus', false);
}

/* DevTools heuristic */
function detectDevtools() {
  const threshold = 160;
  const vwDiff = Math.abs(window.outerWidth - window.innerWidth);
  const vhDiff = Math.abs(window.outerHeight - window.innerHeight);
  const heavyGap = vwDiff > threshold || vhDiff > threshold;
  const evalDelayStart = performance.now();
  for (let i = 0; i < 1000000; i++) {} // busy loop
  const evalDelay = performance.now() - evalDelayStart;

  const open = heavyGap || evalDelay > 180;
  if (open !== devtoolsOpen) {
    devtoolsOpen = open;
    el.sigDevtools.textContent = devtoolsOpen ? 'Open' : 'Closed';
    log('DEVTOOLS', devtoolsOpen ? 'Detected open' : 'Detected closed', devtoolsOpen ? 'alert' : 'behavior');
    sendEvent('devtools', devtoolsOpen);
  }
}

/* ========= Intrusion Simulation ========= */
function pushRequest(rateIncrement = 1, badHeaders = false, badIp = false) {
  const t = Date.now();
  reqWindow.push(t);
  // keep 60s window
  reqWindow = reqWindow.filter(ts => t - ts < 60000);
  const perMin = reqWindow.length;

  model.reqRate.update(perMin);
  const z = Math.abs(model.reqRate.zscore(perMin));
  el.sigRapidReq.textContent = `${perMin}/min (z=${toFixed(z)})`;
  el.sparkReq.push(perMin);

  if (badHeaders) el.sigHeaders.textContent = 'Suspicious UA/X-Forwarded-For';
  if (badIp) {
    const count = parseInt(el.sigBadIp.textContent || '0', 10) + 1;
    el.sigBadIp.textContent = String(count);
  }

  log('REQ', `Rate=${perMin}/min ${badHeaders ? '[hdr]' : ''} ${badIp ? '[badIP]' : ''}`, badHeaders || badIp ? 'intrusion' : 'behavior');
  sendEvent('reqRate', perMin, { badHeaders, badIp });
}

function simulateAttack() {
  for (let i = 0; i < 30; i++) pushRequest(1, i % 5 === 0, i % 7 === 0);
  pasteCount += 5;
  model.pasteFreq.update(pasteCount);
  el.sigPasteFreq.textContent = `${pasteCount} (z=${toFixed(Math.abs(model.pasteFreq.zscore(pasteCount)))})`;
  failedAuth += 5;
  el.sigFailedAuth.textContent = String(failedAuth);
  devtoolsOpen = true;
  el.sigDevtools.textContent = 'Open';
  log('ATTACK', 'Simulated multi-vector intrusion', 'alert');
  // backend flags
  sendEvent('failedAuth', failedAuth);
  sendEvent('devtools', true);
  sendEvent('paste', 5, { source: 'attack' });
}

/* ========= Risk Scoring (local visualization) ========= */
function computeRisk() {
  const keyZ = Math.abs(model.keyLatency.zscore(el.sparkKey.data.at(-1) ?? model.keyLatency.mean));
  const mouseZ = Math.abs(model.mouseSpeed.zscore(el.sparkMouse.data.at(-1) ?? model.mouseSpeed.mean));
  const pasteZ = Math.abs(model.pasteFreq.zscore(pasteCount));
  const reqZ = Math.abs(model.reqRate.zscore(reqWindow.length));

  const focusPenalty = windowFocused ? 0 : 8;
  const devtoolsPenalty = devtoolsOpen ? 22 : 0;
  const failedPenalty = clamp(failedAuth * 4, 0, 28);

  const weighted = (
    clamp(keyZ * 6, 0, 22) +
    clamp(mouseZ * 4, 0, 18) +
    clamp(pasteZ * 3, 0, 15) +
    clamp(reqZ * 6, 0, 22) +
    focusPenalty + devtoolsPenalty + failedPenalty
  );

  const normalized = clamp(weighted, 0, 100);
  el.riskGauge.draw(normalized);
  if (normalized > 70) log('RISK', `High risk ${toFixed(normalized)}%`, 'alert');
  else if (normalized > 40) log('RISK', `Elevated risk ${toFixed(normalized)}%`, 'intrusion');
  return normalized;
}

/* ========= Controls ========= */
function startMonitoring() {
  if (monitoring) return;
  monitoring = true;
  log('SYSTEM', 'Monitoring started', 'behavior');
}
function stopMonitoring() {
  if (!monitoring) return;
  monitoring = false;
  log('SYSTEM', 'Monitoring stopped', 'behavior');
}

/* ========= Wiring ========= */
el.btnStart.addEventListener('click', startMonitoring);
el.btnStop.addEventListener('click', stopMonitoring);
el.btnSimAttack.addEventListener('click', simulateAttack);

document.addEventListener('keydown', onKeydown);
document.addEventListener('mousemove', onMousemove);
document.addEventListener('paste', onPaste);
window.addEventListener('focus', onFocus);
window.addEventListener('blur', onBlur);

el.searchLogs.addEventListener('input', (e) => {
  const val = e.target.value || '';
  const items = document.querySelectorAll('.log-entry');
  const q = val.trim().toLowerCase();
  items.forEach(i => {
    i.style.display = q && !i.textContent.toLowerCase().includes(q) ? 'none' : '';
  });
});

el.btnClearLogs.addEventListener('click', () => {
  const ls = document.getElementById('logStream');
  if (ls) ls.innerHTML = '';
  log('SYSTEM', 'Logs cleared', 'behavior');
});

el.btnExport.addEventListener('click', () => {
  const entries = Array.from(document.querySelectorAll('.log-entry')).map(n => n.textContent);
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cybersentine-logs-${Date.now()}.json`;
  a.click();
});

// Backend login
el.btnLogin.addEventListener('click', async () => {
  const u = el.demoUsername.value.trim();
  const p = el.demoPassword.value.trim();
  await backendLogin(u, p);
});

// Demo helpers
el.btnPaste.addEventListener('click', () => {
  if (!monitoring) log('PASTE', 'Start monitoring to capture paste', 'intrusion');
  onPaste();
});

el.btnRapidReq.addEventListener('click', () => {
  for (let i = 0; i < 20; i++) pushRequest();
  log('REQ', 'Rapid request burst', 'intrusion');
});

/* ========= Main loop ========= */
function tick() {
  detectDevtools();
  computeRisk();
  requestAnimationFrame(tick);
}

/* ========= Init ========= */
(function init() {
  el.sigWindowFocus.textContent = 'Focused';
  el.sigDevtools.textContent = 'Closed';
  el.sigHeaders.textContent = 'Clean';
  el.sigRapidReq.textContent = '0/min';
  el.sigFailedAuth.textContent = '0';
  el.sigBadIp.textContent = '0';
  log('SYSTEM', 'CyberSentinel UI initialized', 'behavior');

  // Seed baselines
  [50, 60, 55, 52].forEach(v => model.keyLatency.update(v)); // ms
  [0.05, 0.09, 0.06].forEach(v => model.mouseSpeed.update(v)); // px/ms
  [0, 0, 1].forEach(v => model.pasteFreq.update(v)); // count
  [4, 6, 5].forEach(v => model.reqRate.update(v)); // per minute

  // Initial render
  el.riskGauge.draw(0);
  requestAnimationFrame(tick);
})();