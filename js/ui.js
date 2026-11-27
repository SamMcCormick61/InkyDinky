// Page helpers shared by the one-device and online modes.

import { COLORS, SIZES } from './canvas.js';

export const $ = (id) => document.getElementById(id);

export function showScreen(name) {
  const overlay = $('overlay');
  overlay.hidden = !name;
  for (const panel of overlay.querySelectorAll('.panel')) {
    panel.classList.toggle('show', panel.dataset.screen === name);
  }
}

export function setHint(text, plain = false) {
  const h = $('hint');
  h.textContent = plain ? text : String(text).replace(/ /g, '  ');
  h.classList.toggle('plain', plain);
}

export function setTimer(seconds, low = false) {
  const t = $('timer');
  t.hidden = false;
  t.textContent = Math.max(0, seconds);
  t.classList.toggle('low', low);
}

export function setRound(round, rounds) {
  const r = $('round');
  r.hidden = !round;
  r.textContent = `Round ${round} of ${rounds}`;
}

// ----- players -----

// players: [{ id, name, score, isAI }]; drawerId; guessed: Set or array of ids; youId optional
export function renderPlayers(players, { drawerId = null, guessed = [], youId = null, hostId = null } = {}) {
  const done = new Set(guessed);
  const list = $('players');
  list.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    const drawing = p.id && p.id === drawerId;
    const got = p.id && done.has(p.id);
    li.className = drawing ? 'drawing' : got ? 'guessed' : '';
    li.innerHTML = '<span class="badge"></span><span class="name"></span><span class="score"></span>';
    li.querySelector('.badge').textContent = drawing ? '✏️' : got ? '✓' : p.isAI ? '🤖' : '';
    let label = p.name;
    if (p.id && p.id === youId) label += ' (you)';
    if (p.id && p.id === hostId) label += ' ★';
    li.querySelector('.name').textContent = label;
    li.querySelector('.score').textContent = p.score ?? 0;
    list.append(li);
  }
}

// ----- chat -----

export function clearChat() {
  $('chat').innerHTML = '';
}

export function addChat(name, text) {
  const p = document.createElement('p');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = `${name}: `;
  p.append(who, document.createTextNode(text));
  appendChat(p);
}

export function addLine(text, cls = 'sys') {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  appendChat(p);
}

function appendChat(el) {
  const chat = $('chat');
  chat.append(el);
  while (chat.children.length > 200) chat.firstChild.remove();
  chat.scrollTop = chat.scrollHeight;
}

// ----- end of turn and game -----

export const REVEAL_REASONS = {
  time: "Time's up!",
  'all-guessed': 'Everyone got it!',
  'drawer-left': 'The drawer left.',
};

export function renderReveal({ word, reason, points, players }) {
  $('reveal-word').textContent = word || '…';
  $('reveal-reason').textContent = REVEAL_REASONS[reason] || '';
  const list = $('reveal-points');
  list.innerHTML = '';
  for (const p of [...players].sort((a, b) => (points[b.id] || 0) - (points[a.id] || 0))) {
    const li = document.createElement('li');
    const gain = points[p.id] || 0;
    li.innerHTML = '<span></span><span></span>';
    li.children[0].textContent = p.name;
    li.children[1].textContent = gain ? `+${gain}` : '0';
    li.children[1].className = gain ? 'gain' : 'muted';
    list.append(li);
  }
}

export function renderRanking(ranking) {
  const list = $('ranking');
  list.innerHTML = '';
  ranking.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><span></span>';
    li.children[0].textContent = (i === 0 ? '🏆 ' : '') + p.name;
    li.children[1].textContent = p.score;
    list.append(li);
  });
}

export function renderChoices(words, onPick) {
  const box = $('choices');
  box.innerHTML = '';
  words.forEach((word, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.textContent = word;
    b.addEventListener('click', () => onPick(i));
    box.append(b);
  });
}

// ----- toolbar -----

export function setToolbar(enabled) {
  $('toolbar').classList.toggle('disabled', !enabled);
}

export function buildToolbar(board) {
  const sizes = $('sizes');
  for (const size of SIZES) {
    const b = document.createElement('button');
    b.className = 'tool' + (size === board.size ? ' active' : '');
    b.title = `Brush size ${size}`;
    b.setAttribute('aria-label', `Brush size ${size}`);
    const dot = document.createElement('span');
    dot.className = 'size-dot';
    const px = Math.max(4, Math.min(26, size));
    dot.style.width = dot.style.height = `${px}px`;
    b.append(dot);
    b.addEventListener('click', () => {
      board.size = size;
      sizes.querySelectorAll('.tool').forEach((t) => t.classList.toggle('active', t === b));
    });
    sizes.append(b);
  }

  const palette = $('palette');
  for (const color of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (color === board.color ? ' active' : '');
    b.style.background = color;
    b.title = color;
    b.setAttribute('aria-label', `Colour ${color}`);
    b.addEventListener('click', () => {
      board.color = color;
      palette.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === b));
      if (board.tool === 'eraser') selectTool('pen');
    });
    palette.append(b);
  }

  const selectTool = (tool) => {
    board.tool = tool;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  };

  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.tool)));
  $('undo').addEventListener('click', () => board.undo());
  $('clear').addEventListener('click', () => board.clear());

  document.addEventListener('keydown', (e) => {
    if (!board.enabled || e.target.matches('input, select, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      board.undo();
    } else if (e.key === 'p') selectTool('pen');
    else if (e.key === 'e') selectTool('eraser');
    else if (e.key === 'f') selectTool('fill');
  });
}

// ----- small storage helpers (never required to work) -----

export function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(`inkydinky.${key}`));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(`inkydinky.${key}`, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

// ----- Claude API key (shared by the AI Lab and online games) -----

// The key always lasts for this tab; "remember" also keeps it on this device.
export function loadKey() {
  let inTab = '';
  try {
    inTab = sessionStorage.getItem('inkydinky.key') || '';
  } catch { /* ignore */ }
  const saved = load('apiKey', '');
  return { key: saved || inTab, remembered: Boolean(saved) };
}

export function saveKey(key, remember) {
  try {
    sessionStorage.setItem('inkydinky.key', key);
  } catch { /* ignore */ }
  save('apiKey', remember ? key : '');
}
