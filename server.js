// server.js — CyberSentinel backend (Deploy-Ready)

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';

// === Initialize app ===
const app = express();
const server = http.createServer(app);

// === CORS (supports Railway URL automatically) ===
app.use(cors({
  origin: [
    "http://127.0.0.1:5500",     // local development
    "http://localhost:5500",
    /\.railway\.app$/,           // allow Railway frontend
    /\.vercel\.app$/,            // allow Vercel frontend
  ],
  credentials: true
}));

app.use(express.json());

// Temporary store for verification codes
const pendingCodes = new Map();

// === Step 1: Login ===
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username && password && password.length >= 6) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    pendingCodes.set(username, code);
    console.log(2FA code for ${username}: ${code});
    res.json({ ok: true, msg: 'Verification code sent. Verify using /api/verify.' });
  } else {
    res.json({ ok: false, msg: 'Invalid credentials' });
  }
});

// === Step 2: Verify ===
app.post('/api/verify', (req, res) => {
  const { username, code } = req.body;
  const expected = pendingCodes.get(username);

  if (expected && code === expected) {
    pendingCodes.delete(username);
    const token = Buffer.from(${username}:${Date.now()}).toString('base64');
    res.json({ ok: true, token });
  } else {
    res.json({ ok: false, msg: 'Invalid verification code' });
  }
});

// === Event endpoint ===
app.post('/api/events', (req, res) => {
  const { type, value, meta } = req.body;
  console.log('Event received:', type, value, meta);

  const riskScore = Math.floor(Math.random() * 100);
  res.setHeader('x-risk-score', riskScore.toString());
  res.json({ ok: true });
});

// === WebSocket stream ===
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('WebSocket connected');

  const interval = setInterval(() => {
    const risk = Math.floor(Math.random() * 100);
    ws.send(JSON.stringify({ kind: 'risk', risk }));
  }, 5000);

  ws.on('close', () => clearInterval(interval));
});

// === Start server (IMPORTANT FOR DEPLOYMENT) ===
const PORT = process.env.PORT || 8081;
server.listen(PORT, '0.0.0.0', () => {
  console.log(CyberSentinel backend running on port ${PORT});
});