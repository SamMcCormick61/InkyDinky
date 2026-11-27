// Plays drawing ops onto the board one line at a time, at hand speed.
//
// "human" style adds a gentle wobble and varies the speed so lines look hand
// drawn; "neat" style keeps Claude's lines exactly as given.

import { WIDTH, HEIGHT } from './canvas.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Breaks a stroke into small steps so it can be drawn gradually.
function densify(points, stepPx = 4) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const len = Math.hypot((x1 - x0) * WIDTH, (y1 - y0) * HEIGHT);
    const n = Math.max(1, Math.round(len / stepPx));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

// Smooth, slowly changing wobble (a sum of two sine waves with random phase).
function wobble(points, amountPx, random = Math.random) {
  const a = random() * Math.PI * 2;
  const b = random() * Math.PI * 2;
  const fa = 0.04 + random() * 0.05;
  const fb = 0.11 + random() * 0.08;
  return points.map(([x, y], i) => {
    const dx = (Math.sin(i * fa + a) + 0.5 * Math.sin(i * fb + b)) * amountPx;
    const dy = (Math.cos(i * fa + b) + 0.5 * Math.cos(i * fb + a)) * amountPx;
    return [clamp01(x + dx / WIDTH), clamp01(y + dy / HEIGHT)];
  });
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

const round4 = (v) => Math.round(v * 10000) / 10000;

// Turns Claude's stroke into the points actually drawn.
export function shapeStroke(op, style = 'human', random = Math.random) {
  const dense = densify(op.points);
  const pts = style === 'human' ? wobble(dense, 1.6, random) : dense;
  return { ...op, points: pts.map(([x, y]) => [round4(x), round4(y)]) };
}

// Draws ops in order. `out` receives the same events a local drawer would
// produce, so the drawing can also be sent to other players:
//   out.liveStart(color, size, points) / out.liveAppend(points) / out.op(op)
export class Pen {
  constructor(board, { style = 'human', speed = 1, out = null } = {}) {
    this.board = board;
    this.style = style;
    this.speed = speed; // 1 = normal hand speed
    this.out = out;
    this.queue = [];
    this.running = null;
    this.stopped = false;
    this.done = [];
  }

  push(op) {
    if (this.stopped) return;
    this.queue.push(op);
    if (!this.running) this.running = this.run();
  }

  // Resolves once everything queued so far has been drawn.
  async finish() {
    while (this.running) await this.running;
  }

  stop() {
    this.stopped = true;
    this.queue = [];
  }

  async run() {
    while (this.queue.length && !this.stopped) {
      const op = this.queue.shift();
      if (op.type === 'stroke') await this.drawStroke(shapeStroke(op, this.style));
      else {
        await sleep(250 / this.speed);
        this.board.remoteOp(op);
        this.out?.op(op);
        this.done.push(op);
      }
      // A short pause between strokes, like lifting the pen.
      await sleep((this.style === 'human' ? 120 + Math.random() * 260 : 80) / this.speed);
    }
    this.running = null;
  }

  async drawStroke(op) {
    const pts = op.points;
    const first = [pts[0]];
    this.board.liveStart(op.color, op.size, first);
    this.out?.liveStart(op.color, op.size, first);
    // About 450 px per second, a bit quicker in the middle of a line.
    const batch = 3;
    for (let i = 1; i < pts.length && !this.stopped; i += batch) {
      const chunk = pts.slice(i, i + batch);
      this.board.liveAppend(chunk);
      this.out?.liveAppend(chunk);
      const t = i / pts.length;
      const ease = this.style === 'human' ? 0.7 + 0.6 * Math.sin(Math.PI * t) : 1;
      await sleep((batch * 4 * 1000) / (450 * ease * this.speed));
    }
    if (this.stopped) return;
    this.board.remoteOp(op);
    this.out?.op(op);
    this.done.push(op);
  }
}
