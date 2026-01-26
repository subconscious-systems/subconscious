#!/usr/bin/env node
/**
 * Cross-platform postbuild script
 * 
 * Adds shebang to the built file and makes it executable.
 * Works on Windows, macOS, and Linux.
 */

const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist', 'index.js');

// Read the built file
let content;
try {
  content = fs.readFileSync(distPath, 'utf8');
} catch (err) {
  console.error('Error reading dist/index.js:', err.message);
  process.exit(1);
}

// Add shebang if not already present
const shebang = '#!/usr/bin/env node\n';
if (!content.startsWith('#!')) {
  fs.writeFileSync(distPath, shebang + content);
  console.log('Added shebang to dist/index.js');
}

// Make executable (Unix only - safe to skip on Windows)
if (process.platform !== 'win32') {
  try {
    fs.chmodSync(distPath, 0o755);
    console.log('Made dist/index.js executable');
  } catch (err) {
    // Ignore chmod errors
  }
}

console.log('Postbuild complete');
