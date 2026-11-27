// Claude as a drawer and a guesser.
//
// Claude replies with simple drawing commands, one stroke per line, streamed as
// it writes them. Each finished line becomes a drawing op straight away, so the
// picture appears one line at a time, just like a person drawing.
//
//   stroke <colour> <width 1-4> x,y x,y x,y ...
//   fill <colour> x,y
//
// Coordinates are on a 100 x 75 grid (the canvas is 4:3), origin top left.
//
// Players use their own Claude API key, which stays in their browser and is
// sent only to Anthropic.

import Anthropic from './vendor/anthropic-sdk.mjs';
import { COLORS, SIZES } from './canvas.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best drawings)', input: 4, output: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)', input: 2, output: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)', input: 0.1, output: 0.5 },
];

const GRID_W = 100;
const GRID_H = 75;

export const COLOR_NAMES = {
  black: COLORS[0], gray: COLORS[1], lightgray: COLORS[2], white: COLORS[3],
  red: COLORS[4], orange: COLORS[5], yellow: COLORS[6], green: COLORS[7],
  cyan: COLORS[8], blue: COLORS[9], navy: COLORS[10], purple: COLORS[11],
  pink: COLORS[12], brown: COLORS[13], skin: COLORS[14], lightgreen: COLORS[15],
};

const DRAW_SYSTEM = `You are the drawer in a Pictionary-style party game. Other players must guess the word from your drawing, so make it instantly recognisable.

You draw with a pen on a canvas ${GRID_W} units wide and ${GRID_H} units tall. (0,0) is the top-left corner. Reply with drawing commands only, one per line, and nothing else:

stroke <colour> <width> x,y x,y x,y ...
fill <colour> x,y

- colour is one of: ${Object.keys(COLOR_NAMES).join(', ')}
- width is 1 (fine), 2 (normal), 3 (thick) or 4 (very thick)
- a stroke is one continuous pen line through its points. Use plenty of points for curves (about 12-20 for a circle) and close a shape by repeating its first point.
- fill pours paint at x,y and spreads up to the nearest lines, like a paint bucket. Only fill inside a fully closed shape, after drawing its outline.

Draw the way a person would in the game: the big recognisable outline first, then the key details, then a little colour. Use 6 to 30 strokes. Keep it simple and clear, centred, and filling most of the canvas.
Never write letters, numbers or words, and never draw the word itself as text.`;

// Extra instruction when "context clues" is on: draw the word's surroundings too.
export const CONTEXT_HINT = `Also draw the context that goes with it, to help people guess: where it is usually found, what it is used with or does, or the setting around it. For example, a fish in water with bubbles and weeds, a snowman with snowflakes and a scarf, a key next to a lock, an astronaut with a rocket and stars. Draw the word itself first and biggest, then add 2 to 4 smaller context details around it. Still no letters, numbers or words.`;

export const NO_CONTEXT_HINT = `Draw only the thing itself, with no background or extra objects.`;

const GUESS_SYSTEM = `You are a guesser in a Pictionary-style party game. Look at the drawing and reply with your single best guess: one or two lowercase words, a common noun or verb, no punctuation and nothing else.`;

export function makeClient(apiKey) {
  // Each player brings their own key, so calling Anthropic from the page is intended here.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

// ---------- parsing ----------

const clampX = (v) => Math.min(1, Math.max(0, v / GRID_W));
const clampY = (v) => Math.min(1, Math.max(0, v / GRID_H));

function parsePoint(text) {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(text);
  return m ? [clampX(Number(m[1])), clampY(Number(m[2]))] : null;
}

// Turns one line of Claude's reply into a drawing op, or null if it isn't one.
export function parseLine(line) {
  const parts = line.trim().toLowerCase().split(/\s+/);
  const color = COLOR_NAMES[parts[1]];
  if (parts[0] === 'stroke' && color) {
    const width = Math.min(4, Math.max(1, Math.round(Number(parts[2]) || 2)));
    const points = parts.slice(3).map(parsePoint).filter(Boolean);
    if (!points.length) return null;
    return { type: 'stroke', color, size: SIZES[width - 1], points };
  }
  if (parts[0] === 'fill' && color) {
    const p = parsePoint(parts[2] || '');
    return p ? { type: 'fill', color, x: p[0], y: p[1] } : null;
  }
  return null;
}

// ---------- drawing ----------

// Asks Claude to draw a word. Calls onOp(op) for each finished command as it
// streams in, and resolves with { ops, text, usage, cost, model }.
export async function drawWord({ client, model, word, context = false, onOp = () => {}, signal }) {
  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: DRAW_SYSTEM,
      messages: [{ role: 'user', content: `Draw: ${word}\n\n${context ? CONTEXT_HINT : NO_CONTEXT_HINT}` }],
    },
    { signal },
  );

  let buffer = '';
  let text = '';
  const ops = [];
  const take = (line) => {
    const op = parseLine(line);
    if (op) {
      ops.push(op);
      onOp(op);
    }
  };

  stream.on('text', (delta) => {
    text += delta;
    buffer += delta;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      take(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  });

  const message = await stream.finalMessage();
  if (buffer.trim()) take(buffer);
  if (message.stop_reason === 'refusal') {
    throw new Error("Claude declined to draw that word. Try another one.");
  }
  return { ops, text, usage: message.usage, cost: costOf(message.model || model, message.usage), model: message.model };
}

// ---------- guessing ----------

// Shows Claude the canvas and returns its guess.
export async function guessDrawing({ client, model, canvas, signal }) {
  const data = canvas.toDataURL('image/png').split(',')[1];
  const message = await client.beta.messages.create(
    {
      model,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: GUESS_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
            { type: 'text', text: 'What is this a drawing of?' },
          ],
        },
      ],
    },
    { signal },
  );
  if (message.stop_reason === 'refusal') throw new Error('Claude declined to guess this one.');
  const guess = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .split(/\s+/)
    .slice(0, 3)
    .join(' ');
  return { guess, usage: message.usage, cost: costOf(message.model || model, message.usage) };
}

export function costOf(model, usage) {
  const price = MODELS.find((m) => model && model.startsWith(m.id)) || MODELS[0];
  if (!usage) return 0;
  return ((usage.input_tokens || 0) * price.input + (usage.output_tokens || 0) * price.output) / 1e6;
}

export function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "That API key didn't work. Check it and try again.";
  if (err instanceof Anthropic.PermissionDeniedError) return "That API key isn't allowed to use this model.";
  if (err instanceof Anthropic.RateLimitError) return 'Too many requests right now. Wait a moment and try again.';
  if (err instanceof Anthropic.APIUserAbortError) return 'Stopped.';
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude error ${err.status ?? ''}: ${err.message}`;
  return err?.message || String(err);
}
