#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// npm pack and npm publish run prepare in the source tree before
// devDependencies are installed. Hook setup is only for a local checkout.
const require = createRequire(import.meta.url);

let cli;
try {
  cli = require.resolve('simple-git-hooks/cli.js');
} catch (error) {
  if (error?.code === 'MODULE_NOT_FOUND') {
    process.exit(0);
  }
  throw error;
}

const result = spawnSync(process.execPath, [cli], { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
