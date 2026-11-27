// Runs an online room inside the host's browser.
//
// The host owns the one true copy of the game. Players (including the host's
// own player, through a loopback connection) send requests; the host checks
// them against the rules and tells everyone what happened.
//
// If the host has turned Claude on (setArtist), a drawer can ask Claude to draw
// their word for them. Claude's strokes go out from here as if the drawer
// had drawn them.

import { Game, DEFAULT_SETTINGS } from './game.js';
import { WORDS } from './words.js';
import { VERSION } from './version.js';

const CHOOSE_SECONDS = 15;

export class Host {
  constructor(room) {
    this.room = room;
    this.game = new Game({ words: WORDS });
    this.clients = new Map(); // conn -> playerId (null until hello)
    this.bots = new Set();    // connections from Claude players run in this browser
    this.ops = [];            // the current drawing, for players who join mid-turn
    this.ticker = null;
    this.hostPlayerId = null;
    this.artist = null;       // Claude, when the host has turned it on
    this.aiTurn = null;       // Claude's drawing for the current turn
    this.turnNo = 0;
    this.game.on((ev) => this.onGameEvent(ev));
    room.onConnection((conn) => this.accept(conn));
  }

  // opts.bot marks a Claude player that this browser runs itself.
  accept(conn, { bot = false } = {}) {
    this.clients.set(conn, null);
    if (bot) this.bots.add(conn);
    conn.onMessage((msg) => this.onMessage(conn, msg));
    conn.onClose(() => this.drop(conn));
  }

  drop(conn) {
    const id = this.clients.get(conn);
    this.clients.delete(conn);
    this.bots.delete(conn);
    if (!id) return;
    const player = this.game.player(id);
    if (player) this.broadcast({ t: 'note', text: `${player.name} left.` });
    const wasDrawer = id === this.game.drawerId;
    this.game.removePlayer(id);
    if (wasDrawer) this.ops = [];
    this.syncAll();
  }

  // Turns Claude on (an object with draw(), see artist.js) or off (null).
  setArtist(artist) {
    this.artist = artist;
    if (!artist) this.stopAi(true);
    this.syncAll();
  }

  idOf(conn) {
    return this.clients.get(conn);
  }

  // ----- incoming -----

  onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const id = this.idOf(conn);
    const g = this.game;

    if (msg.t === 'hello') {
      if (id) return;
      try {
        const player = g.addPlayer(msg.name, { isAI: this.bots.has(conn) });
        this.clients.set(conn, player.id);
        if (msg.isHost && !this.hostPlayerId) this.hostPlayerId = player.id;
        conn.send({ t: 'welcome', id: player.id, hostId: this.hostPlayerId, code: this.room.code, version: VERSION });
        conn.send({ t: 'board', ops: this.ops });
        this.broadcast({ t: 'note', text: `${player.name} joined.` }, conn);
        this.syncAll();
      } catch (err) {
        conn.send({ t: 'reject', reason: err.message });
        setTimeout(() => conn.close(), 500);
      }
      return;
    }
    if (!id) return;
    const isDrawer = id === g.drawerId;
    const isHost = id === this.hostPlayerId;

    switch (msg.t) {
      case 'start':
        if (!isHost || !(g.phase === 'lobby' || g.phase === 'gameover')) return;
        g.settings = { ...g.settings, ...pickSettings(msg.settings) };
        try {
          g.start();
        } catch (err) {
          conn.send({ t: 'note', text: err.message });
        }
        break;
      case 'choose':
        if (isDrawer && g.phase === 'choosing') {
          this.wantsAi = Boolean(msg.ai && this.artist);
          g.chooseWord(Number(msg.index));
        }
        break;
      case 'guess': {
        const result = g.guess(id, msg.text);
        if (result.kind === 'hidden') conn.send({ t: 'note', text: "Shh, don't give the word away!" });
        break;
      }
      case 'live':
        if (isDrawer && g.phase === 'drawing' && !this.aiTurn) this.broadcast(msg, conn);
        break;
      case 'op':
        if (isDrawer && g.phase === 'drawing' && msg.op && !this.aiTurn) {
          this.ops.push(msg.op);
          this.broadcast({ t: 'op', op: msg.op }, conn);
        }
        break;
      case 'undo':
        if (isDrawer && g.phase === 'drawing' && this.ops.length && !this.aiTurn) {
          this.ops.pop();
          this.broadcast({ t: 'undo' }, conn);
        }
        break;
    }
  }

  // ----- game events out -----

  onGameEvent(ev) {
    const g = this.game;
    switch (ev.type) {
      case 'start':
        this.broadcast({ t: 'ev', ev: { type: 'start' } });
        break;
      case 'turn':
        this.turnNo++;
        this.wantsAi = false;
        this.stopAi(true);
        this.ops = [];
        this.broadcast({ t: 'board', ops: [] });
        this.broadcast({ t: 'ev', ev: { type: 'turn', drawerId: ev.drawerId, round: ev.round } });
        this.startTicker();
        // Pick a word for a drawer who doesn't choose in time.
        clearTimeout(this.chooseTimer);
        this.chooseTimer = setTimeout(() => {
          if (g.phase === 'choosing' && g.drawerId === ev.drawerId) {
            g.chooseWord(Math.floor(Math.random() * g.choices.length));
          }
        }, CHOOSE_SECONDS * 1000);
        break;
      case 'drawing':
        clearTimeout(this.chooseTimer);
        this.broadcast({ t: 'ev', ev: { type: 'drawing', drawerId: ev.drawerId } });
        if (this.wantsAi) this.startAi();
        this.wantsAi = false;
        break;
      case 'chat':
        this.broadcast({ t: 'ev', ev: { type: 'chat', playerId: ev.playerId, text: ev.text } });
        break;
      case 'close':
        // Only the person who guessed needs to know they were close.
        this.sendTo(ev.playerId, { t: 'ev', ev: { type: 'close', text: ev.text } });
        break;
      case 'correct':
        this.broadcast({ t: 'ev', ev: { type: 'correct', playerId: ev.playerId, points: ev.points } });
        break;
      case 'reveal':
        this.broadcast({ t: 'ev', ev: { type: 'reveal', word: ev.word, reason: ev.reason, points: ev.points } });
        this.stopAi(false); // after the reveal, so Claude's note shows on it
        break;
      case 'gameover':
        this.stopAi(false);
        this.stopTicker();
        this.broadcast({ t: 'ev', ev: { type: 'gameover', ranking: ev.ranking.map(({ id, name, score }) => ({ id, name, score })) } });
        break;
    }
    this.syncAll();
  }

  // ----- Claude drawing for a player -----

  startAi() {
    const g = this.game;
    const turn = this.turnNo;
    const drawerId = g.drawerId;
    const ctrl = new AbortController();
    const ai = { turn, drawerId, ctrl, job: null, notes: null };
    this.aiTurn = ai;
    const active = () => this.aiTurn === ai && g.phase === 'drawing';
    const out = {
      liveStart: (color, size, points) => active() && this.broadcast({ t: 'live', start: true, color, size, points }),
      liveAppend: (points) => active() && this.broadcast({ t: 'live', points }),
      op: (op) => {
        if (!active()) return;
        this.ops.push(op);
        this.broadcast({ t: 'op', op });
      },
    };
    const drawer = g.player(drawerId);
    this.broadcast({ t: 'note', text: drawer?.isAI ? '🤖 Claude is drawing.' : `🤖 Claude is drawing for ${drawer?.name ?? 'the drawer'}.` });
    try {
      ai.job = this.artist.draw({ word: g.word, out, signal: ctrl.signal });
    } catch (err) {
      this.aiFailed(ai, err);
      return;
    }
    ai.job.notes.then(
      (notes) => {
        ai.notes = notes;
        // The turn may already be over if everyone guessed quickly.
        if (this.turnNo === turn && (g.phase === 'reveal' || g.phase === 'gameover')) this.shareNote(ai);
      },
      (err) => this.aiFailed(ai, err),
    );
  }

  aiFailed(ai, err) {
    if (ai.ctrl.signal.aborted || this.aiTurn !== ai) return;
    this.aiTurn = null;
    const name = this.game.player(ai.drawerId)?.name ?? 'the drawer';
    const why = this.artist?.friendlyError ? this.artist.friendlyError(err) : err?.message;
    this.broadcast({ t: 'note', text: `🤖 Claude couldn't draw this one (${why}). Over to you, ${name}!` });
    this.syncAll();
  }

  // Stops the pen. abortRequest also cancels the request to Claude; otherwise
  // it carries on so Claude's note can still arrive for the reveal.
  stopAi(abortRequest) {
    const ai = this.aiTurn;
    if (!ai) return;
    ai.job?.stop();
    if (abortRequest) {
      ai.ctrl.abort();
      this.aiTurn = null;
    } else {
      this.shareNote(ai);
    }
  }

  shareNote(ai) {
    if (!ai.notes || ai.shared) return;
    ai.shared = true;
    this.broadcast({ t: 'ev', ev: { type: 'ainote', drawerId: ai.drawerId, text: String(ai.notes).slice(0, 400) } });
  }

  startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.game.tick(), 1000);
  }

  stopTicker() {
    clearTimeout(this.chooseTimer);
    clearInterval(this.ticker);
    this.ticker = null;
  }

  // ----- sending -----

  syncAll() {
    for (const [conn, id] of this.clients) {
      if (!id) continue;
      conn.send({
        t: 'state',
        state: {
          ...this.game.snapshot(id),
          hostId: this.hostPlayerId,
          settings: this.game.settings,
          aiAvailable: Boolean(this.artist),
          aiDrawing: Boolean(this.aiTurn && this.aiTurn.turn === this.turnNo && this.game.phase === 'drawing'),
        },
      });
    }
  }

  broadcast(msg, except = null) {
    for (const [conn, id] of this.clients) {
      if (id && conn !== except) conn.send(msg);
    }
  }

  sendTo(playerId, msg) {
    for (const [conn, id] of this.clients) if (id === playerId) conn.send(msg);
  }

  close() {
    this.stopAi(true);
    this.stopTicker();
    for (const conn of this.clients.keys()) conn.close();
    this.room.close();
  }
}

function pickSettings(s = {}) {
  const out = {};
  const rounds = Number(s.rounds);
  const drawTime = Number(s.drawTime);
  if (rounds >= 1 && rounds <= 10) out.rounds = Math.round(rounds);
  if (drawTime >= 20 && drawTime <= 240) out.drawTime = Math.round(drawTime);
  return { ...DEFAULT_SETTINGS, ...out, revealTime: DEFAULT_SETTINGS.revealTime };
}
