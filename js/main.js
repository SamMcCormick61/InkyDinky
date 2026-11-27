// InkyDinky: pass-and-play on one device.
// Wires the game engine (game.js) and drawing board (canvas.js) to the page.

import { Game } from './game.js';
import { DrawingBoard, COLORS, SIZES } from './canvas.js';
import { WORDS } from './words.js';

const $ = (id) => document.getElementById(id);

const board = new DrawingBoard($('canvas'));
let game = newGame();
let ticker = null;
let lobbyNames = loadNames();

function newGame(settings = {}) {
  const g = new Game({ words: WORDS, settings });
  g.on(onGameEvent);
  return g;
}

// ---------------- screens ----------------

function showScreen(name) {
  const overlay = $('overlay');
  overlay.hidden = !name;
  for (const panel of overlay.querySelectorAll('.panel')) {
    panel.classList.toggle('show', panel.dataset.screen === name);
  }
}

// ---------------- lobby ----------------

function renderLobby() {
  const list = $('lobby-players');
  list.innerHTML = '';
  lobbyNames.forEach((name, i) => {
    const li = document.createElement('li');
    li.textContent = name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove ${name}`;
    remove.addEventListener('click', () => {
      lobbyNames.splice(i, 1);
      saveNames();
      renderLobby();
    });
    li.append(remove);
    list.append(li);
  });
  renderPlayers();
  $('start').disabled = lobbyNames.length < 2;
  $('start').textContent = lobbyNames.length < 2 ? 'Add at least 2 players' : `Start game with ${lobbyNames.length}`;
}

$('add-player').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('player-name');
  const name = input.value.trim().slice(0, 20);
  $('lobby-error').textContent = '';
  if (!name) return;
  if (lobbyNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
    $('lobby-error').textContent = `${name} is already in.`;
    return;
  }
  if (lobbyNames.length >= 8) {
    $('lobby-error').textContent = 'Up to 8 players.';
    return;
  }
  lobbyNames.push(name);
  saveNames();
  input.value = '';
  input.focus();
  renderLobby();
});

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('new-players').addEventListener('click', toLobby);

function startGame() {
  game = newGame({ rounds: Number($('set-rounds').value), drawTime: Number($('set-time').value) });
  for (const name of lobbyNames) game.addPlayer(name);
  $('chat').innerHTML = '';
  board.reset();
  game.start();
}

function toLobby() {
  stopTicker();
  game = newGame();
  board.reset();
  board.setEnabled(false);
  setToolbar(false);
  $('timer').hidden = true;
  $('round').hidden = true;
  $('peek').hidden = true;
  setHint('Waiting for players…', true);
  renderPlayers();
  renderGuessers();
  showScreen('lobby');
  renderLobby();
}

// ---------------- game events ----------------

function onGameEvent(ev) {
  switch (ev.type) {
    case 'turn': {
      stopTicker();
      board.reset();
      board.setEnabled(false);
      setToolbar(false);
      $('timer').hidden = true;
      $('peek').hidden = true;
      $('round').hidden = false;
      $('round').textContent = `Round ${game.round} of ${game.settings.rounds}`;
      const drawer = game.drawer;
      setHint(`${drawer.name} is choosing a word…`, true);
      $('handoff-name').textContent = drawer.name;
      $('handoff-round').textContent = `Round ${game.round} of ${game.settings.rounds}`;
      showScreen('handoff');
      $('ready').focus();
      addSystem(`${drawer.name} is drawing next.`);
      break;
    }
    case 'drawing': {
      showScreen(null);
      board.setEnabled(true);
      setToolbar(true);
      $('peek').hidden = false;
      setHint(ev.hint);
      setTimer(game.timeLeft);
      startTicker();
      break;
    }
    case 'tick': {
      setTimer(ev.timeLeft);
      if (game.phase === 'drawing') setHint(ev.hint);
      if (game.phase === 'reveal') $('reveal-count').textContent = Math.max(0, ev.timeLeft);
      break;
    }
    case 'chat': {
      addChat(game.player(ev.playerId), ev.text);
      break;
    }
    case 'close': {
      addLine(`“${ev.text}” is close!`, 'close');
      break;
    }
    case 'correct': {
      const p = game.player(ev.playerId);
      addLine(`${p.name} guessed it! +${ev.points}`, 'good');
      break;
    }
    case 'reveal': {
      board.setEnabled(false);
      setToolbar(false);
      $('peek').hidden = true;
      setHint(game.word || '', true);
      $('reveal-word').textContent = ev.word || '…';
      $('reveal-reason').textContent = {
        time: "Time's up!",
        'all-guessed': 'Everyone got it!',
        'drawer-left': 'The drawer left.',
      }[ev.reason] || '';
      const list = $('reveal-points');
      list.innerHTML = '';
      for (const p of [...game.players].sort((a, b) => (ev.points[b.id] || 0) - (ev.points[a.id] || 0))) {
        const li = document.createElement('li');
        const gain = ev.points[p.id] || 0;
        li.innerHTML = `<span></span><span class="${gain ? 'gain' : 'muted'}">${gain ? '+' + gain : '0'}</span>`;
        li.firstChild.textContent = p.name;
        list.append(li);
      }
      $('reveal-count').textContent = game.timeLeft;
      if (ev.word) addSystem(`The word was “${ev.word}”.`);
      // Hold the answer screen on top of the finished drawing.
      setTimeout(() => game.phase === 'reveal' && showScreen('reveal'), 600);
      break;
    }
    case 'gameover': {
      stopTicker();
      board.setEnabled(false);
      setToolbar(false);
      $('timer').hidden = true;
      $('peek').hidden = true;
      setHint('Game over!', true);
      const list = $('ranking');
      list.innerHTML = '';
      ev.ranking.forEach((p, i) => {
        const li = document.createElement('li');
        li.innerHTML = '<span></span><span></span>';
        li.children[0].textContent = (i === 0 ? '🏆 ' : '') + p.name;
        li.children[1].textContent = p.score;
        list.append(li);
      });
      showScreen('gameover');
      break;
    }
  }
  renderPlayers();
  renderGuessers();
}

// ---------------- turn screens ----------------

$('ready').addEventListener('click', () => {
  const box = $('choices');
  box.innerHTML = '';
  game.choices.forEach((word, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.textContent = word;
    b.addEventListener('click', () => game.chooseWord(i));
    box.append(b);
  });
  showScreen('choose');
});

// Hold to peek at the word, so it isn't on screen for everyone.
const peek = $('peek');
const showWord = (e) => {
  e.preventDefault();
  if (game.phase === 'drawing') setHint(game.word, true);
};
const hideWord = () => {
  if (game.phase === 'drawing') setHint(game.hint());
};
peek.addEventListener('pointerdown', showWord);
peek.addEventListener('pointerup', hideWord);
peek.addEventListener('pointerleave', hideWord);
peek.addEventListener('pointercancel', hideWord);

// ---------------- timer ----------------

function startTicker() {
  stopTicker();
  ticker = setInterval(() => game.tick(), 1000);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function setTimer(seconds) {
  const t = $('timer');
  t.hidden = false;
  t.textContent = Math.max(0, seconds);
  t.classList.toggle('low', game.phase === 'drawing' && seconds <= 10);
}

function setHint(text, plain = false) {
  const h = $('hint');
  h.textContent = plain ? text : text.replace(/ /g, '  ');
  h.classList.toggle('plain', plain);
}

// ---------------- players + chat ----------------

function renderPlayers() {
  const list = $('players');
  list.innerHTML = '';
  const ranked = game.players.length ? game.players : lobbyNames.map((name) => ({ name, score: 0 }));
  for (const p of ranked) {
    const li = document.createElement('li');
    const drawing = p.id && p.id === game.drawerId && game.phase !== 'gameover';
    const guessed = p.id && game.guessed.has(p.id);
    li.className = drawing ? 'drawing' : guessed ? 'guessed' : '';
    li.innerHTML = '<span class="badge"></span><span class="name"></span><span class="score"></span>';
    li.querySelector('.badge').textContent = drawing ? '✏️' : guessed ? '✓' : '';
    li.querySelector('.name').textContent = p.name;
    li.querySelector('.score').textContent = p.score;
    list.append(li);
  }
}

function renderGuessers() {
  const select = $('guesser');
  const previous = select.value;
  const canGuess = game.phase === 'drawing';
  const options = game.players.filter((p) => !canGuess || (p.id !== game.drawerId && !game.guessed.has(p.id)));
  select.innerHTML = '';
  for (const p of options) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    select.append(o);
  }
  if (options.some((p) => p.id === previous)) select.value = previous;
  const usable = options.length > 0 && game.phase !== 'lobby';
  $('guess').disabled = !usable;
  select.disabled = !usable;
  $('guess-form').classList.toggle('disabled', !usable);
  $('guess').placeholder = canGuess ? 'Type your guess…' : 'Chat…';
}

$('guess-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('guess');
  const text = input.value.trim();
  if (!text || !$('guesser').value) return;
  const result = game.guess($('guesser').value, text);
  if (result.kind === 'hidden') addLine("Shh, don't give the word away!", 'sys');
  input.value = '';
  input.focus();
});

function addChat(player, text) {
  const p = document.createElement('p');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = `${player ? player.name : '?'}: `;
  p.append(who, document.createTextNode(text));
  appendChat(p);
}

function addLine(text, cls) {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  appendChat(p);
}

function addSystem(text) {
  addLine(text, 'sys');
}

function appendChat(el) {
  const chat = $('chat');
  chat.append(el);
  chat.scrollTop = chat.scrollHeight;
}

// ---------------- toolbar ----------------

function setToolbar(enabled) {
  $('toolbar').classList.toggle('disabled', !enabled);
}

function buildToolbar() {
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

function selectTool(tool) {
  board.tool = tool;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
}

// ---------------- saved names ----------------

function loadNames() {
  try {
    const names = JSON.parse(localStorage.getItem('inkydinky.players') || '[]');
    return Array.isArray(names) ? names.filter((n) => typeof n === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveNames() {
  try {
    localStorage.setItem('inkydinky.players', JSON.stringify(lobbyNames));
  } catch {
    /* private mode: names just won't be remembered */
  }
}

// ---------------- go ----------------

buildToolbar();
toLobby();
// Handy for testing in the browser console.
window.inky = { get game() { return game; }, board };
