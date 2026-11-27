// InkyDinky start-up: sets up the drawing board, then opens either online
// play (the default) or pass-and-play on one device (?mode=local).

import { DrawingBoard } from './canvas.js';
import { buildToolbar, setToolbar } from './ui.js';
import { startLocal } from './local.js';
import { startOnline } from './online.js';
import { VERSION } from './version.js';

document.getElementById('version').textContent = `v${VERSION}`;

const board = new DrawingBoard(document.getElementById('canvas'));
buildToolbar(board);
setToolbar(false);

const params = new URLSearchParams(location.search);

function go(mode) {
  const url = new URL(location.href);
  url.search = '';
  if (mode) url.searchParams.set('mode', mode);
  if (params.get('net')) url.searchParams.set('net', params.get('net'));
  location.href = url.href;
}

const app = params.get('mode') === 'local'
  ? startLocal(board, { onExit: () => go(null) })
  : startOnline(board, { onLocal: () => go('local') });

// Handy for testing in the browser console.
window.inky = { app, board };
