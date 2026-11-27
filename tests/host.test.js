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
