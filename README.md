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

### Let Claude draw for you (online)

Claude isn't a player. It's a helper the host can turn on. In the lobby, the host opens
**🤖 Let Claude draw for players**, pastes their own Claude API key and picks:

- **Level**: which Claude model draws (Opus draws best, Haiku is cheapest)
- **Drawing speed**: *Very slow, like a person* by default
- **Drawing style**: *Like a person* (a gentle wobble) or *Neat*
- **Context clues**: on by default, so Claude adds things that go with the word, like water around a fish

Then, on any player's turn, the word picker shows **🤖 Let Claude draw it for me**. Tick it and pick a word,
and Claude draws that word stroke by stroke for everyone to guess. The drawer still scores as usual.
When the turn ends, Claude's explanation of its context clues appears on the answer screen and in the chat.
If Claude can't draw (for example the key has run out of credit), the drawer gets the pen back.

Once Claude is on, the host can also press **Add Claude as a player**. Claude then joins the room like a
person: on other players' turns it looks at the drawing every so often and types a guess, so its wrong
guesses show in the chat and a right one just shows "Claude guessed it!". On its own turn it picks a word
and draws it with the settings above. It uses the host's key too.

Claude runs in the host's browser, so the key is only ever sent from there to Anthropic. At the end of a
game the host sees roughly how much API credit Claude's drawings used.

### One device (pass and play)

Press **Play on one device**, add everyone's names, then pass the device to whoever is drawing.
Guessers pick their name next to the guess box. The drawer can press **Hold to see word**.

## AI Lab (Claude draws and guesses)

Open **ai-lab.html** (there's a link on the start screen). Paste your own Claude API key, pick a word, and
press **Draw it**. Claude writes simple drawing commands, one stroke per line, and the page draws each line
as soon as it arrives, at hand speed. **Like a person** adds a gentle wobble; **Neat** draws Claude's lines exactly.
**+ Context clues** asks Claude to add things that go with the word (water and bubbles around a fish, snowflakes around a snowman); **Just the word** draws the thing on its own.
With context clues on, once the drawing is finished Claude explains which clues it drew and why.
**Ask Claude to guess** sends the canvas to Claude, so you can also draw something yourself and see if Claude gets it.

Your key stays in your browser (optionally remembered on that device) and is only sent to Anthropic.
Each drawing costs roughly a cent or less, and the page shows the approximate cost.

- `js/ai.js` – talks to Claude (official Anthropic SDK, vendored in `js/vendor/anthropic-sdk.mjs`) and parses the drawing commands
- `js/pen.js` – plays strokes onto the canvas at hand speed, with optional wobble; it can also send them to other players
- `js/artist.js` – Claude drawing a player's word in an online room (runs in the host's browser; `Host.setArtist` turns it on)
- `js/bot.js` – Claude as a player: joins the room through a loopback connection, guesses and draws

## Roadmap

- [x] Core game on one device: canvas, pen, eraser, fill, colours, sizes, undo, clear, word choice, timer, guessing, scoring, turns
- [x] Online rooms: a player hosts and friends join from a link on their own devices (peer to peer)
- [x] Claude draws line by line: AI Lab, and in online games any drawer can let Claude draw their word
- [x] Claude as a player in online games (guesses and draws like a person)
- [ ] Claude in one-device games, and other AIs
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
