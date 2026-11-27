// InkyDinky drawing board.
//
// Every drawing action is stored as a small "op" with coordinates from 0 to 1,
// so a drawing can be replayed at any size, sent over the network, or
// produced by an AI one line at a time.
//
//   { type: 'stroke', color, size, points: [[x, y], ...] }
//   { type: 'fill', color, x, y }
//   { type: 'clear' }

export const WIDTH = 800;
export const HEIGHT = 600;
export const BACKGROUND = '#ffffff';

export const COLORS = [
  '#000000', '#555555', '#9e9e9e', '#ffffff',
  '#e53935', '#fb8c00', '#fdd835', '#43a047',
  '#00acc1', '#1e88e5', '#3949ab', '#8e24aa',
  '#d81b60', '#6d4c41', '#ffccbc', '#a5d6a7',
];

export const SIZES = [3, 7, 14, 28];

export class DrawingBoard {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.ops = [];
    this.current = null;
    this.enabled = false;
    this.tool = 'pen'; // pen | eraser | fill
    this.color = COLORS[0];
    this.size = SIZES[1];
    this.listeners = new Set();
    this.redraw();
    this.bindPointer();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) fn(event);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.canvas.classList.toggle('can-draw', enabled);
    if (!enabled) this.current = null;
  }

  // ----- pointer input -----

  bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      const [x, y] = this.toLocal(e).map(round4);
      if (this.tool === 'fill') {
        this.addOp({ type: 'fill', color: this.color, x, y });
        return;
      }
      c.setPointerCapture(e.pointerId);
      this.current = {
        type: 'stroke',
        color: this.tool === 'eraser' ? BACKGROUND : this.color,
        size: this.size,
        points: [[x, y]],
      };
      this.drawDot(this.current);
      this.pending = [];
      this.emit({ type: 'live', start: true, color: this.current.color, size: this.current.size, points: [[x, y]] });
      clearInterval(this.flushTimer);
      this.flushTimer = setInterval(() => this.flushLive(), 50);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.current) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const p = this.toLocal(ev).map(round4);
        const pts = this.current.points;
        const last = pts[pts.length - 1];
        if (Math.hypot((p[0] - last[0]) * WIDTH, (p[1] - last[1]) * HEIGHT) < 1.5) continue;
        pts.push(p);
        this.pending.push(p);
        this.drawSegment(this.current, pts.length - 1);
      }
    });
    const finish = () => {
      if (!this.current) return;
      this.flushLive();
      clearInterval(this.flushTimer);
      const stroke = this.current;
      this.current = null;
      this.ops.push(stroke);
      this.emit({ type: 'op', op: stroke });
    };
    c.addEventListener('pointerup', finish);
    c.addEventListener('pointercancel', finish);
    c.addEventListener('lostpointercapture', finish);
  }

  // Send stroke points to other players in small batches while drawing.
  flushLive() {
    if (!this.pending || !this.pending.length) return;
    this.emit({ type: 'live', points: this.pending });
    this.pending = [];
  }

  // ----- drawing coming from someone else -----

  liveStart(color, size, points) {
    this.remote = { type: 'stroke', color, size, points: [...points] };
    this.drawDot(this.remote);
  }

  liveAppend(points) {
    if (!this.remote) return;
    for (const p of points) {
      this.remote.points.push(p);
      this.drawSegment(this.remote, this.remote.points.length - 1);
    }
  }

  // A finished op from the drawer. Strokes were already drawn live; if any
  // live points went missing, repaint so everyone ends up with the same picture.
  remoteOp(op) {
    const live = this.remote;
    this.remote = null;
    this.ops.push(op);
    if (op.type !== 'stroke' || !live) this.applyOp(op);
    else if (live.points.length !== op.points.length) this.redraw();
  }

  remoteUndo() {
    this.remote = null;
    this.ops.pop();
    this.redraw();
  }

  toLocal(e) {
    const r = this.canvas.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  }

  // ----- ops -----

  addOp(op) {
    this.ops.push(op);
    this.applyOp(op);
    this.emit({ type: 'op', op });
  }

  undo() {
    // Undo the last stroke or fill; a clear can be undone too.
    if (!this.ops.length) return;
    const op = this.ops.pop();
    this.redraw();
    this.emit({ type: 'undo', op });
  }

  clear() {
    if (!this.ops.length || this.ops[this.ops.length - 1].type === 'clear') return;
    this.addOp({ type: 'clear' });
  }

  reset() {
    this.ops = [];
    this.current = null;
    this.remote = null;
    clearInterval(this.flushTimer);
    this.redraw();
    this.emit({ type: 'reset' });
  }

  load(ops) {
    this.ops = [...ops];
    this.redraw();
  }

  redraw() {
    const { ctx } = this;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const op of this.ops) this.applyOp(op);
  }

  applyOp(op) {
    if (op.type === 'clear') {
      this.ctx.fillStyle = BACKGROUND;
      this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
    } else if (op.type === 'fill') {
      floodFill(this.ctx, Math.min(WIDTH - 1, Math.floor(op.x * WIDTH)), Math.min(HEIGHT - 1, Math.floor(op.y * HEIGHT)), op.color);
    } else if (op.type === 'stroke') {
      this.drawDot(op);
      for (let i = 1; i < op.points.length; i++) this.drawSegment(op, i);
    }
  }

  // ----- painting -----

  drawDot(stroke) {
    const [x, y] = stroke.points[0];
    const { ctx } = this;
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(x * WIDTH, y * HEIGHT, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draws the piece of the stroke ending at point i, smoothed through midpoints.
  drawSegment(stroke, i) {
    const pts = stroke.points;
    const { ctx } = this;
    const p = (k) => [pts[k][0] * WIDTH, pts[k][1] * HEIGHT];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const cur = p(i);
    const prev = p(i - 1);
    const start = i >= 2 ? mid(p(i - 2), prev) : prev;
    const end = mid(prev, cur);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.quadraticCurveTo(prev[0], prev[1], end[0], end[1]);
    ctx.lineTo(cur[0], cur[1]);
    ctx.stroke();
  }
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function hexToRgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

// Scanline flood fill with a small tolerance so anti-aliased edges fill cleanly.
export function floodFill(ctx, x, y, hex) {
  const image = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  const data = image.data;
  const fill = hexToRgba(hex);
  const start = (y * WIDTH + x) * 4;
  const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  const tolerance = 48;
  const same = (i) =>
    Math.abs(data[i] - target[0]) + Math.abs(data[i + 1] - target[1]) +
    Math.abs(data[i + 2] - target[2]) + Math.abs(data[i + 3] - target[3]) <= tolerance;
  if (target.every((v, k) => Math.abs(v - fill[k]) < 4)) return;

  const seen = new Uint8Array(WIDTH * HEIGHT);
  const stack = [[x, y]];
  while (stack.length) {
    const [sx, sy] = stack.pop();
    let lx = sx;
    while (lx > 0 && !seen[sy * WIDTH + lx - 1] && same((sy * WIDTH + lx - 1) * 4)) lx--;
    let up = false;
    let down = false;
    for (let cx = lx; cx < WIDTH; cx++) {
      const idx = sy * WIDTH + cx;
      if (seen[idx] || !same(idx * 4)) break;
      seen[idx] = 1;
      data.set(fill, idx * 4);
      if (sy > 0) {
        const u = idx - WIDTH;
        const ok = !seen[u] && same(u * 4);
        if (ok && !up) stack.push([cx, sy - 1]);
        up = ok;
      }
      if (sy < HEIGHT - 1) {
        const d = idx + WIDTH;
        const ok = !seen[d] && same(d * 4);
        if (ok && !down) stack.push([cx, sy + 1]);
        down = ok;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}
