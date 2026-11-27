// Claude as a drawing helper in online rooms.
//
// Claude isn't a player. The host turns it on with their own API key, and then
// any player can ask Claude to draw their word for them. It runs in the host's
// browser and draws stroke by stroke at hand speed, like a person would.

import { Pen } from './pen.js';
import * as realAi from './ai.js';

// Pen speeds (1 = normal hand speed).
export const SPEEDS = {
  'very-slow': { label: 'Very slow, like a person', value: 0.4 },
  slow: { label: 'Slow', value: 0.7 },
  normal: { label: 'Normal', value: 1 },
  fast: { label: 'Fast', value: 1.6 },
};

export const DEFAULT_ARTIST_SETTINGS = {
  model: realAi.MODELS[0].id,
  speed: 'very-slow',
  style: 'human',
  context: true,
};

// The pen normally draws on a board too; here everything goes out through `out`.
const NO_BOARD = { liveStart() {}, liveAppend() {}, remoteOp() {} };

export class ClaudeArtist {
  constructor({ apiKey, settings = {}, ai = realAi }) {
    this.ai = ai;
    this.settings = { ...DEFAULT_ARTIST_SETTINGS, ...settings };
    this.spent = 0; // rough API cost in dollars
    this.setKey(apiKey);
  }

  setKey(apiKey) {
    this.client = apiKey ? this.ai.makeClient(apiKey) : null;
  }

  update(settings) {
    this.settings = { ...this.settings, ...settings };
  }

  get speed() {
    return SPEEDS[this.settings.speed]?.value ?? (Number(this.settings.speed) || 0.4);
  }

  friendlyError(err) {
    return this.ai.friendlyError(err);
  }

  // Draws `word`, sending each stroke to `out` ({ liveStart, liveAppend, op })
  // as it goes. Returns { stop(), notes, done }:
  //   notes resolves with Claude's explanation of its context clues (or '')
  //   as soon as Claude has written it, which is usually before the pen is done;
  //   done resolves when the drawing is finished.
  draw({ word, out, signal }) {
    const pen = new Pen(NO_BOARD, { style: this.settings.style, speed: this.speed, out });
    const context = this.settings.context;
    const request = this.ai.drawWord({
      client: this.client,
      model: this.settings.model,
      word,
      context,
      signal,
      onOp: (op) => pen.push(op),
    }).then((result) => {
      this.spent += result.cost || 0;
      if (!result.ops.length) throw new Error("Claude didn't send any drawing commands.");
      return result;
    });
    request.catch(() => pen.stop());
    return {
      stop: () => pen.stop(),
      notes: request.then((r) => (context ? r.notes : '')),
      done: request.then(() => pen.finish()),
    };
  }
}
