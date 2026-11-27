import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, normalise, levenshtein } from '../js/game.js';

const WORDS = ['cat', 'dog', 'house', 'ice cream', 'rocket', 'banana'];

function setup(names = ['Ann', 'Ben', 'Cal'], settings = {}) {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const game = new Game({ words: WORDS, settings: { drawTime: 60, ...settings }, random });
  const events = [];
  game.on((e) => events.push(e));
  const players = names.map((n) => game.addPlayer(n));
  return { game, players, events };
}

test('normalise and levenshtein', () => {
  assert.equal(normalise('  Ice   CREAM! '), 'ice cream');
  assert.equal(normalise('Café'), 'cafe');
  assert.equal(levenshtein('house', 'horse'), 1);
  assert.equal(levenshtein('cat', 'cat'), 0);
});

test('needs two players and unique names', () => {
  const game = new Game({ words: WORDS });
  game.addPlayer('Ann');
  assert.throws(() => game.start(), /2 players/);
  assert.throws(() => game.addPlayer('ann'), /already/);
});

test('turn flow: choose, guess, score, reveal', () => {
  const { game, players, events } = setup();
  game.start();
  assert.equal(game.phase, 'choosing');
  assert.equal(game.drawerId, players[0].id);
  assert.equal(game.choices.length, 3);

  game.chooseWord(0);
  const word = game.word;
  assert.equal(game.phase, 'drawing');
  assert.match(game.hint(), /^[_ ]+$/);

  assert.equal(game.guess(players[1].id, 'nope').kind, 'wrong');
  const r = game.guess(players[1].id, word.toUpperCase());
  assert.equal(r.kind, 'correct');
  assert.equal(r.points, 300);
  assert.equal(game.phase, 'drawing', 'one guesser left');

  game.tick();
  game.guess(players[2].id, word);
  assert.equal(game.phase, 'reveal');
  assert.ok(players[0].score > 0, 'drawer earns points');
  assert.ok(events.some((e) => e.type === 'reveal' && e.reason === 'all-guessed'));
});

test('drawer and players who know cannot leak the word', () => {
  const { game, players } = setup();
  game.start();
  game.chooseWord(0);
  assert.equal(game.guess(players[0].id, `it is ${game.word}`).kind, 'hidden');
  game.guess(players[1].id, game.word);
  assert.equal(game.guess(players[1].id, game.word).kind, 'hidden');
});

test('close guesses are flagged', () => {
  const { game, players } = setup();
  game.start();
  game.choices = ['house'];
  game.chooseWord(0);
  assert.equal(game.guess(players[1].id, 'horse').kind, 'close');
});

test('time running out ends the turn and hints reveal letters', () => {
  const { game } = setup(['Ann', 'Ben'], { drawTime: 12 });
  game.start();
  game.choices = ['banana'];
  game.chooseWord(0);
  for (let i = 0; i < 9; i++) game.tick();
  assert.equal(game.hint().replace(/_/g, '').length, 2, 'two letters shown at 75%');
  for (let i = 0; i < 3; i++) game.tick();
  assert.equal(game.phase, 'reveal');
});

test('everyone draws once per round and the game ends', () => {
  const { game, players, events } = setup(['Ann', 'Ben'], { rounds: 2, revealTime: 1 });
  game.start();
  const drawers = [];
  while (game.phase !== 'gameover') {
    drawers.push(game.drawerId);
    game.chooseWord(0);
    game.endTurn('time');
    game.tick();
  }
  assert.deepEqual(drawers, [players[0].id, players[1].id, players[0].id, players[1].id]);
  assert.ok(events.some((e) => e.type === 'gameover'));
});

test('snapshot hides the word from guessers', () => {
  const { game, players } = setup();
  game.start();
  game.chooseWord(0);
  assert.equal(game.snapshot(players[1].id).word, null);
  assert.equal(game.snapshot(players[0].id).word, game.word);
});

test('drawer leaving ends their turn', () => {
  const { game, players } = setup();
  game.start();
  game.chooseWord(0);
  game.removePlayer(players[0].id);
  assert.equal(game.phase, 'reveal');
  game.timeLeft = 1;
  game.tick();
  assert.equal(game.drawerId, players[1].id);
});
