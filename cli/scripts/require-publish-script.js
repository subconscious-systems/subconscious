#!/usr/bin/env node

if (process.env.SUBCONSCIOUS_PUBLISH_PACKAGE_SH !== '1') {
  console.error(
    'Direct npm publishing is disabled. Run ./publish_package.sh from the subconscious repository root.',
  );
  process.exit(1);
}
