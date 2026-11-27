// InkyDinky game engine.
//
// Pure game rules with no DOM access, so the same engine can run on one
// device now and inside the host's browser for online rooms later. The UI
// (or a network host) calls the methods below and listens for events.

export const DEFAULT_SETTINGS = {
  rounds: 3,        // every player draws once per round
  drawTime: 80,     // seconds to draw each word
  choiceCount: 3,   // words offered to the drawer
  revealTime: 5,    // seconds to show the answer between turns
  maxPlayers: 8,
};

export function normalise(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

let nextId = 1;

export class Game {
  constructor({ words, settings = {}, random = Math.random } = {}) {
    if (!words || words.length === 0) throw new Error('Game needs a word list');
    this.words = words;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.random = random;
    this.listeners = new Set();
    this.players = [];
    this.phase = 'lobby'; // lobby | choosing | drawing | reveal | gameover
    this.round = 0;
    this.turnIndex = -1;
    this.drawerId = null;
    this.choices = [];
    this.word = null;
    this.timeLeft = 0;
    this.guessed = new Set();
    this.revealed = new Set();
    this.turnPoints = {};
    this.usedWords = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data = {}) {
    for (const fn of this.listeners) fn({ type, ...data });
  }

  // ----- players -----

  addPlayer(name, { isAI = false } = {}) {
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) throw new Error('Player needs a name');
    if (this.players.length >= this.settings.maxPlayers) throw new Error('Room is full');
    if (this.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`${clean} is already playing`);
    }
    const player = { id: `p${nextId++}`, name: clean, score: 0, isAI };
    this.players.push(player);
    this.emit('players', { players: this.players });
    return player;
  }

  removePlayer(id) {
    const index = this.players.findIndex((p) => p.id === id);
    if (index === -1) return;
    const wasDrawer = id === this.drawerId;
    this.players.splice(index, 1);
    if (index <= this.turnIndex) this.turnIndex--;
    this.guessed.delete(id);
    this.emit('players', { players: this.players });
    if (this.phase !== 'lobby' && this.phase !== 'gameover') {
      if (this.players.length < 2) return this.finish();
      if (wasDrawer && (this.phase === 'choosing' || this.phase === 'drawing')) this.endTurn('drawer-left');
      else if (this.phase === 'drawing') this.checkAllGuessed();
    }
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  get drawer() {
    return this.player(this.drawerId);
  }

  // ----- flow -----

  start() {
    if (this.players.length < 2) throw new Error('Need at least 2 players');
    for (const p of this.players) p.score = 0;
    this.round = 1;
    this.turnIndex = -1;
    this.usedWords.clear();
    this.emit('start', { settings: this.settings });
    this.nextTurn();
  }

  nextTurn() {
    this.turnIndex++;
    if (this.turnIndex >= this.players.length) {
      this.turnIndex = 0;
      this.round++;
    }
    if (this.round > this.settings.rounds) return this.finish();

    this.drawerId = this.players[this.turnIndex].id;
    this.word = null;
    this.guessed = new Set();
    this.revealed = new Set();
    this.turnPoints = {};
    this.choices = this.pickWords(this.settings.choiceCount);
    this.phase = 'choosing';
    this.emit('turn', { drawerId: this.drawerId, round: this.round });
  }

  pickWords(count) {
    let pool = this.words.filter((w) => !this.usedWords.has(w));
    if (pool.length < count) {
      this.usedWords.clear();
      pool = [...this.words];
    }
    const picked = [];
    while (picked.length < count && pool.length) {
      const i = Math.floor(this.random() * pool.length);
      picked.push(pool.splice(i, 1)[0]);
    }
    return picked;
  }

  chooseWord(index) {
    if (this.phase !== 'choosing') throw new Error('Not choosing a word right now');
    const word = this.choices[index];
    if (!word) throw new Error('No such word');
    this.word = word;
    this.usedWords.add(word);
    this.timeLeft = this.settings.drawTime;
    this.phase = 'drawing';
    this.emit('drawing', { drawerId: this.drawerId, hint: this.hint() });
  }

  // Call once a second.
  tick() {
    if (this.phase === 'drawing') {
      this.timeLeft--;
      this.maybeRevealLetter();
      this.emit('tick', { timeLeft: this.timeLeft, hint: this.hint() });
      if (this.timeLeft <= 0) this.endTurn('time');
    } else if (this.phase === 'reveal') {
      this.timeLeft--;
      this.emit('tick', { timeLeft: this.timeLeft });
      if (this.timeLeft <= 0) this.nextTurn();
    }
  }

  endTurn(reason) {
    if (this.phase !== 'drawing' && this.phase !== 'choosing') return;
    // The drawer earns points for each player who got it.
    const drawer = this.drawer;
    if (drawer && this.guessed.size > 0) {
      const others = Math.max(1, this.players.length - 1);
      const bonus = Math.round((this.guessed.size / others) * 100) + this.guessed.size * 25;
      drawer.score += bonus;
      this.turnPoints[drawer.id] = bonus;
    }
    this.phase = 'reveal';
    this.timeLeft = this.settings.revealTime;
    this.emit('reveal', { word: this.word, reason, points: { ...this.turnPoints } });
  }

  finish() {
    this.phase = 'gameover';
    this.drawerId = null;
    const ranking = [...this.players].sort((a, b) => b.score - a.score);
    this.emit('gameover', { ranking });
  }

  // ----- guessing -----

  // Returns { kind: 'correct' | 'close' | 'wrong' | 'chat' | 'hidden' }.
  guess(playerId, text) {
    const player = this.player(playerId);
    const raw = String(text || '').trim().slice(0, 100);
    if (!player || !raw) return { kind: 'ignored' };

    const canGuess = this.phase === 'drawing' && playerId !== this.drawerId && !this.guessed.has(playerId);
    if (!canGuess) {
      // Stop the drawer and people who already know from leaking the answer.
      const knowsWord = this.phase === 'drawing' && (playerId === this.drawerId || this.guessed.has(playerId));
      if (knowsWord && this.word && normalise(raw).includes(normalise(this.word))) {
        return { kind: 'hidden' };
      }
      this.emit('chat', { playerId, text: raw });
      return { kind: 'chat' };
    }

    const attempt = normalise(raw);
    const answer = normalise(this.word);
    if (attempt === answer) {
      const points = Math.max(50, Math.round(300 * (this.timeLeft / this.settings.drawTime)));
      player.score += points;
      this.turnPoints[playerId] = points;
      this.guessed.add(playerId);
      this.emit('correct', { playerId, points });
      this.checkAllGuessed();
      return { kind: 'correct', points };
    }

    this.emit('chat', { playerId, text: raw });
    if (answer.length > 3 && levenshtein(attempt, answer) === 1) {
      this.emit('close', { playerId, text: raw });
      return { kind: 'close' };
    }
    return { kind: 'wrong' };
  }

  checkAllGuessed() {
    const guessers = this.players.filter((p) => p.id !== this.drawerId);
    if (this.phase === 'drawing' && guessers.length > 0 && guessers.every((p) => this.guessed.has(p.id))) {
      this.endTurn('all-guessed');
    }
  }

  // ----- hints -----

  // Reveal one letter at 50% and another at 75% of the time used,
  // but never more than a third of the letters.
  maybeRevealLetter() {
    if (!this.word) return;
    const used = 1 - this.timeLeft / this.settings.drawTime;
    const letters = [...this.word].map((c, i) => (c === ' ' ? -1 : i)).filter((i) => i >= 0);
    const maxReveal = Math.floor(letters.length / 3);
    const wanted = Math.min(maxReveal, used >= 0.75 ? 2 : used >= 0.5 ? 1 : 0);
    while (this.revealed.size < wanted) {
      const hidden = letters.filter((i) => !this.revealed.has(i));
      if (!hidden.length) break;
      this.revealed.add(hidden[Math.floor(this.random() * hidden.length)]);
    }
  }

  // Word shown to guessers, e.g. "_ _ t   _ _ _ _" with spaces kept.
  hint() {
    if (!this.word) return '';
    return [...this.word].map((c, i) => (c === ' ' ? ' ' : this.revealed.has(i) ? c : '_')).join('');
  }

  // Public view of the game. The word is only included for those who know it.
  snapshot(forPlayerId = null) {
    const knows = forPlayerId && (forPlayerId === this.drawerId || this.guessed.has(forPlayerId));
    return {
      phase: this.phase,
      round: this.round,
      rounds: this.settings.rounds,
      drawerId: this.drawerId,
      players: this.players.map((p) => ({ ...p, guessed: this.guessed.has(p.id) })),
      timeLeft: this.timeLeft,
      hint: this.hint(),
      word: knows || this.phase === 'reveal' ? this.word : null,
      choices: forPlayerId === this.drawerId && this.phase === 'choosing' ? this.choices : null,
    };
  }
}
