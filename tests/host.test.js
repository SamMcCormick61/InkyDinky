import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Host } from '../js/host.js';
import { loopback } from '../js/net.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeRoom() {
  const fns = new Set();
  return { code: 'TESTS', onConnection: (fn) => fns.add(fn), close() {}, fns };
}

function join(host, name, isHost = false) {
  const [mine, theirs] = loopback();
  const inbox = [];
  mine.onMessage((m) => inbox.push(m));
  host.accept(theirs);
  mine.send({ t: 'hello', name, isHost });
  const last = (t) => [...inbox].reverse().find((m) => m.t === t);
  return { conn: mine, inbox, last, send: (m) => mine.send(m) };
}

test('players join, host starts, only the drawer can draw', async () => {
  const host = new Host(makeRoom());
  const sam = join(host, 'Sam', true);
  const alex = join(host, 'Alex');
  await tick();
  assert.equal(sam.last('welcome').hostId, sam.last('welcome').id);
  assert.equal(alex.last('state').state.players.length, 2);

  alex.send({ t: 'start', settings: {} }); // not the host: ignored
  await tick();
  assert.equal(host.game.phase, 'lobby');

  sam.send({ t: 'start', settings: { rounds: 1, drawTime: 60 } });
  await tick();
  assert.equal(host.game.phase, 'choosing');
  assert.ok(sam.last('state').state.choices, 'drawer sees choices');
  assert.equal(alex.last('state').state.choices, null, 'guesser does not');

  sam.send({ t: 'choose', index: 0 });
  await tick();
  assert.equal(host.game.phase, 'drawing');
  assert.equal(alex.last('state').state.word, null, 'word hidden from guesser');

  const op = { type: 'stroke', color: '#000000', size: 7, points: [[0.1, 0.1], [0.2, 0.2]] };
  alex.send({ t: 'op', op }); // not the drawer
  sam.send({ t: 'op', op });
  await tick();
  assert.equal(host.ops.length, 1);
  assert.ok(alex.inbox.some((m) => m.t === 'op'), 'guest receives the drawing');
  assert.ok(!sam.inbox.some((m) => m.t === 'op'), 'drawer is not echoed');

  alex.send({ t: 'guess', text: host.game.word });
  await tick();
  assert.equal(host.game.phase, 'reveal');
  host.close();
});

test('duplicate names are rejected and leavers are removed', async () => {
  const host = new Host(makeRoom());
  const sam = join(host, 'Sam', true);
  const dup = join(host, 'sam');
  await tick();
  assert.equal(dup.last('reject').reason, 'sam is already playing');
  const jo = join(host, 'Jo');
  await tick();
  assert.equal(host.game.players.length, 2);
  jo.conn.close();
  await tick();
  assert.equal(host.game.players.length, 1);
  assert.ok(sam.inbox.some((m) => m.t === 'note' && /Jo left/.test(m.text)));
  host.close();
});

// A stand-in for ClaudeArtist that draws two strokes straight away.
function fakeArtist({ notes = 'Water and bubbles show it lives in the sea.', fail = null } = {}) {
  const calls = [];
  return {
    calls,
    friendlyError: (err) => err.message,
    draw({ word, out }) {
      calls.push(word);
      if (fail) {
        const p = Promise.reject(new Error(fail));
        return { stop() {}, notes: p, done: p };
      }
      const stroke = { type: 'stroke', color: '#000000', size: 7, points: [[0.1, 0.1], [0.5, 0.5]] };
      out.liveStart(stroke.color, stroke.size, [stroke.points[0]]);
      out.liveAppend([stroke.points[1]]);
      out.op(stroke);
      return { stop() {}, notes: Promise.resolve(notes), done: Promise.resolve() };
    },
  };
}

test('a drawer can ask Claude to draw their word, and the clues are shared at the reveal', async () => {
  const host = new Host(makeRoom());
  const sam = join(host, 'Sam', true);
  const alex = join(host, 'Alex');
  await tick();
  const artist = fakeArtist();
  host.setArtist(artist);
  sam.send({ t: 'start', settings: { rounds: 1, drawTime: 60 } });
  await tick();
  const drawer = host.game.drawerId === sam.last('welcome').id ? sam : alex;
  const guesser = drawer === sam ? alex : sam;
  assert.equal(drawer.last('state').state.aiAvailable, true);

  drawer.send({ t: 'choose', index: 0, ai: true });
  await tick();
  assert.deepEqual(artist.calls, [host.game.word]);
  assert.equal(drawer.last('state').state.aiDrawing, true);
  assert.equal(host.ops.length, 1);
  assert.ok(drawer.inbox.some((m) => m.t === 'op'), 'the drawer sees Claude drawing too');
  assert.ok(guesser.inbox.some((m) => m.t === 'live' && m.start));

  // The drawer's own pen is ignored while Claude draws.
  drawer.send({ t: 'op', op: { type: 'clear' } });
  await tick();
  assert.equal(host.ops.length, 1);

  guesser.send({ t: 'guess', text: host.game.word });
  await tick();
  await tick();
  const note = guesser.inbox.find((m) => m.t === 'ev' && m.ev.type === 'ainote');
  assert.match(note.ev.text, /bubbles/);
  host.close();
});

test('if Claude fails, the drawer gets the pen back', async () => {
  const host2 = new Host(makeRoom());
  const a = join(host2, 'Sam', true);
  const b = join(host2, 'Alex');
  await tick();
  host2.setArtist(fakeArtist({ fail: 'no credit' }));
  a.send({ t: 'start', settings: { rounds: 1 } });
  await tick();
  const drawer = host2.game.drawerId === a.last('welcome').id ? a : b;
  drawer.send({ t: 'choose', index: 0, ai: true });
  await tick();
  await tick();
  assert.equal(drawer.last('state').state.aiDrawing, false);
  assert.ok(drawer.inbox.some((m) => m.t === 'note' && /couldn't draw this one \(no credit\)/.test(m.text)));
  drawer.send({ t: 'op', op: { type: 'clear' } });
  await tick();
  assert.equal(host2.ops.length, 1, 'the drawer can draw again');
  host2.close();
});

test('a Claude player guesses like a person, then draws on its own turn', async () => {
  const { ClaudePlayer } = await import('../js/bot.js');
  const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
  const host = new Host(makeRoom());
  try {
    const sam = join(host, 'Sam', true);
    await tick();
    const asked = [];
    const artist = {
      ...fakeArtist(),
      async guess({ avoid }) {
        asked.push([...avoid]);
        return { guess: asked.length === 1 ? 'boat' : host.game.word };
      },
    };
    host.setArtist(artist);
    const board = {
      ops: [], canvas: {},
      load(ops) { this.ops = [...ops]; }, liveStart() {}, liveAppend() {},
      remoteOp(op) { this.ops.push(op); }, remoteUndo() { this.ops.pop(); },
    };
    const bot = new ClaudePlayer({ artist, makeBoard: () => board, timing: { chooseMs: 0, firstGuessMs: 0, guessEveryMs: 0, jitterMs: 0 } });
    bot.join(host);
    await tick();
    const claude = host.game.players.find((p) => p.name === 'Claude');
    assert.equal(claude.isAI, true);

    // Sam joined first, so Sam draws first and Claude guesses.
    sam.send({ t: 'start', settings: { rounds: 1, drawTime: 60 } });
    await tick();
    sam.send({ t: 'choose', index: 0 });
    await wait();
    assert.equal(asked.length, 0, 'no guessing at an empty canvas');

    const stroke = (x) => ({ type: 'stroke', color: '#000000', size: 7, points: [[x, x], [x + 0.1, x + 0.1]] });
    sam.send({ t: 'op', op: stroke(0.1) });
    await wait();
    const chat = () => sam.inbox.filter((m) => m.t === 'ev' && m.ev.type === 'chat').map((m) => m.ev.text);
    assert.deepEqual(chat(), ['boat'], 'a wrong guess shows in the chat');

    const word = host.game.word;
    sam.send({ t: 'op', op: stroke(0.4) });
    await wait();
    assert.deepEqual(asked[1], ['boat'], 'Claude is told what it already tried');
    assert.ok(!chat().includes(word), 'the right guess is not shown');
    assert.ok(sam.inbox.some((m) => m.t === 'ev' && m.ev.type === 'correct' && m.ev.playerId === claude.id));

    // Everyone guessed, so after the reveal it's Claude's turn: it picks a word and Claude draws it.
    for (let i = 0; i < 6 && host.game.drawerId !== claude.id; i++) host.game.tick();
    assert.equal(host.game.drawerId, claude.id);
    await wait();
    assert.equal(host.game.phase, 'drawing');
    assert.deepEqual(artist.calls, [host.game.word]);
    assert.equal(sam.last('state').state.aiDrawing, true);
  } finally {
    host.close();
  }
});
