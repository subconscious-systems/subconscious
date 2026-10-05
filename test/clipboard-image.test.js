import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readClipboardImage } from '../bin/clipboard-image.js';

test('Linux clipboard supports PNG and JPEG through Wayland and X11 tools', {
  skip: process.platform !== 'linux',
}, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-clipboard-'));
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = `${directory}:${originalPath}`;
    for (const backend of ['wl-paste', 'xclip']) {
      for (const [type, hex] of [
        ['image/png', '89504e470d0a1a0a'],
        ['image/jpeg', 'ffd8ff00'],
      ]) {
        for (const command of ['wl-paste', 'xclip']) {
          await fs.writeFile(
            path.join(directory, command),
            `#!/usr/bin/env node
if (${JSON.stringify(command === backend)} && process.argv.includes(${JSON.stringify(type)})) {
  process.stdout.write(Buffer.from(${JSON.stringify(hex)}, 'hex'));
} else {
  process.exitCode = 1;
}
`,
            { mode: 0o755 },
          );
        }
        const image = await readClipboardImage();
        assert.deepEqual(image, Buffer.from(hex, 'hex'), `${backend} ${type}`);
      }
    }
    for (const command of ['wl-paste', 'xclip']) {
      await fs.writeFile(path.join(directory, command), '#!/bin/sh\nexit 1\n', {
        mode: 0o755,
      });
    }
    assert.equal(await readClipboardImage(), null);
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
