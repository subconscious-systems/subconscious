// The Subconscious plugin for OpenCode 2.x, loaded from this directory by the
// launch config's `plugins` array. OpenCode 2.x requires this format: a
// default export with an id and a setup function, in a directory, not a
// single .ts file, and it dropped the v1 hooks the old image-window and
// compaction plugins used, so neither loaded at all on 2.x.
//
// What it does: keep requests to Subconscious at the newest screenshots. The
// shared window logic in ../../image-window/window.js replaces the oldest
// images with a text label before upload, which keeps Subconscious Cache
// reusing the rest of the conversation; the gateway applies the same rule
// server-side, but only after the bytes have made the trip.
//
// What it deliberately does not do yet: report compactions to the gateway.
// The v1 plugin that did is no longer loadable, and the v2 event surface for
// a compaction-completion signal is not documented; porting it is follow-up
// work on SUBCON-767 once that surface is confirmed.

import { Plugin } from '@opencode/plugin';
import { windowImages } from '../../image-window/window.js';

export default Plugin.define({
  id: 'subconscious',
  async setup(ctx) {
    await ctx.session.hook('http.request', async (event) => {
      // A broken trim must never break a coding session: fail open.
      try {
        const body = await event.request.clone().text();
        const windowed = windowImages(JSON.parse(body));
        if (!windowed) return;
        event.request = new Request(event.request, {
          body: JSON.stringify(windowed),
        });
      } catch {
        // Send the request exactly as OpenCode built it.
      }
    });
  },
});
