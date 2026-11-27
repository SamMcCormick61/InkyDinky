// InkyDinky online play: host a room or join one with a code or link.
//
// Every player's page (the host's too) works the same way: it sends requests
// to the host and draws whatever state the host sends back.

import { hostRoom, joinRoom, loopback, cleanCode } from './net.js';
import { Host } from './host.js';
import { VERSION } from './version.js';
import { DrawingBoard } from './canvas.js';
import {
  $, showScreen, setHint, setTimer, setRound, renderPlayers, clearChat, addChat, addLine,
  renderReveal, renderRanking, renderChoices, setToolbar, load, save, loadKey, saveKey,
} from './ui.js';

export function startOnline(board, { onLocal }) {
  let conn = null;
  let host = null;      // only set in the host's browser
  let me = null;        // my player id
  let hostId = null;
  let code = null;
  let state = null;
  let phaseShown = null;
  let leaving = false;

  document.body.classList.add('mode-online');
  const params = new URLSearchParams(location.search);

  // ---------- start screen ----------

  $('my-name').value = load('name', '');
  const linkCode = cleanCode(params.get('room'));
  if (linkCode) $('join-code').value = linkCode;

  setHint(linkCode ? `You're invited to room ${linkCode}` : 'Welcome to InkyDinky!', true);
  renderPlayers([]);
  setGuessing(false);
  setToolbar(false);
  showScreen('home');
  (linkCode && !$('my-name').value ? $('my-name') : linkCode ? $('join-code') : $('my-name')).focus();

  function myName() {
    const name = $('my-name').value.trim().slice(0, 20);
    if (!name) {
      $('home-error').textContent = 'Type your name first.';
      $('my-name').focus();
      return null;
    }
    save('name', name);
    return name;
  }

  function busy(on, text = '') {
    for (const id of ['host-btn', 'local-btn']) $(id).disabled = on;
    $('join-form').querySelector('button').disabled = on;
    $('home-error').textContent = text;
    $('home-error').classList.toggle('muted', on);
  }

  $('host-btn').addEventListener('click', async () => {
    const name = myName();
    if (!name) return;
    busy(true, 'Creating a room…');
    try {
      const room = await hostRoom();
      host = new Host(room);
      code = room.code;
      const [mine, hostSide] = loopback();
      host.accept(hostSide);
      connect(mine, name, true);
      history.replaceState(null, '', roomUrl(code));
    } catch (err) {
      busy(false, err.message);
    }
  });

  $('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = myName();
    if (!name) return;
    const c = cleanCode($('join-code').value);
    if (c.length !== 5) {
      $('home-error').textContent = 'Room codes are 5 letters.';
      $('join-code').focus();
      return;
    }
    busy(true, 'Joining…');
    try {
      code = c;
      connect(await joinRoom(c, (text) => busy(true, text)), name, false);
    } catch (err) {
      busy(false, err.message);
    }
  });

  $('local-btn').addEventListener('click', onLocal);

  function roomUrl(c) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', c);
    if (params.get('net')) url.searchParams.set('net', params.get('net'));
    return url.href;
  }

  // ---------- connection ----------

  function connect(c, name, isHost) {
    conn = c;
    conn.onMessage(onMessage);
    conn.onClose(() => {
      if (leaving) return;
      board.setEnabled(false);
      setToolbar(false);
      setGuessing(false);
      $('timer').hidden = true;
      message(host ? 'Room closed' : 'Disconnected', host ? 'The room has closed.' : 'Lost the connection to the host. They may have closed the game.', true);
    });
    conn.send({ t: 'hello', name, isHost });
  }

  function send(msg) {
    conn?.send(msg);
  }

  function message(title, text, withButton = false) {
    $('msg-title').textContent = title;
    $('msg-text').textContent = text;
    $('msg-btn').hidden = !withButton;
    showScreen('message');
  }

  $('msg-btn').addEventListener('click', () => {
    leaving = true;
    const url = new URL(roomUrl(code || ''));
    url.searchParams.delete('room');
    location.href = url.href;
  });

  // Warn the host before closing the tab, because that ends the game for everyone.
  addEventListener('beforeunload', (e) => {
    if (host && host.clients.size > 1 && !leaving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- messages from the host ----------

  function onMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        me = msg.id;
        hostId = msg.hostId;
        code = msg.code;
        clearChat();
        addLine(host ? `Room ${code} is open. Share the link to invite friends.` : `You joined room ${code}.`);
        if (msg.version && msg.version !== VERSION) {
          addLine(`The host has version ${msg.version} and you have ${VERSION}. If anything looks odd, both of you should refresh the page.`, 'close');
        }
        break;
      case 'reject':
        busy(false, msg.reason);
        leaving = true;
        conn.close();
        conn = null;
        break;
      case 'state':
        state = msg.state;
        hostId = state.hostId;
        render();
        break;
      case 'note':
        addLine(msg.text);
        break;
      case 'board':
        board.load(msg.ops || []);
        break;
      case 'live':
        if (msg.start) board.liveStart(msg.color, msg.size, msg.points);
        else board.liveAppend(msg.points);
        break;
      case 'op':
        board.remoteOp(msg.op);
        break;
      case 'undo':
        board.remoteUndo();
        break;
      case 'ev':
        onEvent(msg.ev);
        break;
    }
  }

  function nameOf(id) {
    return state?.players.find((p) => p.id === id)?.name ?? 'Someone';
  }

  function onEvent(ev) {
    switch (ev.type) {
      case 'start':
        clearChat();
        addLine('Game on!');
        break;
      case 'turn':
        addLine(ev.drawerId === me ? "You're drawing next." : `${nameOf(ev.drawerId)} is drawing next.`);
        break;
      case 'chat':
        addChat(nameOf(ev.playerId), ev.text);
        break;
      case 'close':
        addLine(`“${ev.text}” is close!`, 'close');
        break;
      case 'correct':
        addLine(ev.playerId === me ? `You got it! +${ev.points}` : `${nameOf(ev.playerId)} guessed it!`, 'good');
        break;
      case 'ainote':
        addLine(`💡 Claude's clues: ${ev.text}`);
        $('reveal-note').textContent = `💡 Claude's clues: ${ev.text}`;
        $('reveal-note').hidden = false;
        break;
      case 'reveal':
        $('reveal-note').hidden = true;
        if (ev.word) addLine(`The word was “${ev.word}”.`);
        renderReveal({ word: ev.word, reason: ev.reason, points: ev.points, players: state?.players ?? [] });
        break;
      case 'gameover':
        renderRanking(ev.ranking);
        if (artist?.spent > 0) {
          addLine(`🤖 Claude's drawings used about $${artist.spent.toFixed(2)} of your API credit this game.`);
          artist.spent = 0;
        }
        break;
    }
  }

  // ---------- drawing out ----------

  board.on((ev) => {
    if (!state || state.drawerId !== me || state.phase !== 'drawing' || state.aiDrawing) return;
    if (ev.type === 'live') send({ t: 'live', start: ev.start, color: ev.color, size: ev.size, points: ev.points });
    else if (ev.type === 'op') send({ t: 'op', op: ev.op });
    else if (ev.type === 'undo') send({ t: 'undo' });
  });

  // ---------- render from state ----------

  function render() {
    const s = state;
    const amHost = me && me === hostId;
    const drawing = s.drawerId === me;
    renderPlayers(s.players, {
      drawerId: s.phase === 'gameover' || s.phase === 'lobby' ? null : s.drawerId,
      guessed: s.players.filter((p) => p.guessed).map((p) => p.id),
      youId: me,
      hostId,
    });

    if (s.phase === 'lobby') setRound(0);
    else setRound(s.round, s.rounds);

    const canDraw = s.phase === 'drawing' && drawing && !s.aiDrawing;
    if (board.enabled !== canDraw) board.setEnabled(canDraw);
    setToolbar(canDraw);

    if (s.phase === 'drawing' || s.phase === 'reveal') setTimer(s.timeLeft, s.phase === 'drawing' && s.timeLeft <= 10);
    else $('timer').hidden = true;

    const meGuessed = s.players.find((p) => p.id === me)?.guessed;
    if (s.phase === 'drawing') {
      if (drawing) setHint(s.aiDrawing ? `🤖 Claude is drawing: ${s.word}` : `Draw: ${s.word}`, true);
      else if (meGuessed) setHint(s.word, true);
      else setHint(s.hint);
    }
    setGuessing(s.phase !== 'lobby', s.phase === 'drawing' && !drawing && !meGuessed);

    // Only switch overlays when the phase changes, so typing isn't interrupted.
    const key = `${s.phase}:${s.drawerId}:${s.round}`;
    if (key === phaseShown && s.phase !== 'lobby') {
      if (s.phase === 'reveal') $('reveal-count').textContent = Math.max(0, s.timeLeft);
      return;
    }
    phaseShown = key;

    switch (s.phase) {
      case 'lobby':
        showLobby(amHost, s);
        break;
      case 'choosing':
        if (drawing && s.choices) {
          setHint("It's your turn to draw!", true);
          $('ai-choose-wrap').hidden = !s.aiAvailable;
          renderChoices(s.choices, (i) => send({ t: 'choose', index: i, ai: Boolean(s.aiAvailable && $('ai-choose').checked) }));
          showScreen('choose');
        } else {
          setHint(`${nameOf(s.drawerId)} is choosing a word…`, true);
          message(`${nameOf(s.drawerId)} is choosing a word`, 'Get ready to guess!');
        }
        break;
      case 'drawing':
        showScreen(null);
        if (!drawing) $('guess').focus();
        break;
      case 'reveal':
        setHint(s.word || '', true);
        $('reveal-count').textContent = Math.max(0, s.timeLeft);
        setTimeout(() => state.phase === 'reveal' && showScreen('reveal'), 600);
        break;
      case 'gameover':
        setHint('Game over!', true);
        $('again').hidden = !amHost;
        $('new-players').hidden = true;
        $('gameover-wait').hidden = amHost;
        showScreen('gameover');
        break;
    }
  }

  function showLobby(amHost, s) {
    setHint(`Room ${code}`, true);
    $('room-code').textContent = code;
    $('room-link').value = roomUrl(code);
    $('host-controls').hidden = !amHost;
    if (amHost && $('ai-box').open) loadArtistLib();
    $('guest-wait').hidden = amHost;
    const enough = s.players.length >= 2;
    $('start-online').disabled = !enough;
    $('start-online').textContent = enough ? `Start game with ${s.players.length}` : 'Waiting for players to join…';
    showScreen('online-lobby');
  }

  $('copy-link').addEventListener('click', async () => {
    const link = $('room-link').value;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'InkyDinky', text: `Join my InkyDinky game! Room ${code}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      $('copy-link').textContent = 'Copied!';
    } catch {
      $('room-link').select();
      $('copy-link').textContent = 'Press Ctrl+C';
    }
    setTimeout(() => ($('copy-link').textContent = 'Copy link'), 2000);
  });

  $('start-online').addEventListener('click', () => {
    send({ t: 'start', settings: { rounds: $('online-rounds').value, drawTime: $('online-time').value } });
  });
  $('again').addEventListener('click', () => {
    send({ t: 'start', settings: { rounds: $('online-rounds').value, drawTime: $('online-time').value } });
  });

  // ---------- Claude drawing for players (set up by the host) ----------
  //
  // Claude isn't a player. The host turns it on with their own API key, and
  // then any drawer can pick "Let Claude draw it". Claude runs in the host's
  // browser, so the key never leaves it except to go to Anthropic.

  let artist = null;
  let artistLib = null;
  let player = null; // Claude playing as a player (bot.js)
  const stored = loadKey();
  $('ai-key').value = stored.key;
  $('ai-remember').checked = stored.remembered;

  function loadArtistLib() {
    if (!artistLib) {
      artistLib = Promise.all([import('./artist.js'), import('./ai.js')]).then(([lib, ai]) => {
        const saved = { ...lib.DEFAULT_ARTIST_SETTINGS, ...load('artistSettings', {}) };
        for (const m of ai.MODELS) $('ai-model').append(new Option(m.label, m.id));
        for (const [id, sp] of Object.entries(lib.SPEEDS)) $('ai-speed').append(new Option(sp.label, id));
        $('ai-model').value = ai.MODELS.some((m) => m.id === saved.model) ? saved.model : lib.DEFAULT_ARTIST_SETTINGS.model;
        $('ai-speed').value = lib.SPEEDS[saved.speed] ? saved.speed : lib.DEFAULT_ARTIST_SETTINGS.speed;
        $('ai-style').value = saved.style === 'neat' ? 'neat' : 'human';
        $('ai-context').value = saved.context ? 'on' : 'off';
        return lib;
      });
      artistLib.catch((err) => {
        artistLib = null;
        $('ai-error').textContent = `Couldn't load Claude: ${err.message}`;
      });
    }
    return artistLib;
  }

  function artistSettings() {
    return {
      model: $('ai-model').value,
      speed: $('ai-speed').value,
      style: $('ai-style').value,
      context: $('ai-context').value === 'on',
    };
  }

  function showArtist() {
    $('ai-player').hidden = !artist;
    $('ai-player-note').hidden = !artist;
    $('ai-player').textContent = player ? 'Remove Claude player' : 'Add Claude as a player';
    $('ai-add').textContent = artist ? 'Turn Claude off' : 'Turn Claude on';
    $('ai-add').classList.toggle('ghost', Boolean(artist));
    $('ai-summary').textContent = artist ? '🤖 Claude AI is on ✓' : '🤖 Claude AI: draw for players or join as a player';
  }

  $('ai-box').addEventListener('toggle', () => $('ai-box').open && loadArtistLib());
  for (const id of ['ai-model', 'ai-speed', 'ai-style', 'ai-context']) {
    $(id).addEventListener('change', () => {
      const settings = artistSettings();
      save('artistSettings', settings);
      artist?.update(settings);
    });
  }
  const keyChanged = () => {
    const key = $('ai-key').value.trim();
    saveKey(key, $('ai-remember').checked);
    if (key) artist?.setKey(key);
  };
  $('ai-key').addEventListener('change', keyChanged);
  $('ai-remember').addEventListener('change', keyChanged);

  $('ai-add').addEventListener('click', async () => {
    $('ai-error').textContent = '';
    if (artist) {
      player?.leave();
      player = null;
      artist = null;
      host?.setArtist(null);
      showArtist();
      return;
    }
    const key = $('ai-key').value.trim();
    if (!key) {
      $('ai-error').textContent = 'Paste your Claude API key first.';
      $('ai-key').focus();
      return;
    }
    if (!host) return;
    keyChanged();
    const lib = await loadArtistLib();
    artist = new lib.ClaudeArtist({ apiKey: key, settings: artistSettings() });
    host.setArtist(artist);
    showArtist();
  });

  $('ai-player').addEventListener('click', async () => {
    $('ai-error').textContent = '';
    if (player) {
      player.leave();
      player = null;
      showArtist();
      return;
    }
    if (!artist || !host) return;
    const { ClaudePlayer } = await import('./bot.js');
    const p = new ClaudePlayer({
      artist,
      makeBoard: () => new DrawingBoard(document.createElement('canvas')),
      onStatus: (text, isError) => {
        if (p.rejected) {
          if (player === p) player = null;
          showArtist();
          $('ai-error').textContent = text;
          return;
        }
        addLine(`🤖 ${text}`, isError ? 'close' : 'sys');
      },
    });
    player = p;
    p.join(host);
    showArtist();
  });

  // ---------- guessing ----------

  function setGuessing(enabled, guessing = false) {
    $('guess').disabled = !enabled;
    $('guess-form').classList.toggle('disabled', !enabled);
    $('guess').placeholder = guessing ? 'Type your guess…' : 'Chat…';
  }

  $('guess-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('guess');
    const text = input.value.trim();
    if (!text) return;
    send({ t: 'guess', text });
    input.value = '';
    input.focus();
  });

  return {
    get state() { return state; },
    get me() { return me; },
    get host() { return host; },
  };
}
