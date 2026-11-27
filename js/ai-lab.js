// AI Lab: try Claude as a drawer and a guesser, outside a real game.

import { DrawingBoard } from './canvas.js';
import { buildToolbar, setToolbar, load, save } from './ui.js';
import { WORDS } from './words.js';
import { VERSION } from './version.js';
import { MODELS, makeClient, drawWord, guessDrawing, friendlyError } from './ai.js';
import { Pen } from './pen.js';

const $ = (id) => document.getElementById(id);
$('version').textContent = `v${VERSION}`;

const board = new DrawingBoard($('canvas'));
buildToolbar(board);
board.setEnabled(true);
setToolbar(true);

// ---------- settings ----------

for (const m of MODELS) {
  const o = document.createElement('option');
  o.value = m.id;
  o.textContent = m.label;
  $('model').append(o);
}
$('model').value = load('aiModel', MODELS[0].id);
$('model').addEventListener('change', () => save('aiModel', $('model').value));

let keyInSession = '';
try {
  keyInSession = sessionStorage.getItem('inkydinky.key') || '';
} catch { /* ignore */ }
const savedKey = load('apiKey', '');
$('api-key').value = savedKey || keyInSession;
$('remember').checked = Boolean(savedKey);

function rememberKey() {
  const key = $('api-key').value.trim();
  try {
    sessionStorage.setItem('inkydinky.key', key);
  } catch { /* ignore */ }
  if ($('remember').checked) save('apiKey', key);
  else save('apiKey', '');
}
$('api-key').addEventListener('change', rememberKey);
$('remember').addEventListener('change', rememberKey);

let style = load('aiStyle', 'human');
document.querySelectorAll('[data-style]').forEach((b) => {
  b.classList.toggle('on', b.dataset.style === style);
  b.addEventListener('click', () => {
    style = b.dataset.style;
    save('aiStyle', style);
    document.querySelectorAll('[data-style]').forEach((x) => x.classList.toggle('on', x === b));
  });
});

let context = load('aiContext', false);
document.querySelectorAll('[data-context]').forEach((b) => {
  b.classList.toggle('on', (b.dataset.context === 'on') === context);
  b.addEventListener('click', () => {
    context = b.dataset.context === 'on';
    save('aiContext', context);
    document.querySelectorAll('[data-context]').forEach((x) => x.classList.toggle('on', x === b));
  });
});

$('random-word').addEventListener('click', () => {
  $('word').value = WORDS[Math.floor(Math.random() * WORDS.length)];
});

// ---------- status ----------

let totalCost = 0;
function status(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('err', isError);
}
function addCost(cost, label) {
  totalCost += cost;
  $('stats').textContent = `${label}: about $${cost.toFixed(4)} · this session: about $${totalCost.toFixed(4)}`;
}

function client() {
  const key = $('api-key').value.trim();
  if (!key) {
    status('Paste your Claude API key first.', true);
    $('api-key').focus();
    return null;
  }
  rememberKey();
  return makeClient(key);
}

// ---------- drawing ----------

let controller = null;
let pen = null;

$('draw').addEventListener('click', async () => {
  const c = client();
  if (!c) return;
  if (!$('word').value.trim()) $('random-word').click();
  const word = $('word').value.trim();

  controller = new AbortController();
  board.reset();
  board.setEnabled(false);
  setToolbar(false);
  $('guess-out').textContent = '';
  $('raw').textContent = '';
  $('notes').hidden = true;
  $('draw').disabled = true;
  $('stop').disabled = false;
  $('hint').textContent = `Claude is drawing: ${word}`;
  status('Claude is thinking…');

  pen = new Pen(board, { style, speed: Number($('speed').value) });
  const started = performance.now();
  let first = true;
  try {
    const result = await drawWord({
      client: c,
      model: $('model').value,
      word,
      context,
      signal: controller.signal,
      onOp: (op) => {
        if (first) {
          first = false;
          status(`Drawing… (first line after ${((performance.now() - started) / 1000).toFixed(1)}s)`);
        }
        pen.push(op);
      },
    });
    $('raw').textContent = result.text;
    if (!result.ops.length) throw new Error("Claude didn't send any drawing commands. Try again.");
    await pen.finish();
    // The explanation is only shown once the drawing is finished, like the end of a turn.
    if (result.notes) {
      $('notes-text').textContent = result.notes;
      $('notes').hidden = false;
    }
    $('hint').textContent = `Claude drew: ${word}`;
    status(`Done: ${result.ops.length} lines in ${((performance.now() - started) / 1000).toFixed(1)}s.`);
    addCost(result.cost, 'This drawing');
  } catch (err) {
    pen?.stop();
    status(friendlyError(err), true);
  } finally {
    controller = null;
    $('draw').disabled = false;
    $('stop').disabled = true;
    board.setEnabled(true);
    setToolbar(true);
  }
});

$('stop').addEventListener('click', () => {
  controller?.abort();
  pen?.stop();
});

// ---------- guessing ----------

$('guess').addEventListener('click', async () => {
  const c = client();
  if (!c) return;
  if (!board.ops.length) {
    status('Draw something first, or let Claude draw.', true);
    return;
  }
  $('guess').disabled = true;
  $('guess-out').textContent = '🤔';
  try {
    const { guess, cost } = await guessDrawing({ client: c, model: $('model').value, canvas: $('canvas') });
    const word = $('word').value.trim().toLowerCase();
    const right = word && guess === word;
    $('guess-out').textContent = guess ? `“${guess}”${right ? ' ✓' : ''}` : '…no idea!';
    addCost(cost, 'This guess');
  } catch (err) {
    $('guess-out').textContent = '';
    status(friendlyError(err), true);
  } finally {
    $('guess').disabled = false;
  }
});

window.inkyLab = { board };
