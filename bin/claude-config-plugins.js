import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Claude Code finds an enabled plugin that installed_plugins.json does not
// list (a marketplace plugin pinned to a git SHA, for example) by its place
// in its own cache: <config dir>/plugins/cache/<marketplace>/<plugin>/<version>.
// The subc config dir never links that cache, so such a plugin, and the MCP
// servers it ships, would not load. Each missing version is copied once. A
// copy, unlike a link, cannot carry a cache sweep or orphan marker made in a
// subc session back into ~/.claude.

// A marketplace or plugin name used as one path segment.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `[plugin, marketplace]` of an enabledPlugins key, or `undefined`. */
function parsePluginId(id) {
  const at = id.lastIndexOf('@');
  if (at <= 0) return undefined;
  const plugin = id.slice(0, at);
  const marketplace = id.slice(at + 1);
  return SAFE_NAME.test(plugin) && SAFE_NAME.test(marketplace)
    ? [plugin, marketplace]
    : undefined;
}

function copyVersion(from, to) {
  // A copy is renamed into place only when complete, so a launch stopped
  // half way never leaves a partial plugin that later launches skip.
  const temp = `${to}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.cpSync(from, temp, { recursive: true, verbatimSymlinks: true });
    fs.renameSync(temp, to);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/** Whether `base` or any folder from it down through `parts` is a link. */
function linkOnPath(base, parts) {
  let current = base;
  for (const part of ['', ...parts]) {
    current = part ? path.join(current, part) : current;
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function directories(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SAFE_NAME.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Copy into `dir`'s plugin cache every cached version of each enabled plugin
 * that the plugin index does not list, unless a copy is already there.
 *
 * @param {{ dir: string, source: string, enabledPlugins: unknown,
 *   indexed: unknown, warnings: string[] }} options
 */
export function copyUnindexedPlugins({
  dir,
  source,
  enabledPlugins,
  indexed,
  warnings,
}) {
  if (!enabledPlugins || typeof enabledPlugins !== 'object') return;
  const listed =
    indexed && typeof indexed === 'object' ? Object.keys(indexed) : [];
  for (const [id, enabled] of Object.entries(enabledPlugins)) {
    if (enabled !== true || listed.includes(id)) continue;
    const parsed = parsePluginId(id);
    if (!parsed) continue;
    const [plugin, marketplace] = parsed;
    const from = path.join(source, 'plugins', 'cache', marketplace, plugin);
    const to = path.join(dir, 'plugins', 'cache', marketplace, plugin);
    // A link here could carry the copy into the user's own cache.
    if (linkOnPath(path.join(dir, 'plugins'), ['cache', marketplace, plugin])) {
      warnings.push(`Skipped plugin ${id} for subc: its cache path is a link.`);
      continue;
    }
    for (const version of directories(from)) {
      if (fs.existsSync(path.join(to, version))) continue;
      try {
        fs.mkdirSync(to, { recursive: true });
        copyVersion(path.join(from, version), path.join(to, version));
      } catch (error) {
        warnings.push(`Could not copy plugin ${id} for subc: ${error.message}`);
      }
    }
  }
}
