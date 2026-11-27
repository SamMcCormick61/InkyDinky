# InkyDinky

A draw-and-guess party game for the browser. One player picks a word and draws it, everyone else races to guess it. Turns rotate until every player has drawn in each round.

**Play:** https://sammccormick61.github.io/InkyDinky/

## How to play

### Online (each player on their own device)

1. Type your name and press **Host a game**. You get a 5-letter room code and an invite link.
2. Send the link to friends (2 to 8 players). They open it, type their name and press **Join**.
3. The host picks rounds and draw time and starts the game.
4. On your turn, pick one of three words and draw it. Everyone else sees your drawing live and types guesses.
   Faster guesses score more, and the drawer scores for every player who gets it.
5. Hints reveal letters as time runs out. Close guesses are flagged just for you.

The host's browser runs the game, so the host needs to keep the page open. Players connect straight
to the host over WebRTC using [PeerJS](https://peerjs.com/) and its free matchmaking server; no game data goes through a server.

### One device (pass and play)

Press **Play on one device**, add everyone's names, then pass the device to whoever is drawing.
Guessers pick their name next to the guess box. The drawer can press **Hold to see word**.

## AI Lab (Claude draws and guesses)

Open **ai-lab.html** (there's a link on the start screen). Paste your own Claude API key, pick a word, and
press **Draw it**. Claude writes simple drawing commands, one stroke per line, and the page draws each line
as soon as it arrives, at hand speed. **Like a person** adds a gentle wobble; **Neat** draws Claude's lines exactly.
**Ask Claude to guess** sends the canvas to Claude, so you can also draw something yourself and see if Claude gets it.

Your key stays in your browser (optionally remembered on that device) and is only sent to Anthropic.
Each drawing costs roughly a cent or less, and the page shows the approximate cost.

- `js/ai.js` – talks to Claude (official Anthropic SDK, vendored in `js/vendor/anthropic-sdk.mjs`) and parses the drawing commands
- `js/pen.js` – plays strokes onto the canvas at hand speed, with optional wobble; it can also send them to other players

## Roadmap

- [x] Core game on one device: canvas, pen, eraser, fill, colours, sizes, undo, clear, word choice, timer, guessing, scoring, turns
- [x] Online rooms: a player hosts and friends join from a link on their own devices (peer to peer)
- [~] Claude as a player and as a drawer that draws line by line (AI Lab done; next: add Claude to real games)
- [ ] Polish: more word lists, sounds, touch tweaks

## Code

No build step, just static files served by GitHub Pages.

- `js/game.js` – game rules (no DOM), ready to run inside the host's browser for online play
- `js/canvas.js` – drawing board. Drawings are stored as simple ops (`stroke`, `fill`, `clear`) with 0–1 coordinates so they can be sent over the network or produced by an AI
- `js/main.js` – start-up: picks online or one-device mode
- `js/online.js` – online screens; every player (host included) talks to the host the same way
- `js/host.js` – runs the room in the host's browser and checks every request against the rules
- `js/net.js` – PeerJS connections (add `?net=local` to link tabs of one browser for testing)
- `js/local.js` – pass-and-play screens
- `js/ui.js` – shared page helpers
- `js/words.js` – word list
- `js/vendor/peerjs.min.js` – PeerJS 1.5.4 (MIT licence)

Run locally with any static server, for example `python3 -m http.server`, then open http://localhost:8000.
Run the engine tests with `npm test` (Node 20+).

## Releasing

Bump `VERSION` in `js/version.js` with every change you publish. It shows next to the logo, and online
players get a note if their version doesn't match the host's (GitHub Pages can serve a cached copy for up to 10 minutes, so a refresh fixes it).
