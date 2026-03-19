const fs = require('fs');
const path = require('path');

const examplesDir = path.join(__dirname, '..', 'examples');
const outputPath = path.join(examplesDir, 'manifest.json');

const examples = [];

/**
 * Parse a simple TOML array of strings: ["a", "b", "c"]
 * Handles multiline arrays. Returns null if not found.
 */
function parseTomlStringArray(content, key) {
  const re = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm');
  const match = content.match(re);
  if (!match) return null;
  // Match both double-quoted and single-quoted strings
  const items = match[1].match(/"([^"]+)"|'([^']+)'/g);
  return items ? items.map(s => s.replace(/^["']|["']$/g, '')) : [];
}

/**
 * Parse a single TOML string value: key = "value"
 */
function parseTomlString(content, key) {
  const re = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm');
  const match = content.match(re);
  return match?.[1] || null;
}

/**
 * Parse [tool.subconscious] section from TOML content.
 */
function parseSubconsciousSection(content) {
  const sectionMatch = content.match(/\[tool\.subconscious\]\s*\n([\s\S]*?)(?:\n\[|$)/);
  if (!sectionMatch) return {};
  const section = sectionMatch[1];

  const result = {};

  const displayName = parseTomlString(section, 'display_name');
  if (displayName) result.displayName = displayName;

  const language = parseTomlString(section, 'language');
  if (language) result.language = language;

  const framework = parseTomlString(section, 'framework');
  if (framework) result.framework = framework;

  const tags = parseTomlStringArray(section, 'tags');
  if (tags) result.tags = tags;

  const setup = parseTomlStringArray(section, 'setup');
  if (setup) result.setup = setup;

  // Parse envVars as inline table: envVars = { KEY = { required = true } }
  // For simplicity, parse as key-value pairs
  const envVarsMatch = section.match(/^envVars\s*=\s*\{([\s\S]*?)\}\s*$/m);
  if (envVarsMatch) {
    try {
      // Simple parse: find "KEY" = { required = true, url = "..." }
      const envContent = envVarsMatch[1];
      const envVars = {};
      const pairRe = /"?(\w+)"?\s*=\s*\{([^}]*)\}/g;
      let pairMatch;
      while ((pairMatch = pairRe.exec(envContent)) !== null) {
        const key = pairMatch[1];
        const val = pairMatch[2];
        const entry = {};
        if (val.includes('required = true') || val.includes('required=true')) {
          entry.required = true;
        }
        const urlMatch = val.match(/url\s*=\s*"([^"]+)"/);
        if (urlMatch) entry.url = urlMatch[1];
        envVars[key] = entry;
      }
      if (Object.keys(envVars).length > 0) result.envVars = envVars;
    } catch {
      // skip malformed envVars
    }
  }

  return result;
}

for (const folder of fs.readdirSync(examplesDir)) {
  const folderPath = path.join(examplesDir, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;

  // Try package.json first (JS/TS projects)
  const packageJsonPath = path.join(folderPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    const example = {
      name: folder,
      displayName: pkg.displayName || pkg.name || folder,
      description: pkg.description || '',
    };

    // v2 fields — read from `subconscious` key in package.json
    const meta = pkg.subconscious || {};
    example.language = meta.language || pkg.language || 'typescript';
    if (meta.framework || pkg.framework) example.framework = meta.framework || pkg.framework;
    if (meta.tags || pkg.tags) example.tags = meta.tags || pkg.tags;
    if (meta.envVars || pkg.envVars) example.envVars = meta.envVars || pkg.envVars;

    if (pkg.setup && Array.isArray(pkg.setup)) {
      example.setup = pkg.setup;
    }

    examples.push(example);
    continue;
  }

  // Try pyproject.toml (Python projects)
  const pyprojectPath = path.join(folderPath, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const content = fs.readFileSync(pyprojectPath, 'utf-8');
    const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
    const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);

    const sub = parseSubconsciousSection(content);

    const example = {
      name: folder,
      displayName: sub.displayName || nameMatch?.[1] || folder,
      description: descMatch?.[1] || '',
      language: sub.language || 'python',
    };

    if (sub.framework) example.framework = sub.framework;
    if (sub.tags) example.tags = sub.tags;
    if (sub.envVars) example.envVars = sub.envVars;
    if (sub.setup) example.setup = sub.setup;

    examples.push(example);
    continue;
  }

  // Folder exists but no metadata file
  examples.push({
    name: folder,
    displayName: folder,
    description: '',
    language: 'typescript',
  });
}

// Sort alphabetically
examples.sort((a, b) => a.name.localeCompare(b.name));

const manifest = {
  version: 2,
  generated: new Date().toISOString(),
  examples,
};

fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Generated v2 manifest with ${examples.length} examples`);
