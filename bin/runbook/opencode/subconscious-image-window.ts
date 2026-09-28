/**
 * Keep OpenCode's requests to Subconscious at the newest 100 images.
 *
 * OpenCode resends every screenshot on every turn, so a long session's upload
 * grows until the gateway refuses it. This gives the `subconscious` provider a
 * fetch that trims the request body before it leaves (bin/runbook/image-window),
 * the same rule the gateway applies, so Subconscious Cache still reuses the
 * rest. OpenCode reads provider settings after plugins' config hooks run, so a
 * function set here becomes the provider's fetch.
 *
 * Loaded by path from the launch config; nothing is written to disk.
 */

import type { Plugin } from '@opencode-ai/plugin';
import { windowFetch } from '../image-window/window.js';

export const SubconsciousImageWindow: Plugin = async () => ({
  config: async (config) => {
    const provider = config.provider?.subconscious;
    if (!provider) return;
    const base = provider.options?.fetch ?? fetch;
    provider.options = { ...provider.options, fetch: windowFetch(base) };
  },
});
