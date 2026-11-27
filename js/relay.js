// Connection helpers for players on different networks.
//
// Two devices on the same Wi-Fi can usually link directly. On different
// networks (home broadband vs mobile data, say) routers often block that,
// and the game data has to go through a relay ("TURN") server instead.
//
// To use a Metered relay (free plan at https://www.metered.ca), fill in the
// app name (the part before .metered.live) and the API key from the
// Metered dashboard. Leave them empty to use the free public servers only.
export const RELAY = {
  meteredApp: '',
  meteredApiKey: '',
};

// Public servers that help devices find a direct route.
const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// PeerJS's own free relay. Often unreliable, so it's only a fallback.
const PEERJS_TURN = {
  urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
  username: 'peerjs',
  credential: 'peerjsp',
};

let cached = null;

export function iceServers() {
  if (!cached) cached = loadIceServers();
  return cached;
}

async function loadIceServers() {
  const { meteredApp, meteredApiKey } = RELAY;
  if (meteredApp && meteredApiKey) {
    try {
      const url = `https://${encodeURIComponent(meteredApp)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`;
      const res = await fetch(url);
      if (res.ok) {
        const servers = await res.json();
        if (Array.isArray(servers) && servers.length) return [...STUN, ...servers];
      }
    } catch {
      /* fall back to the public servers below */
    }
  }
  return [...STUN, PEERJS_TURN];
}

export function hasRelay() {
  return Boolean(RELAY.meteredApp && RELAY.meteredApiKey);
}
