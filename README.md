# InkyDinky

A draw-and-guess party game for the browser. One player picks a word and draws it, everyone else races to guess it. Turns rotate until every player has drawn in each round.

**Play:** https://sammccormick61.github.io/inkydinky/

## How to play (current version)

1. Add everyone's names (2 to 8 players) and choose rounds and draw time.
2. Pass the device to the drawer. They pick one of three words and draw it.
3. Everyone else types guesses (pick your name in the box next to the guess field).
   Faster guesses score more, and the drawer scores for every player who gets it.
4. Hints reveal letters as time runs out. Close guesses are flagged.

The drawer can press **Hold to see word** to check the word without showing it to everyone.

## Roadmap

- [x] Core game on one device: canvas, pen, eraser, fill, colours, sizes, undo, clear, word choice, timer, guessing, scoring, turns
- [ ] Online rooms: a player hosts and friends join from a link on their own devices (peer to peer)
- [ ] Claude as a player and as a drawer that draws line by line, with room for other AIs later
- [ ] Polish: more word lists, sounds, touch tweaks

## Code

No build step, just static files served by GitHub Pages.

- `js/game.js` – game rules (no DOM), ready to run inside the host's browser for online play
- `js/canvas.js` – drawing board. Drawings are stored as simple ops (`stroke`, `fill`, `clear`) with 0–1 coordinates so they can be sent over the network or produced by an AI
- `js/main.js` – page wiring for pass-and-play
- `js/words.js` – word list

Run locally with any static server, for example `python3 -m http.server`, then open http://localhost:8000.
Run the engine tests with `npm test` (Node 20+).
