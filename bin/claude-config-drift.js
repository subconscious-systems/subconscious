import { isDeepStrictEqual } from 'node:util';

// Each launch rebuilds the subc copies of settings.json and the MCP servers
// in .claude.json from the user's own files, so anything a subc session
// changed in those copies is replaced. These helpers find what a session
// changed, by comparing the copies with what the last launch wrote, so the
// launch can save it aside and name it instead of losing it silently.

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Keys of `current` that a session added or changed since `written`.
 * Removed keys are ignored: Claude Code drops keys on its own.
 *
 * @param {Record<string, unknown>} written what the last launch wrote
 * @param {Record<string, unknown>} current what the copy holds now
 * @param {string[]} [ignored] keys subc keeps across launches
 * @returns {string[]}
 */
export function changedKeys(written, current, ignored = []) {
  if (!isObject(written) || !isObject(current)) return [];
  return Object.keys(current).filter(
    (key) =>
      !ignored.includes(key) && !isDeepStrictEqual(current[key], written[key]),
  );
}

/** The MCP servers of a .claude.json: user scope and each project. */
export function mcpServersOf(state) {
  const projects = isObject(state?.projects) ? state.projects : {};
  return {
    mcpServers: isObject(state?.mcpServers) ? state.mcpServers : {},
    projects: Object.fromEntries(
      Object.entries(projects)
        .filter(([, project]) => isObject(project?.mcpServers))
        .map(([name, project]) => [name, project.mcpServers]),
    ),
  };
}

/**
 * MCP server names a session added or changed since `written`, as
 * `name` for user scope and `name (project)` for a project.
 *
 * @param {ReturnType<typeof mcpServersOf>} written
 * @param {ReturnType<typeof mcpServersOf>} current
 * @returns {string[]}
 */
export function changedMcpServers(written, current) {
  const changed = changedKeys(written.mcpServers, current.mcpServers);
  for (const [project, servers] of Object.entries(current.projects)) {
    for (const name of changedKeys(written.projects[project] ?? {}, servers)) {
      changed.push(`${name} (${project})`);
    }
  }
  return changed;
}
