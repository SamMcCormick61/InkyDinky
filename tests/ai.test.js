import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, COLOR_NAMES } from '../js/ai.js';
import { shapeStroke } from '../js/pen.js';

test('parses stroke and fill commands on the 100 x 75 grid', () => {
  const s = parseLine('stroke red 3 0,0 50,37.5 100,75');
  assert.equal(s.type, 'stroke');
  assert.equal(s.color, COLOR_NAMES.red);
  assert.equal(s.size, 14);
  assert.deepEqual(s.points, [[0, 0], [0.5, 0.5], [1, 1]]);
  assert.deepEqual(parseLine('FILL Yellow 50,30'), { type: 'fill', color: COLOR_NAMES.yellow, x: 0.5, y: 0.4 });
});

test('ignores chatter and bad commands, clamps out-of-range points', () => {
  assert.equal(parseLine('Here is my drawing:'), null);
  assert.equal(parseLine('stroke rainbow 2 1,1 2,2'), null);
  assert.equal(parseLine('stroke black 2'), null);
  assert.deepEqual(parseLine('stroke black 9 -5,200').points, [[0, 1]]);
  assert.equal(parseLine('stroke black 9 1,1').size, 28);
});

test('human style wobbles but stays close; neat style keeps the line', () => {
  const op = { type: 'stroke', color: '#000000', size: 7, points: [[0.1, 0.5], [0.9, 0.5]] };
  const neat = shapeStroke(op, 'neat');
  assert.ok(neat.points.length > 100, 'line is broken into small steps');
  assert.ok(neat.points.every(([, y]) => y === 0.5));
  const human = shapeStroke(op, 'human');
  const maxOff = Math.max(...human.points.map(([, y]) => Math.abs(y - 0.5) * 600));
  assert.ok(maxOff > 0.2 && maxOff < 4, `wobble ${maxOff}px`);
});

test('context clues setting changes the request', async () => {
  const { drawWord } = await import('../js/ai.js');
  const sent = [];
  const fake = { beta: { messages: { stream: (body) => {
    sent.push(body.messages[0].content);
    return { on() {}, finalMessage: async () => ({ stop_reason: 'end_turn', content: [], usage: {} }) };
  } } } };
  await drawWord({ client: fake, model: 'claude-haiku-5-5', word: 'fish', context: true });
  await drawWord({ client: fake, model: 'claude-haiku-5-5', word: 'fish' });
  assert.match(sent[0], /^Draw: fish\n\nAlso draw the context/);
  assert.match(sent[1], /^Draw: fish\n\nDraw only the thing itself/);
});

test('reads Claude\'s note line separately from drawing commands', async () => {
  const { parseNote, drawWord } = await import('../js/ai.js');
  assert.equal(parseNote('note The bubbles and weeds show it lives underwater.'), 'The bubbles and weeds show it lives underwater.');
  assert.equal(parseNote('Note: Snowflakes mean winter.'), 'Snowflakes mean winter.');
  assert.equal(parseNote('stroke black 2 1,1 2,2'), null);
  let onText;
  const fake = { beta: { messages: { stream: () => ({
    on(ev, fn) { if (ev === 'text') onText = fn; },
    finalMessage: async () => {
      onText('stroke blue 2 10,10 20,20\nnote Water and bubbles show where fish live.');
      return { stop_reason: 'end_turn', content: [], usage: {} };
    },
  }) } } };
  const drawn = [];
  const r = await drawWord({ client: fake, model: 'claude-haiku-5-5', word: 'fish', context: true, onOp: (op) => drawn.push(op) });
  assert.equal(drawn.length, 1, 'the note is not drawn');
  assert.equal(r.notes, 'Water and bubbles show where fish live.');
});
