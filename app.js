import { connect, mode } from './transport.js';
import { DEFAULT_WORDS } from './words.js';

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
function lev(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 99;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const AVATAR_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e84393', '#00b894', '#6c5ce7', '#fd79a8', '#0984e3'];
const avatarColor = (id) => AVATAR_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2200); }

const CHOOSE_TIME = 15, REVEAL_TIME = 6;

// ---------- state ----------
const me = { id: Math.random().toString(36).slice(2, 10), name: '', joinedAt: 0 };
let net = null, room = '';
let players = [];          // presence list sorted by joinedAt
let hostId = null;
let state = {              // public game state (authoritative copy lives on host)
  phase: 'lobby', turnId: 0, round: 0, drawerId: null, mask: '', endsAt: 0, guessed: [],
  scores: {}, gains: {}, reveal: '',
  settings: { rounds: 3, drawTime: 80, customWords: '', customOnly: false },
};
let myWord = '';           // only set for the drawer
let myChoices = [];
const H = { word: '', choices: [], timer: null, tick: null, used: new Set(), order: [], turnIdx: -1, turnStart: 0, hints: 0 };
const amHost = () => hostId === me.id;
const isDrawer = () => state.drawerId === me.id;
const nameOf = (id) => (players.find((p) => p.id === id) || {}).name || 'Someone';

// ---------- network ----------
function emit(e, p, local = true) {
  net && net.send(e, p);
  if (local) onMessage(e, p);
}

function onMessage(e, p) {
  switch (e) {
    case 'state': applyState(p); break;
    case 'chat': if (!p.to || p.to === me.id) addChat(p); break;
    case 'draw': drawOps(p.ops); break;
    case 'choices': if (p.to === me.id) { myChoices = p.words; renderOverlay(); } break;
    case 'word': if (p.to === me.id) { myWord = p.word; renderTop(); } break;
    case 'sync': if (p.to === me.id) { if (p.first) replaceLog(p.ops); else drawOps(p.ops); } break;
    // host-only handlers
    case 'guess': if (amHost()) hostGuess(p); break;
    case 'pick': if (amHost() && p.from === state.drawerId && H.choices.includes(p.word)) hostStartDrawing(p.word); break;
    case 'sync-req': if (amHost()) { sendState(); for (let i = 0; i < Math.max(1, log.length); i += 400) net.send('sync', { to: p.from, first: i === 0, ops: log.slice(i, i + 400) }); } break;
  }
}

function onPresence(list) {
  const before = new Set(players.map((p) => p.id));
  const oldNames = Object.fromEntries(players.map((p) => [p.id, p.name]));
  players = list.slice().sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  const prevHost = hostId;
  hostId = players.length ? players[0].id : null;
  if (amHost()) {
    for (const p of players) if (!before.has(p.id) && p.id !== me.id && before.size) addChatLocal({ kind: 'sys', text: `${p.name} joined the room` }, true);
    for (const id of before) if (!players.find((p) => p.id === id)) addChatLocal({ kind: 'bad', text: `${oldNames[id] || 'A player'} left the room` }, true);
    if (prevHost !== me.id && prevHost !== null) hostTakeover();
    else hostCheckPlayers();
    sendState();
  }
  if (net) renderAll();
}
// host-side chat helper: broadcast system messages to everyone (including self)
function addChatLocal(msg, broadcast) { broadcast ? emit('chat', msg) : addChat(msg); }

// ---------- host game logic ----------
const snapshot = () => ({ ...state, by: me.id, endsAt: undefined, remaining: Math.max(0, state.endsAt - Date.now()) });
function pushState() { emit('state', snapshot()); }
function sendState() { net && net.send('state', snapshot()); }

function wordPool() {
  const custom = state.settings.customWords.split(/[,\n]/).map((w) => w.trim()).filter((w) => w && w.length <= 30);
  return { custom: [...new Set(custom)], useDefault: !(state.settings.customOnly && custom.length >= 3) };
}
function pickChoices() {
  const { custom, useDefault } = wordPool();
  const out = new Set();
  let guard = 0;
  while (out.size < 3 && guard++ < 200) {
    const fromCustom = custom.length && (!useDefault || Math.random() < 0.5);
    const w = fromCustom ? rand(custom) : rand(DEFAULT_WORDS);
    if (H.used.has(norm(w)) && guard < 150) continue;
    out.add(w);
  }
  return [...out];
}

function hostStartGame() {
  if (players.length < 2) return toast('Need at least 2 players');
  clearTimers();
  state.scores = Object.fromEntries(players.map((p) => [p.id, 0]));
  state.round = 1; H.used.clear();
  H.order = players.map((p) => p.id); H.turnIdx = -1;
  emit('chat', { kind: 'sys', text: 'Game started! Good luck 🎨' });
  hostNextTurn();
}

function clearTimers() { clearTimeout(H.timer); clearInterval(H.tick); H.timer = H.tick = null; }

function hostNextTurn() {
  clearTimers();
  const present = new Set(players.map((p) => p.id));
  if (present.size < 2) return hostToLobby('Not enough players — back to the lobby.');
  let drawer = null;
  while (!drawer) {
    H.turnIdx++;
    if (H.turnIdx >= H.order.length) {
      state.round++;
      if (state.round > state.settings.rounds) return hostGameOver();
      H.order = players.map((p) => p.id); H.turnIdx = 0;
    }
    const cand = H.order[H.turnIdx];
    if (present.has(cand)) drawer = cand;
  }
  for (const p of players) if (!(p.id in state.scores)) state.scores[p.id] = 0;
  H.word = ''; H.choices = pickChoices(); H.hints = 0;
  Object.assign(state, { phase: 'choosing', turnId: state.turnId + 1, drawerId: drawer, mask: '', guessed: [], gains: {}, reveal: '', endsAt: Date.now() + CHOOSE_TIME * 1000 });
  pushState();
  emit('choices', { to: drawer, words: H.choices });
  H.timer = setTimeout(() => hostStartDrawing(H.choices[0]), CHOOSE_TIME * 1000 + 500);
}

function maskOf(word, revealed = new Set()) {
  return [...word].map((ch, i) => (ch === ' ' || ch === '-' || revealed.has(i) ? ch : '_')).join('');
}

function hostStartDrawing(word) {
  if (state.phase !== 'choosing') return;
  clearTimers();
  H.word = word; H.used.add(norm(word)); H.revealed = new Set(); H.turnStart = Date.now();
  const total = state.settings.drawTime * 1000;
  Object.assign(state, { phase: 'drawing', mask: maskOf(word), endsAt: Date.now() + total });
  emit('word', { to: state.drawerId, word });
  pushState();
  startTick(word);
}

function startTick(word) {
  const total = state.settings.drawTime * 1000;
  H.revealed = H.revealed || new Set();
  const letters = [...word].map((c, i) => [c, i]).filter(([c]) => c !== ' ' && c !== '-');
  const maxHints = letters.length >= 8 ? 3 : letters.length >= 5 ? 2 : letters.length >= 4 ? 1 : 0;
  H.tick = setInterval(() => {
    const left = state.endsAt - Date.now();
    const frac = 1 - left / total;
    const wantHints = Math.min(maxHints, Math.floor(frac / (1 / (maxHints + 1))));
    if (wantHints > H.hints) {
      H.hints = wantHints;
      const hidden = letters.filter(([, i]) => !H.revealed.has(i));
      if (hidden.length > 1) { H.revealed.add(rand(hidden)[1]); state.mask = maskOf(word, H.revealed); pushState(); }
    }
    if (left <= 0) hostEndTurn('time');
  }, 500);
}

function hostGuess({ from, name, text }) {
  const clean = String(text).slice(0, 80);
  if (state.phase !== 'drawing') return emit('chat', { kind: 'msg', name, text: clean });
  if (from === state.drawerId || state.guessed.includes(from)) return emit('chat', { kind: 'secret', name, text: clean, onlyGuessed: true });
  const g = norm(clean), w = norm(H.word);
  if (g === w) {
    const total = state.settings.drawTime * 1000, left = Math.max(0, state.endsAt - Date.now());
    const pts = Math.max(50, Math.round(100 + 300 * (left / total) - 20 * state.guessed.length));
    state.scores[from] = (state.scores[from] || 0) + pts;
    state.gains[from] = pts;
    const drawerPts = Math.round(pts / 3);
    state.scores[state.drawerId] = (state.scores[state.drawerId] || 0) + drawerPts;
    state.gains[state.drawerId] = (state.gains[state.drawerId] || 0) + drawerPts;
    state.guessed.push(from);
    emit('chat', { kind: 'good', text: `${name} guessed the word!` });
    emit('chat', { kind: 'good', to: from, text: `✅ You got it: "${H.word}" (+${pts})` });
    emit('word', { to: from, word: H.word });
    pushState();
    const guessers = players.filter((p) => p.id !== state.drawerId);
    if (guessers.every((p) => state.guessed.includes(p.id))) hostEndTurn('all');
    return;
  }
  emit('chat', { kind: 'msg', name, text: clean });
  if (w.length > 3 && lev(g, w) === 1) emit('chat', { kind: 'close', to: from, text: `"${clean}" is close!` });
}

function hostEndTurn(reason) {
  if (state.phase !== 'drawing' && state.phase !== 'choosing') return;
  clearTimers();
  const word = H.word || '—';
  const text = reason === 'all' ? 'Everyone guessed it!' : reason === 'left' ? 'The drawer left.' : reason === 'host' ? 'The host left, skipping this turn.' : "Time's up!";
  Object.assign(state, { phase: 'reveal', reveal: word, revealText: text, mask: word, endsAt: Date.now() + REVEAL_TIME * 1000 });
  emit('chat', { kind: 'sys', text: `The word was "${word}"` });
  pushState();
  H.timer = setTimeout(hostNextTurn, REVEAL_TIME * 1000);
}

function hostGameOver() {
  clearTimers();
  Object.assign(state, { phase: 'over', drawerId: null, mask: '', endsAt: 0, guessed: [] });
  const top = Object.entries(state.scores).sort((a, b) => b[1] - a[1])[0];
  if (top) emit('chat', { kind: 'sys', text: `🏆 ${nameOf(top[0])} wins with ${top[1]} points!` });
  pushState();
}

function hostToLobby(msg) {
  clearTimers();
  Object.assign(state, { phase: 'lobby', drawerId: null, mask: '', endsAt: 0, guessed: [], reveal: '' });
  if (msg) emit('chat', { kind: 'sys', text: msg });
  pushState();
}

function hostCheckPlayers() {
  if (state.phase === 'lobby' || state.phase === 'over') return;
  if (players.length < 2) return hostToLobby('Not enough players — back to the lobby.');
  const present = new Set(players.map((p) => p.id));
  if ((state.phase === 'drawing' || state.phase === 'choosing') && !present.has(state.drawerId)) return hostEndTurn('left');
  if (state.phase === 'drawing') {
    const guessers = players.filter((p) => p.id !== state.drawerId);
    if (guessers.length && guessers.every((p) => state.guessed.includes(p.id))) hostEndTurn('all');
  }
}

function hostTakeover() {
  // We just became host (previous host left). We don't know the secret word, so skip to the next turn.
  addChat({ kind: 'sys', text: 'You are now the room host 👑' });
  H.order = players.map((p) => p.id);
  H.turnIdx = Math.max(-1, H.order.indexOf(state.drawerId));
  state.endsAt = localEndsAt;
  if (state.phase === 'choosing' && isDrawer() && myChoices.length) {
    H.choices = myChoices;
    H.timer = setTimeout(() => hostStartDrawing(H.choices[0]), Math.max(0, localEndsAt - Date.now()) + 500);
  } else if (state.phase === 'drawing' && myWord) {
    H.word = myWord; H.revealed = new Set([...state.mask].map((c, i) => (c !== '_' && c !== ' ' && c !== '-' ? i : -1)).filter((i) => i >= 0));
    H.hints = H.revealed.size; startTick(myWord);
  } else if (state.phase === 'drawing' || state.phase === 'choosing') { H.word = ''; hostEndTurn('host'); }
  else if (state.phase === 'reveal') { clearTimers(); H.timer = setTimeout(hostNextTurn, 3000); }
}

// ---------- applying state (all clients) ----------
let localEndsAt = 0, lastTurnId = -1;
function applyState(s) {
  if (s.by !== hostId) return; // ignore stale/transient hosts
  const turnChanged = s.turnId !== lastTurnId;
  if (!amHost()) {
    // non-hosts keep everything except timers; host keeps its own authoritative copy
    const { remaining, ...rest } = s;
    state = { ...state, ...rest };
  }
  localEndsAt = Date.now() + (s.remaining ?? Math.max(0, state.endsAt - Date.now()));
  if (turnChanged) { lastTurnId = s.turnId; replaceLog([]); if (s.drawerId !== me.id) { myWord = ''; myChoices = []; } }
  if (!(state.phase === 'choosing' && isDrawer())) myChoices = [];
  if (state.phase === 'lobby' || state.phase === 'over') myWord = '';
  renderAll();
}

// ---------- drawing ----------
const canvas = $('board');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const W = canvas.width, Hh = canvas.height;
let log = [];            // effective ops for the current turn
let tool = 'brush', color = '#000000', size = 6;
let pending = [], current = null, strokeSeq = 0;

function resetCanvas() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, Hh); }
function replaceLog(ops) { log = []; resetCanvas(); for (const op of ops) applyOp(op); }
function drawOps(ops) { for (const op of ops) applyOp(op); }

function applyOp(op) {
  if (op.k === 'c') { log = []; resetCanvas(); return; }
  if (op.k === 'u') {
    if (!log.length) return;
    const s = log[log.length - 1].s;
    while (log.length && log[log.length - 1].s === s) log.pop();
    const keep = log; log = []; resetCanvas(); for (const o of keep) applyOp(o);
    return;
  }
  log.push(op);
  if (op.k === 'l') renderLine(op);
  else if (op.k === 'f') floodFill(op.x, op.y, op.c);
}
function renderLine({ c, w, p }) {
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0], p[1], w / 2, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.beginPath(); ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function floodFill(x, y, c) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= W || y >= Hh) return;
  const img = ctx.getImageData(0, 0, W, Hh), d = img.data;
  const i0 = (y * W + x) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  const [fr, fg, fb] = hexToRgb(c);
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 10) return;
  const tol = 60, match = (i) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= tol;
  const seen = new Uint8Array(W * Hh), stack = [x, y];
  while (stack.length) {
    const py = stack.pop(), px0 = stack.pop();
    let px = px0;
    while (px >= 0 && !seen[py * W + px] && match((py * W + px) * 4)) px--;
    px++;
    let up = false, down = false;
    while (px < W && !seen[py * W + px] && match((py * W + px) * 4)) {
      const idx = py * W + px, i = idx * 4;
      seen[idx] = 1; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
      if (py > 0) { const ok = !seen[idx - W] && match(i - W * 4); if (ok && !up) { stack.push(px, py - 1); up = true; } else if (!ok) up = false; }
      if (py < Hh - 1) { const ok = !seen[idx + W] && match(i + W * 4); if (ok && !down) { stack.push(px, py + 1); down = true; } else if (!ok) down = false; }
      px++;
    }
  }
  // grow fill by 1px into anti-aliased edges
  ctx.putImageData(img, 0, 0);
}

const canDraw = () => isDrawer() && state.phase === 'drawing';
function canvasPoint(ev) {
  const r = canvas.getBoundingClientRect();
  // account for object-fit: contain letterboxing
  const scale = Math.min(r.width / W, r.height / Hh);
  const ox = (r.width - W * scale) / 2, oy = (r.height - Hh * scale) / 2;
  return [Math.round((ev.clientX - r.left - ox) / scale), Math.round((ev.clientY - r.top - oy) / scale)];
}
function queue(op) { pending.push(op); }
function flush() {
  if (current && current.p.length >= 4) {
    const op = { ...current, p: current.p.slice() };
    queue(op);
    const last = current.p.slice(-2); current.p = last; // continue from last point
  }
  if (!pending.length) return;
  net && net.send('draw', { ops: pending });
  pending = [];
}
setInterval(flush, 50);

canvas.addEventListener('pointerdown', (ev) => {
  if (!canDraw()) return;
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  const [x, y] = canvasPoint(ev);
  const s = `${me.id}-${++strokeSeq}`;
  if (tool === 'fill') { const op = { k: 'f', s, x, y, c: color }; applyOp(op); queue(op); return; }
  const c = tool === 'eraser' ? '#ffffff' : color;
  const dot = { k: 'l', s, c, w: size, p: [x, y] };
  applyOp(dot); queue(dot);
  current = { k: 'l', s, c, w: size, p: [x, y] };
});
canvas.addEventListener('pointermove', (ev) => {
  if (!current || !canDraw()) return;
  const [x, y] = canvasPoint(ev);
  const p = current.p, lx = p[p.length - 2], ly = p[p.length - 1];
  if (Math.abs(x - lx) + Math.abs(y - ly) < 2) return;
  renderLine({ c: current.c, w: current.w, p: [lx, ly, x, y] });
  p.push(x, y);
  // keep local log in sync (segment-wise), the network gets batched polylines
  log.push({ k: 'l', s: current.s, c: current.c, w: current.w, p: [lx, ly, x, y], local: true });
});
const endStroke = () => { if (current) { flush(); current = null; } };
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

function sendOp(op) { applyOp(op); queue(op); flush(); }
$('undoBtn').onclick = () => canDraw() && sendOp({ k: 'u' });
$('clearBtn').onclick = () => canDraw() && sendOp({ k: 'c' });
document.querySelectorAll('.tool[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
function setTool(t) { tool = t; document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t)); }
document.addEventListener('keydown', (ev) => {
  if (!canDraw() || document.activeElement === $('chatInput')) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); sendOp({ k: 'u' }); }
  else if (ev.key === 'b') setTool('brush'); else if (ev.key === 'f') setTool('fill'); else if (ev.key === 'e') setTool('eraser');
});

const PALETTE = ['#000000', '#4d4d4d', '#999999', '#ffffff', '#e74c3c', '#c0392b', '#ff7f50', '#e67e22', '#f1c40f', '#fff176', '#2ecc71',
  '#27ae60', '#1abc9c', '#81ecec', '#3498db', '#1e3799', '#9b59b6', '#6c3483', '#ff6eb4', '#ffc0cb', '#8b5a2b', '#d2a679'];
$('colors').innerHTML = PALETTE.map((c) => `<button class="swatch${c === color ? ' active' : ''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
$('colors').onclick = (ev) => {
  const c = ev.target.dataset.c; if (!c) return;
  color = c; if (tool === 'eraser') setTool('brush');
  document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s.dataset.c === c));
};
const SIZES = [3, 6, 12, 24];
$('sizes').innerHTML = SIZES.map((s) => `<button class="size${s === size ? ' active' : ''}" data-s="${s}"><i style="width:${Math.min(s, 22)}px;height:${Math.min(s, 22)}px"></i></button>`).join('');
$('sizes').onclick = (ev) => {
  const b = ev.target.closest('.size'); if (!b) return;
  size = +b.dataset.s; document.querySelectorAll('.size').forEach((x) => x.classList.toggle('active', x === b));
};

// ---------- chat ----------
function addChat(m) {
  if (m.onlyGuessed && !(isDrawer() || state.guessed.includes(me.id))) return;
  const el = document.createElement('div');
  el.className = 'msg ' + (m.kind || 'msg');
  el.innerHTML = m.name ? `<b>${esc(m.name)}:</b>${esc(m.text)}` : esc(m.text);
  const logEl = $('chatLog');
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  logEl.appendChild(el);
  while (logEl.children.length > 200) logEl.firstChild.remove();
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}
$('chatForm').onsubmit = (ev) => {
  ev.preventDefault();
  const text = $('chatInput').value.trim(); if (!text) return;
  $('chatInput').value = '';
  const msg = { from: me.id, name: me.name, text };
  if (amHost()) hostGuess(msg); else net.send('guess', msg);
};

// ---------- rendering ----------
function renderAll() { renderTop(); renderPlayers(); renderOverlay(); renderToolbar(); }

function renderTop() {
  const wb = $('wordBox');
  if (state.phase === 'drawing') {
    if ((isDrawer() || state.guessed.includes(me.id)) && myWord) wb.innerHTML = `${esc(myWord.toUpperCase())}<small>${isDrawer() ? 'Draw this!' : 'You guessed it! 🎉'}</small>`;
    else if (state.guessed.includes(me.id)) wb.innerHTML = `${esc(state.mask.toUpperCase())}<small>You guessed it! 🎉</small>`;
    else {
      const lens = state.mask.split(' ').map((w) => w.length).join(' ');
      wb.innerHTML = `${esc(state.mask.replace(/ /g, ' ').split('').join(' '))}<small>GUESS THIS (${lens})</small>`;
    }
  } else if (state.phase === 'choosing') wb.innerHTML = `<small>${isDrawer() ? 'Pick a word!' : esc(nameOf(state.drawerId)) + ' is choosing a word…'}</small>`;
  else if (state.phase === 'reveal') wb.innerHTML = `${esc(state.reveal.toUpperCase())}<small>The word was</small>`;
  else if (state.phase === 'over') wb.innerHTML = `<small>Game over!</small>`;
  else wb.innerHTML = `<small>Waiting in lobby</small>`;
  $('roundInfo').textContent = state.phase === 'lobby' ? '' : state.phase === 'over' ? 'Final' : `Round ${Math.min(state.round, state.settings.rounds)} of ${state.settings.rounds}`;
}

function renderPlayers() {
  const ranked = [...players].sort((a, b) => (state.scores[b.id] || 0) - (state.scores[a.id] || 0));
  const rankOf = Object.fromEntries(ranked.map((p, i) => [p.id, i + 1]));
  $('players').innerHTML = players.map((p) => {
    const badges = [p.id === hostId ? '👑' : '', p.id === state.drawerId && state.phase !== 'lobby' ? '✏️' : ''].join('');
    const cls = ['player', p.id === me.id ? 'me' : '', state.guessed.includes(p.id) ? 'guessed' : ''].join(' ');
    return `<div class="${cls}"><div class="prank">#${rankOf[p.id]}</div>
      <div class="avatar" style="background:${avatarColor(p.id)}">${esc((p.name || '?')[0].toUpperCase())}</div>
      <div class="pinfo"><div class="pname">${esc(p.name)}</div><div class="pscore">${state.scores[p.id] || 0} pts</div></div>
      <div class="badge">${badges}</div></div>`;
  }).join('');
}

function renderToolbar() {
  $('toolbar').classList.toggle('hidden', !canDraw());
  canvas.classList.toggle('can-draw', canDraw());
  const ci = $('chatInput');
  ci.placeholder = canDraw() ? 'You are drawing — chat only visible to guessers who got it' : state.guessed.includes(me.id) ? 'You guessed it! Chat with others who did' : 'Type your guess here…';
}

let overlayKey = '';
function renderOverlay() {
  const ov = $('overlay');
  const key = JSON.stringify([state.phase, state.turnId, myChoices, amHost(), players.length, state.phase === 'over' ? state.scores : 0, state.phase === 'lobby' && !amHost() ? state.settings : 0]);
  if (state.phase === 'drawing') { ov.classList.add('hidden'); overlayKey = key; return; }
  if (key === overlayKey && !ov.classList.contains('hidden')) return;
  // don't rebuild the lobby form while the host is typing in it
  if (state.phase === 'lobby' && amHost() && ov.contains(document.activeElement) && overlayKey.startsWith('["lobby"')) { updateStartBtn(); return; }
  overlayKey = key;
  ov.classList.remove('hidden');

  if (state.phase === 'lobby') return renderLobby(ov);
  if (state.phase === 'choosing') {
    if (isDrawer() && myChoices.length) {
      ov.innerHTML = `<h2>Choose a word</h2><div class="choices">${myChoices.map((w) => `<button class="btn" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>`;
      ov.querySelectorAll('[data-w]').forEach((b) => (b.onclick = () => {
        const w = b.dataset.w;
        if (amHost()) hostStartDrawing(w); else net.send('pick', { from: me.id, word: w });
        ov.innerHTML = '<p>Get ready to draw…</p>';
      }));
    } else ov.innerHTML = `<h2>${esc(nameOf(state.drawerId))} is choosing a word…</h2>`;
    return;
  }
  if (state.phase === 'reveal') {
    const rows = [...players].sort((a, b) => (state.gains[b.id] || 0) - (state.gains[a.id] || 0))
      .map((p) => `<tr><td>${esc(p.name)}</td><td class="${state.gains[p.id] ? 'gain' : 'zero'}">+${state.gains[p.id] || 0}</td></tr>`).join('');
    ov.innerHTML = `<p>${esc(state.revealText || '')} The word was</p><div class="reveal">${esc(state.reveal)}</div><table>${rows}</table>`;
    return;
  }
  if (state.phase === 'over') {
    const ranked = [...players].sort((a, b) => (state.scores[b.id] || 0) - (state.scores[a.id] || 0));
    const medals = ['🥇', '🥈', '🥉'];
    ov.innerHTML = `<h2>🏆 Final scores</h2><table>${ranked.map((p, i) => `<tr><td>${medals[i] || '#' + (i + 1)} ${esc(p.name)}</td><td class="gain">${state.scores[p.id] || 0}</td></tr>`).join('')}</table>
      ${amHost() ? '<button class="btn primary" id="againBtn">Back to lobby</button>' : '<p>Waiting for the host…</p>'}`;
    const again = $('againBtn'); if (again) again.onclick = () => hostToLobby();
  }
}

function renderLobby(ov) {
  const s = state.settings, host = amHost(), dis = host ? '' : 'disabled';
  const customCount = wordPoolCount();
  ov.innerHTML = `<div class="settings">
    <h3>${host ? 'Room settings' : 'Waiting for the host to start…'}</h3>
    <div class="grid2">
      <label>Rounds<select id="setRounds" ${dis}>${[2, 3, 4, 5, 6, 8, 10].map((n) => `<option ${n === s.rounds ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Draw time (s)<select id="setTime" ${dis}>${[30, 45, 60, 80, 100, 120, 150, 180].map((n) => `<option ${n === s.drawTime ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <label>Custom words <span class="hint">comma or new-line separated · ${customCount} words</span>
      <textarea id="setWords" ${dis} placeholder="inside jokes, friend names, places you've been…">${esc(s.customWords)}</textarea></label>
    <label class="check"><input type="checkbox" id="setOnly" ${s.customOnly ? 'checked' : ''} ${dis}/> Use custom words only <span class="hint">(needs 3+ words)</span></label>
    ${host ? `<button class="btn primary big" id="startBtn">Start game</button>` : ''}
    <p class="hint" id="lobbyHint"></p>
  </div>`;
  if (host) {
    const sync = () => {
      s.rounds = +$('setRounds').value; s.drawTime = +$('setTime').value;
      s.customWords = $('setWords').value.slice(0, 5000); s.customOnly = $('setOnly').checked;
      clearTimeout(sync._t); sync._t = setTimeout(sendState, 300);
      ov.querySelector('.hint').textContent = `comma or new-line separated · ${wordPoolCount()} words`;
    };
    ['setRounds', 'setTime', 'setOnly'].forEach((id) => ($(id).onchange = sync));
    $('setWords').oninput = sync;
    $('startBtn').onclick = hostStartGame;
  }
  updateStartBtn();
}
function wordPoolCount() { return wordPool().custom.length; }
function updateStartBtn() {
  const b = $('startBtn'), hint = $('lobbyHint');
  if (b) b.disabled = players.length < 2;
  if (hint) hint.textContent = players.length < 2 ? 'Share the invite link — you need at least 2 players.' : `${players.length} players ready.`;
}

// timer display
setInterval(() => {
  const t = $('timer');
  if (['drawing', 'choosing', 'reveal'].includes(state.phase)) {
    const s = Math.max(0, Math.ceil((localEndsAt - Date.now()) / 1000));
    t.textContent = s; t.classList.toggle('low', state.phase === 'drawing' && s <= 10);
  } else { t.textContent = '—'; t.classList.remove('low'); }
}, 250);

// ---------- landing / join ----------
function genCode() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return Array.from({ length: 5 }, () => rand([...a])).join(''); }
const params = new URLSearchParams(location.search);
$('nameInput').value = store.get('doodle-name') || '';
if (params.get('room')) { $('codeInput').value = params.get('room').toUpperCase(); $('createBtn').classList.add('hidden'); $('joinBtn').classList.add('primary'); }
$('modeNote').textContent = mode() === 'local' ? '⚠️ Local mode: no server configured, only tabs in this browser can play together.' : '';

async function join(code) {
  const name = $('nameInput').value.trim();
  if (!name) { $('landingErr').textContent = 'Enter your name first'; $('nameInput').focus(); return; }
  if (!/^[A-Z0-9]{4,5}$/.test(code)) { $('landingErr').textContent = 'Room codes are 5 letters'; return; }
  store.set('doodle-name', name);
  me.name = name; me.joinedAt = Date.now(); room = code;
  $('landingErr').textContent = 'Connecting…';
  try {
    net = await connect(code, me, { onMessage, onPresence });
  } catch (e) { $('landingErr').textContent = e.message; return; }
  history.replaceState(null, '', `?room=${code}`);
  $('roomCode').textContent = code;
  $('landing').classList.add('hidden'); $('game').classList.remove('hidden');
  resetCanvas();
  addChat({ kind: 'sys', text: `Welcome, ${name}! Room ${code}` });
  // ask the host for current state + drawing (in case we joined mid-turn)
  setTimeout(() => !amHost() && net.send('sync-req', { from: me.id }), 600);
  renderAll();
  $('chatInput').focus();
}
$('createBtn').onclick = () => join(genCode());
$('joinBtn').onclick = () => join($('codeInput').value.trim().toUpperCase());
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') (params.get('room') ? $('joinBtn') : $('createBtn')).click(); });
$('inviteBtn').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${room}`;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch { prompt('Copy this link:', url); }
};
window.addEventListener('beforeunload', () => net && net.leave());
