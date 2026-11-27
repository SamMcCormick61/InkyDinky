// InkyDinky: pass-and-play on one device.

import { Game } from './game.js';
import { WORDS } from './words.js';
import {
  $, showScreen, setHint, setTimer, setRound, renderPlayers, clearChat, addChat, addLine,
  renderReveal, renderRanking, renderChoices, setToolbar, load, save,
} from './ui.js';

export function startLocal(board, { onExit }) {
  let game = newGame();
  let ticker = null;
  const lobbyNames = load('players', []).filter((n) => typeof n === 'string').slice(0, 8);

  document.body.classList.add('mode-local');

  function newGame(settings = {}) {
    const g = new Game({ words: WORDS, settings });
    g.on(onGameEvent);
    return g;
  }

  // ---------- lobby ----------

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
        save('players', lobbyNames);
        renderLobby();
      });
      li.append(remove);
      list.append(li);
    });
    refreshPlayers();
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
    save('players', lobbyNames);
    input.value = '';
    input.focus();
    renderLobby();
  });

  $('start').addEventListener('click', startGame);
  $('again').addEventListener('click', startGame);
  $('new-players').addEventListener('click', toLobby);
  $('local-back').addEventListener('click', () => {
    stopTicker();
    onExit();
  });

  function startGame() {
    game = newGame({ rounds: Number($('set-rounds').value), drawTime: Number($('set-time').value) });
    for (const name of lobbyNames) game.addPlayer(name);
    clearChat();
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
    setHint('Add the players', true);
    refreshPlayers();
    renderGuessers();
    showScreen('lobby');
    renderLobby();
  }

  // ---------- game events ----------

  function onGameEvent(ev) {
    switch (ev.type) {
      case 'turn': {
        stopTicker();
        board.reset();
        board.setEnabled(false);
        setToolbar(false);
        $('timer').hidden = true;
        $('peek').hidden = true;
        setRound(game.round, game.settings.rounds);
        const drawer = game.drawer;
        setHint(`${drawer.name} is choosing a word…`, true);
        $('handoff-name').textContent = drawer.name;
        $('handoff-round').textContent = `Round ${game.round} of ${game.settings.rounds}`;
        showScreen('handoff');
        $('ready').focus();
        addLine(`${drawer.name} is drawing next.`);
        break;
      }
      case 'drawing':
        showScreen(null);
        board.setEnabled(true);
        setToolbar(true);
        $('peek').hidden = false;
        setHint(ev.hint);
        setTimer(game.timeLeft);
        startTicker();
        break;
      case 'tick':
        setTimer(ev.timeLeft, game.phase === 'drawing' && ev.timeLeft <= 10);
        if (game.phase === 'drawing') setHint(ev.hint);
        if (game.phase === 'reveal') $('reveal-count').textContent = Math.max(0, ev.timeLeft);
        break;
      case 'chat':
        addChat(game.player(ev.playerId)?.name ?? '?', ev.text);
        break;
      case 'close':
        addLine(`“${ev.text}” is close!`, 'close');
        break;
      case 'correct':
        addLine(`${game.player(ev.playerId).name} guessed it! +${ev.points}`, 'good');
        break;
      case 'reveal':
        board.setEnabled(false);
        setToolbar(false);
        $('peek').hidden = true;
        setHint(game.word || '', true);
        renderReveal({ word: ev.word, reason: ev.reason, points: ev.points, players: game.players });
        $('reveal-count').textContent = game.timeLeft;
        if (ev.word) addLine(`The word was “${ev.word}”.`);
        setTimeout(() => game.phase === 'reveal' && showScreen('reveal'), 600);
        break;
      case 'gameover':
        stopTicker();
        board.setEnabled(false);
        setToolbar(false);
        $('timer').hidden = true;
        $('peek').hidden = true;
        setHint('Game over!', true);
        renderRanking(ev.ranking);
        showScreen('gameover');
        break;
    }
    refreshPlayers();
    renderGuessers();
  }

  function refreshPlayers() {
    const players = game.players.length ? game.players : lobbyNames.map((name) => ({ name, score: 0 }));
    renderPlayers(players, {
      drawerId: game.phase === 'gameover' ? null : game.drawerId,
      guessed: game.guessed,
    });
  }

  // ---------- turn screens ----------

  $('ready').addEventListener('click', () => {
    renderChoices(game.choices, (i) => game.chooseWord(i));
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

  // ---------- timer ----------

  function startTicker() {
    stopTicker();
    ticker = setInterval(() => game.tick(), 1000);
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  // ---------- guessing ----------

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
    if (result.kind === 'hidden') addLine("Shh, don't give the word away!");
    input.value = '';
    input.focus();
  });

  toLobby();
  return { get game() { return game; } };
}
