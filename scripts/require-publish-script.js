#!/usr/bin/env node

if (process.env.SUBCONSCIOUS_RELEASE_PLEASE !== '1') {
  console.error(
    'Direct npm publishing is disabled. subconscious-cli is published by the Release Please workflow when its release pull request merges to main.',
  );
  process.exit(1);
}
