// Claude as a player in an online room.
//
// The host adds it using the Claude settings they turned on (artist.js), so it
// uses the host's API key. It runs in the host's browser and joins the room
// through a loopback connection, so the game treats it like anyone else:
//   - on other players' turns it looks at the drawing every so often and types
//     a guess. Wrong guesses show in the chat like anyone's; a right one just
//     shows "Claude guessed it!".
//   - on its own turn it picks a word and draws it with the host's Claude
//     drawing settings (speed, style, context clues).

import { loopback } from './net.js';

const MAX_GUESSES = 6;

export class ClaudePlayer {
  // artist: the ClaudeArtist with the host's key and settings.
  // makeBoard(): a DrawingBoard (with a canvas) Claude looks at when guessing.
  constructor({ artist, makeBoard, name = 'Claude', onStatus = () => {}, timing = {} }) {
    this.artist = artist;
    this.name = name;
    this.board = makeBoard();
    this.onStatus = onStatus;
    this.timing = { chooseMs: 3000, firstGuessMs: null, guessEveryMs: 12000, jitterMs: 4000, ...timing };
    this.conn = null;
    this.id = null;
    this.state = null;
    this.turnKey = null;
    this.guessAbort = null;
    this.rejected = false;
  }

  join(host) {
    const [mine, theirs] = loopback();
    this.conn = mine;
    host.accept(theirs, { bot: true });
    mine.onMessage((msg) => this.onMessage(msg));
    mine.onClose(() => this.stopGuessing());
    mine.send({ t: 'hello', name: this.name });
  }

  leave() {
    this.stopGuessing();
    this.conn?.close();
    this.conn = null;
  }

  send(msg) {
    this.conn?.send(msg);
  }

  onMessage(msg) {
    const b = this.board;
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        break;
      case 'reject':
        this.rejected = true;
        this.leave();
        this.onStatus(`Claude couldn't join: ${msg.reason}`, true);
        break;
      case 'state':
        this.state = msg.state;
        this.react();
        break;
      case 'board':
        b.load(msg.ops || []);
        break;
      case 'live':
        if (msg.start) b.liveStart(msg.color, msg.size, msg.points);
        else b.liveAppend(msg.points);
        break;
      case 'op':
        b.remoteOp(msg.op);
        break;
      case 'undo':
        b.remoteUndo();
        break;
    }
  }

  me() {
    return this.state?.players.find((p) => p.id === this.id);
  }

  // Runs on every state update, but only acts when the phase or turn changes.
  react() {
    const s = this.state;
    const key = `${s.phase}:${s.drawerId}:${s.round}`;
    if (key === this.turnKey) return;
    this.turnKey = key;
    this.stopGuessing();
    const mine = s.drawerId === this.id;
    if (s.phase === 'choosing' && mine && s.choices) {
      // Take a moment to "think", then let Claude draw the word.
      setTimeout(() => {
        if (this.turnKey === key) this.send({ t: 'choose', index: Math.floor(Math.random() * s.choices.length), ai: true });
      }, this.timing.chooseMs);
    } else if (s.phase === 'drawing' && !mine) {
      this.guessLoop(key);
    }
  }

  stopGuessing() {
    this.guessAbort?.abort();
    this.guessAbort = null;
  }

  async guessLoop(key) {
    const ctrl = new AbortController();
    this.guessAbort = ctrl;
    const drawTime = this.state.settings?.drawTime ?? 80;
    const tried = [];
    let seen = -1;
    let idle = false;
    // Give the drawer a head start, like a person waiting to see what it is.
    let wait = this.timing.firstGuessMs ?? Math.max(10000, drawTime * 200);
    const live = () => this.turnKey === key && !ctrl.signal.aborted && !this.me()?.guessed;

    while (tried.length < MAX_GUESSES) {
      await sleep(wait + Math.random() * this.timing.jitterMs, ctrl.signal);
      wait = this.timing.guessEveryMs;
      if (!live()) return;
      const count = this.board.ops.length;
      if (!count) continue;
      // If the drawing hasn't changed, wait one more round before trying again.
      if (count === seen && !idle) {
        idle = true;
        continue;
      }
      seen = count;
      idle = false;
      try {
        const { guess } = await this.artist.guess({ canvas: this.board.canvas, avoid: tried, signal: ctrl.signal });
        if (!live() || !guess || tried.includes(guess)) continue;
        tried.push(guess);
        this.send({ t: 'guess', text: guess });
      } catch (err) {
        if (!ctrl.signal.aborted) this.onStatus(`Claude had trouble guessing: ${this.artist.friendlyError(err)}`, true);
        return;
      }
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}
