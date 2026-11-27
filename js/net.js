// Network connections for online rooms.
//
// Every connection looks the same to the rest of the game:
//   conn.send(message)   conn.onMessage(fn)   conn.onClose(fn)   conn.close()
//
// Real games use PeerJS (WebRTC, browser to browser). The host's browser
// registers the room code with the free PeerJS matchmaking server and players
// connect straight to the host. Adding ?net=local to the URL swaps in a
// BroadcastChannel version that links tabs of the same browser, which is handy
// for testing without the internet.

const PREFIX = 'inkydinky-';
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return code;
}

export function cleanCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
}

function useLocalNet() {
  return new URLSearchParams(location.search).get('net') === 'local';
}

// ---------------- a basic connection object ----------------

class Conn {
  constructor(sendFn, closeFn) {
    this._send = sendFn;
    this._close = closeFn;
    this.messageFns = new Set();
    this.closeFns = new Set();
    this.closed = false;
  }
  send(msg) {
    if (!this.closed) this._send(msg);
  }
  onMessage(fn) {
    this.messageFns.add(fn);
  }
  onClose(fn) {
    this.closeFns.add(fn);
  }
  deliver(msg) {
    for (const fn of this.messageFns) fn(msg);
  }
  ended() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.closeFns) fn();
  }
  close() {
    if (this.closed) return;
    this._close?.();
    this.ended();
  }
}

// Two connected ends in the same page, used for the host's own player.
export function loopback() {
  let a = null;
  let b = null;
  a = new Conn((m) => queueMicrotask(() => b.deliver(m)), () => queueMicrotask(() => b.ended()));
  b = new Conn((m) => queueMicrotask(() => a.deliver(m)), () => queueMicrotask(() => a.ended()));
  return [a, b];
}

// ---------------- PeerJS ----------------

let peerLib = null;
function loadPeerJs() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!peerLib) {
    peerLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('./vendor/peerjs.min.js', import.meta.url).href;
      s.onload = () => resolve(window.Peer);
      s.onerror = () => reject(new Error('Could not load the networking library'));
      document.head.append(s);
    });
  }
  return peerLib;
}

function wrapPeerConn(dc) {
  const conn = new Conn((m) => dc.send(m), () => dc.close());
  dc.on('data', (m) => conn.deliver(m));
  dc.on('close', () => conn.ended());
  dc.on('error', () => conn.ended());
  return conn;
}

function friendlyPeerError(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return "Couldn't find that room. Check the code, and make sure the host still has the game open.";
    case 'unavailable-id': return 'That room code is already in use.';
    case 'browser-incompatible': return "This browser doesn't support online play. Try Chrome, Edge, Firefox or Safari.";
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return "Couldn't reach the matchmaking server. Check your internet connection and try again.";
    default: return `Connection problem: ${(err && (err.message || err.type)) || 'unknown error'}`;
  }
}

// Host a room. Returns { code, onConnection(fn), close() }.
export async function hostRoom() {
  if (useLocalNet()) return hostLocal();
  const Peer = await loadPeerJs();
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = makeRoomCode();
    try {
      const peer = await new Promise((resolve, reject) => {
        const p = new Peer(PREFIX + code.toLowerCase(), { debug: 0 });
        p.once('open', () => resolve(p));
        p.once('error', (err) => {
          p.destroy();
          reject(err);
        });
      });
      const fns = new Set();
      peer.on('connection', (dc) => {
        dc.on('open', () => {
          const conn = wrapPeerConn(dc);
          for (const fn of fns) fn(conn);
        });
      });
      // Keep the room reachable if the link to the matchmaking server drops.
      peer.on('disconnected', () => !peer.destroyed && peer.reconnect());
      return {
        code,
        onConnection: (fn) => fns.add(fn),
        close: () => peer.destroy(),
      };
    } catch (err) {
      if (err && err.type === 'unavailable-id') continue;
      throw new Error(friendlyPeerError(err));
    }
  }
  throw new Error('Could not create a room. Please try again.');
}

// Join a room by code. Resolves to a connection.
// onProgress(text) reports each step, so a failure says where it stopped.
export async function joinRoom(code, onProgress = () => {}) {
  if (useLocalNet()) return joinLocal(code);
  onProgress('Loading…');
  const Peer = await loadPeerJs();
  return new Promise((resolve, reject) => {
    onProgress('Contacting the matchmaking server…');
    const peer = new Peer({ debug: 0 });
    let settled = false;
    let stage = 'server';
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(typeof err === 'string' ? err : friendlyPeerError(err)));
    };
    const timeoutMessage = () => ({
      server: "Couldn't reach the matchmaking server. Check your internet connection and try again.",
      host: "Couldn't find the host. Check the code, and make sure the host's game is still open.",
      link: "Found the room, but couldn't link to the host's device. Your networks may be blocking direct connections. Try both being on the same Wi-Fi.",
    })[stage];
    const timer = setTimeout(() => fail(timeoutMessage()), 25000);
    peer.once('error', fail);
    peer.once('open', () => {
      stage = 'host';
      onProgress('Looking for the room…');
      const dc = peer.connect(PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
      // Watch the device-to-device link so a blocked network gives a clear message.
      const watch = setInterval(() => {
        const pc = dc.peerConnection;
        if (!pc) return;
        clearInterval(watch);
        pc.addEventListener('iceconnectionstatechange', () => {
          const st = pc.iceConnectionState;
          if (st === 'checking') {
            stage = 'link';
            onProgress('Found the room. Linking to the host…');
          } else if (st === 'failed') {
            fail("Found the room, but couldn't link to the host's device. Your networks may be blocking direct connections. Try both being on the same Wi-Fi.");
          }
        });
      }, 50);
      dc.once('open', () => {
        clearInterval(watch);
        clearTimeout(timer);
        settled = true;
        const conn = wrapPeerConn(dc);
        conn.onClose(() => peer.destroy());
        resolve(conn);
      });
      dc.once('error', fail);
    });
  });
}

// ---------------- BroadcastChannel (testing) ----------------

function hostLocal() {
  const code = makeRoomCode();
  const channel = new BroadcastChannel(PREFIX + code);
  const conns = new Map();
  const fns = new Set();
  channel.onmessage = ({ data }) => {
    if (data.to !== 'host') return;
    if (data.kind === 'connect') {
      const id = data.from;
      const conn = new Conn(
        (m) => channel.postMessage({ to: id, kind: 'msg', data: m }),
        () => channel.postMessage({ to: id, kind: 'close' }),
      );
      conns.set(id, conn);
      channel.postMessage({ to: id, kind: 'accept' });
      for (const fn of fns) fn(conn);
    } else if (data.kind === 'msg') {
      conns.get(data.from)?.deliver(data.data);
    } else if (data.kind === 'close') {
      conns.get(data.from)?.ended();
      conns.delete(data.from);
    }
  };
  addEventListener('pagehide', () => {
    for (const id of conns.keys()) channel.postMessage({ to: id, kind: 'close' });
  });
  return { code, onConnection: (fn) => fns.add(fn), close: () => channel.close() };
}

function joinLocal(code) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const channel = new BroadcastChannel(PREFIX + code);
    const conn = new Conn(
      (m) => channel.postMessage({ from: id, to: 'host', kind: 'msg', data: m }),
      () => channel.postMessage({ from: id, to: 'host', kind: 'close' }),
    );
    const timer = setTimeout(() => reject(new Error("Couldn't find that room.")), 3000);
    channel.onmessage = ({ data }) => {
      if (data.to !== id) return;
      if (data.kind === 'accept') {
        clearTimeout(timer);
        resolve(conn);
      } else if (data.kind === 'msg') conn.deliver(data.data);
      else if (data.kind === 'close') conn.ended();
    };
    addEventListener('pagehide', () => conn.close());
    channel.postMessage({ from: id, to: 'host', kind: 'connect' });
  });
}
