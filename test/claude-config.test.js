import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { agentById } from '../bin/agent-data.js';
import {
  prepareClaudeConfigDir,
  prepareClaudeLaunch,
  SHARED_ENTRIES,
} from '../bin/claude-config.js';

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A fake home with a populated ~/.claude and ~/.claude.json. */
function fakeHome({ settings, claudeJson } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subc-claude-config-'));
  roots.push(home);
  const source = path.join(home, '.claude');
  fs.mkdirSync(path.join(source, 'skills', 'my-skill'), { recursive: true });
  fs.writeFileSync(path.join(source, 'skills', 'my-skill', 'SKILL.md'), 'x');
  fs.writeFileSync(path.join(source, 'CLAUDE.md'), '# mine\n');
  fs.writeFileSync(
    path.join(source, 'settings.json'),
    JSON.stringify(
      settings ?? {
        model: 'opus',
        hooks: { Stop: [] },
        enabledPlugins: { 'p@m': true },
      },
    ),
  );
  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify(
      claudeJson ?? {
        oauthAccount: { emailAddress: 'me@example.com' },
        primaryApiKey: 'sk-ant-secret',
        hasCompletedOnboarding: true,
        theme: 'dark',
        mcpServers: { linear: { type: 'http', url: 'https://mcp.linear' } },
        projects: {
          '/work/app': {
            mcpServers: { db: { command: 'db-mcp' } },
            hasTrustDialogAccepted: true,
            allowedTools: ['Bash'],
            projectOnboardingSeenCount: 3,
          },
        },
      },
    ),
  );
  return { home, source, dir: path.join(home, '.subconscious', 'claude-code') };
}

/** Run `fn` with a fresh temp dir as the working directory. */
function inTempCwd(fn) {
  const cwd = process.cwd();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'subc-claude-cwd-'));
  roots.push(temp);
  process.chdir(temp);
  try {
    return fn(temp);
  } finally {
    process.chdir(cwd);
  }
}

/** A subc dir an earlier launch made, as its marker file shows. */
function markSubcDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.subc-written.json'), '{}');
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('shared entries link back to ~/.claude, so the user setup and sessions are one copy', () => {
  const { home, source, dir } = fakeHome();
  prepareClaudeConfigDir({ dir, home });

  assert.equal(
    fs.readlinkSync(path.join(dir, 'CLAUDE.md')),
    path.join(source, 'CLAUDE.md'),
  );
  assert.equal(
    fs.readlinkSync(path.join(dir, 'skills')),
    path.join(source, 'skills'),
  );
  // Session history is shared even before plain Claude ever ran.
  assert.equal(
    fs.readlinkSync(path.join(dir, 'projects')),
    path.join(source, 'projects'),
  );
  assert.equal(fs.statSync(path.join(source, 'projects')).isDirectory(), true);
  // A shared folder the user lacks is created in ~/.claude first, so the
  // first agent made inside subc still lands in ~/.claude.
  assert.equal(
    fs.readlinkSync(path.join(dir, 'agents')),
    path.join(source, 'agents'),
  );
  assert.equal(fs.statSync(path.join(source, 'agents')).isDirectory(), true);
  // The editor lock files are shared, so /ide finds the editor.
  assert.equal(
    fs.readlinkSync(path.join(dir, 'ide')),
    path.join(source, 'ide'),
  );
  // A shared file the user lacks is not invented.
  assert.equal(fs.existsSync(path.join(source, 'keybindings.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'keybindings.json')), false);

  // A session written through the isolated dir lands in ~/.claude.
  fs.writeFileSync(path.join(dir, 'projects', 's.jsonl'), '{}');
  assert.equal(fs.existsSync(path.join(source, 'projects', 's.jsonl')), true);
});

test('settings.json follows the user settings but keeps the subc model pick', () => {
  const { home, source, dir } = fakeHome({
    settings: {
      model: 'opus',
      apiKeyHelper: '/bin/key',
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', FOO: '1' },
      hooks: { Stop: [] },
    },
  });
  const userBytes = fs.readFileSync(path.join(source, 'settings.json'));

  prepareClaudeConfigDir({ dir, home, launchEnvNames: ['ANTHROPIC_BASE_URL'] });
  let settings = readJson(path.join(dir, 'settings.json'));
  assert.equal(
    settings.model,
    undefined,
    'the plain Claude model must not leak in',
  );
  assert.equal(
    settings.apiKeyHelper,
    undefined,
    'a key helper would replace the gateway token',
  );
  assert.deepEqual(
    settings.env,
    { FOO: '1' },
    'subc launch env must not be overridden',
  );
  assert.deepEqual(settings.hooks, { Stop: [] });

  // A /model pick inside subc is written to the isolated settings.
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ ...settings, model: 'subconscious/glm' }),
  );
  // The user then changes their own settings.
  fs.writeFileSync(
    path.join(source, 'settings.json'),
    JSON.stringify({ model: 'sonnet', hooks: { Stop: [{ x: 1 }] } }),
  );
  const changedBytes = fs.readFileSync(path.join(source, 'settings.json'));

  prepareClaudeConfigDir({ dir, home });
  settings = readJson(path.join(dir, 'settings.json'));
  assert.equal(
    settings.model,
    'subconscious/glm',
    'the subc pick survives the next launch',
  );
  assert.deepEqual(
    settings.hooks,
    { Stop: [{ x: 1 }] },
    'user edits reach subc',
  );
  assert.deepEqual(
    fs.readFileSync(path.join(source, 'settings.json')),
    changedBytes,
    '~/.claude/settings.json is never written',
  );
  assert.notDeepEqual(userBytes, changedBytes);
});

test('.claude.json gets MCP servers, trust and onboarding but never login state', () => {
  const { home, dir } = fakeHome();
  markSubcDir(dir);
  fs.writeFileSync(
    path.join(dir, '.claude.json'),
    JSON.stringify({
      numStartups: 7,
      projects: { '/work/app': { lastCost: 2 } },
    }),
  );

  prepareClaudeConfigDir({ dir, home });
  const file = path.join(dir, '.claude.json');
  const state = readJson(file);
  assert.deepEqual(state.mcpServers, {
    linear: { type: 'http', url: 'https://mcp.linear' },
  });
  assert.equal(state.hasCompletedOnboarding, true);
  assert.equal(state.theme, 'dark');
  assert.equal(state.oauthAccount, undefined);
  assert.equal(state.primaryApiKey, undefined);
  assert.equal(
    state.numStartups,
    7,
    'Claude Code state in the isolated file is kept',
  );
  assert.deepEqual(state.projects['/work/app'], {
    lastCost: 2,
    mcpServers: { db: { command: 'db-mcp' } },
    hasTrustDialogAccepted: true,
    allowedTools: ['Bash'],
  });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test('existing files in the isolated dir are never replaced or deleted', () => {
  const { home, dir } = fakeHome();
  markSubcDir(dir);
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'old.jsonl'), '{}');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# local\n');

  const { warnings } = prepareClaudeConfigDir({ dir, home });
  assert.equal(
    fs.readFileSync(path.join(dir, 'projects', 'old.jsonl'), 'utf8'),
    '{}',
  );
  assert.equal(
    fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'),
    '# local\n',
  );
  assert.equal(
    warnings.some((w) => w.includes('projects')),
    true,
    'a real dir where a link belongs is reported',
  );
});

test('a second launch is a no-op for links and keeps them pointed at ~/.claude', () => {
  const { home, source, dir } = fakeHome();
  prepareClaudeConfigDir({ dir, home });
  const { warnings } = prepareClaudeConfigDir({ dir, home });
  assert.deepEqual(warnings, []);
  assert.equal(
    fs.readlinkSync(path.join(dir, 'skills')),
    path.join(source, 'skills'),
  );
});

test('unreadable user files warn instead of blocking the launch', () => {
  const { home, source, dir } = fakeHome();
  fs.writeFileSync(path.join(source, 'settings.json'), '{ not json');
  fs.writeFileSync(path.join(home, '.claude.json'), '{ not json');

  const { warnings } = prepareClaudeConfigDir({ dir, home });
  assert.equal(warnings.length, 2);
  assert.deepEqual(readJson(path.join(dir, 'settings.json')), {});
  assert.equal(fs.existsSync(path.join(dir, '.claude.json')), false);
});

test('a home with no ~/.claude still gets a working isolated dir', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subc-claude-empty-'));
  roots.push(home);
  const dir = path.join(home, '.subconscious', 'claude-code');
  const { warnings } = prepareClaudeConfigDir({ dir, home });
  assert.deepEqual(warnings, []);
  assert.deepEqual(readJson(path.join(dir, 'settings.json')), {});
  assert.equal(
    fs.readlinkSync(path.join(dir, 'projects')),
    path.join(home, '.claude', 'projects'),
  );
});

test('SHARED_ENTRIES never includes the files subc rebuilds', () => {
  for (const owned of ['settings.json', '.claude.json', '.credentials.json']) {
    assert.equal(SHARED_ENTRIES.includes(owned), false, owned);
  }
});

/** A second Claude config folder, as CLAUDE_CONFIG_DIR users keep one. */
function customConfig(home, name = '.claude-personal') {
  const own = path.join(home, name);
  fs.mkdirSync(path.join(own, 'skills', 'personal-skill'), { recursive: true });
  fs.writeFileSync(
    path.join(own, 'settings.json'),
    JSON.stringify({ model: 'opus', hooks: { Own: [] } }),
  );
  fs.writeFileSync(
    path.join(own, '.claude.json'),
    JSON.stringify({
      mcpServers: { notion: { type: 'http', url: 'https://n' } },
      oauthAccount: { x: 1 },
    }),
  );
  return own;
}

test('a launch prepares the dir subc chose and skips an opted-out launch', () => {
  const agent = agentById('claude-code');
  const { home, dir } = fakeHome();
  prepareClaudeLaunch(agent, {}, {}, { home });
  assert.equal(fs.existsSync(dir), false, 'opted out: nothing to prepare');
  prepareClaudeLaunch(agent, { CLAUDE_CONFIG_DIR: dir }, {}, { home });
  assert.equal(fs.lstatSync(path.join(dir, 'skills')).isSymbolicLink(), true);
});

test('a user-set CLAUDE_CONFIG_DIR is the source subc shares from', () => {
  const agent = agentById('claude-code');
  const { home, source, dir } = fakeHome();
  const own = customConfig(home);
  const before = { claude: snapshot(source), own: snapshot(own) };

  const result = prepareClaudeLaunch(
    agent,
    { CLAUDE_CONFIG_DIR: dir },
    { CLAUDE_CONFIG_DIR: own },
    { home },
  );
  assert.equal(result.refused, false);
  assert.deepEqual(result.env, { SUBC_CLAUDE_CONFIG_SOURCE: own });
  assert.equal(
    fs.readlinkSync(path.join(dir, 'skills')),
    path.join(own, 'skills'),
  );
  assert.deepEqual(readJson(path.join(dir, 'settings.json')), {
    hooks: { Own: [] },
  });
  const state = readJson(path.join(dir, '.claude.json'));
  assert.deepEqual(
    Object.keys(state.mcpServers),
    ['notion'],
    'MCP servers come from $CLAUDE_CONFIG_DIR/.claude.json',
  );
  assert.equal(state.oauthAccount, undefined);
  assert.deepEqual({ claude: snapshot(source), own: snapshot(own) }, before);
});

test('a subc session started inside a subc session keeps the original source', () => {
  const agent = agentById('claude-code');
  const { home, source, dir } = fakeHome();
  const own = customConfig(home);
  // The inner shell carries the subc dir as CLAUDE_CONFIG_DIR.
  const inner = { CLAUDE_CONFIG_DIR: dir, SUBC_CLAUDE_CONFIG_SOURCE: own };
  const result = prepareClaudeLaunch(agent, { CLAUDE_CONFIG_DIR: dir }, inner, {
    home,
  });
  assert.equal(result.refused, false);
  assert.equal(
    fs.readlinkSync(path.join(dir, 'skills')),
    path.join(own, 'skills'),
  );

  // Without the carried source, the subc dir is never its own source.
  const bare = prepareClaudeLaunch(
    agent,
    { CLAUDE_CONFIG_DIR: dir },
    { CLAUDE_CONFIG_DIR: dir },
    { home },
  );
  assert.equal(bare.refused, false);
  assert.deepEqual(bare.env, { SUBC_CLAUDE_CONFIG_SOURCE: source });
});

test('a relative CLAUDE_CONFIG_DIR falls back to ~/.claude with a warning', () => {
  const agent = agentById('claude-code');
  const { home, source, dir } = fakeHome();
  const result = prepareClaudeLaunch(
    agent,
    { CLAUDE_CONFIG_DIR: dir },
    { CLAUDE_CONFIG_DIR: 'rel/claude' },
    { home },
  );
  assert.match(result.warnings.join('\n'), /not an absolute path/);
  assert.equal(
    fs.readlinkSync(path.join(dir, 'skills')),
    path.join(source, 'skills'),
  );
});

test('a source that resolves to the subc dir or holds it is refused', () => {
  const { home, dir } = fakeHome();
  const own = customConfig(home);
  for (const target of [own, path.join(own, 'sub')]) {
    const { refused } = prepareClaudeConfigDir({
      dir: target,
      home,
      source: own,
      stateFile: path.join(own, '.claude.json'),
    });
    assert.equal(refused, true, target);
  }
  assert.equal(
    prepareClaudeConfigDir({
      dir,
      home,
      source: own,
      stateFile: path.join(own, '.claude.json'),
    }).refused,
    false,
  );
});

test('the launch env subc sets wins over the user settings env', () => {
  const agent = agentById('claude-code');
  const { home, dir } = fakeHome({
    settings: {
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', OTHER: 'x' },
    },
  });
  prepareClaudeLaunch(agent, { CLAUDE_CONFIG_DIR: dir }, {}, { home });
  assert.deepEqual(readJson(path.join(dir, 'settings.json')).env, {
    OTHER: 'x',
  });
});

test('a dir that resolves to ~/.claude or home is refused and nothing is written', () => {
  const { home, source } = fakeHome();
  const before = snapshot(home);
  fs.mkdirSync(path.join(home, '.subconscious'), { recursive: true });
  const linked = path.join(home, '.subconscious', 'claude-code');
  fs.symlinkSync(source, linked);
  for (const dir of [linked, source, path.join(source, 'nested'), home]) {
    const { warnings } = prepareClaudeConfigDir({ dir, home });
    assert.equal(warnings.length, 1, dir);
    assert.match(warnings[0], /refus/i);
  }
  fs.unlinkSync(linked);
  assert.deepEqual(snapshot(home), before);
});

test('a relative dir is refused', () => {
  const { home } = fakeHome();
  inTempCwd((cwd) => {
    const { warnings } = prepareClaudeConfigDir({ dir: 'claude-code', home });
    assert.match(warnings.join('\n'), /absolute/);
    assert.deepEqual(fs.readdirSync(cwd), []);
  });
});

test('a blank config dir never reaches prepare', () => {
  const agent = agentById('claude-code');
  const { home } = fakeHome();
  inTempCwd((cwd) => {
    const blank = { CLAUDE_CONFIG_DIR: '   ' };
    assert.deepEqual(prepareClaudeLaunch(agent, blank, blank, { home }), {
      warnings: [],
      refused: false,
      env: {},
    });
    assert.deepEqual(fs.readdirSync(cwd), []);
  });
});

test('special files and a ~/.claude that is a file warn instead of hanging or throwing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subc-claude-odd-'));
  roots.push(home);
  fs.writeFileSync(path.join(home, '.claude'), 'not a dir');
  fs.mkdirSync(path.join(home, '.claude.json'));
  const dir = path.join(home, '.subconscious', 'claude-code');
  const { warnings } = prepareClaudeConfigDir({ dir, home });
  assert.ok(warnings.length >= 1);
  assert.equal(
    fs.readFileSync(path.join(home, '.claude'), 'utf8'),
    'not a dir',
  );
});

test('plugins get their own index in the subc dir, so plugin changes in subc stay there', () => {
  const { home, source, dir } = fakeHome();
  const plugins = path.join(source, 'plugins');
  fs.mkdirSync(path.join(plugins, 'cache', 'm', 'p', '1.0.0'), {
    recursive: true,
  });
  const index = JSON.stringify({
    version: 2,
    plugins: {
      'p@m': [{ installPath: path.join(plugins, 'cache', 'm', 'p', '1.0.0') }],
    },
  });
  fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), index);
  fs.writeFileSync(path.join(plugins, 'known_marketplaces.json'), '{"m":{}}');

  prepareClaudeConfigDir({ dir, home });
  const own = path.join(dir, 'plugins');
  assert.equal(fs.lstatSync(own).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(path.join(own, 'installed_plugins.json'), 'utf8'),
    index,
  );
  assert.equal(
    fs.existsSync(path.join(own, 'cache')),
    false,
    'the cache is never shared',
  );

  // An uninstall inside subc rewrites only the subc copy.
  fs.writeFileSync(
    path.join(own, 'installed_plugins.json'),
    '{"version":2,"plugins":{}}',
  );
  assert.equal(
    fs.readFileSync(path.join(plugins, 'installed_plugins.json'), 'utf8'),
    index,
  );
  // The next launch restores the user's plugins.
  prepareClaudeConfigDir({ dir, home });
  assert.equal(
    fs.readFileSync(path.join(own, 'installed_plugins.json'), 'utf8'),
    index,
  );
});

test('an old plugins link from an earlier build is replaced, never followed', () => {
  const { home, source, dir } = fakeHome();
  fs.mkdirSync(path.join(source, 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'plugins', 'installed_plugins.json'),
    '{"x":1}',
  );
  markSubcDir(dir);
  fs.symlinkSync(path.join(source, 'plugins'), path.join(dir, 'plugins'));
  prepareClaudeConfigDir({ dir, home });
  assert.equal(fs.lstatSync(path.join(dir, 'plugins')).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(
      path.join(source, 'plugins', 'installed_plugins.json'),
      'utf8',
    ),
    '{"x":1}',
  );
});

/** Every file under `root` with its bytes, following no links. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile())
        out[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
      else out[path.relative(root, full)] = `link:${fs.readlinkSync(full)}`;
    }
  };
  walk(root);
  return out;
}

test('a case-variant link to ~/.claude is refused', (t) => {
  const { home, source } = fakeHome();
  if (!fs.existsSync(path.join(home, '.CLAUDE'))) {
    t.skip('case-sensitive file system');
    return;
  }
  const before = snapshot(source);
  fs.mkdirSync(path.join(home, '.subconscious'), { recursive: true });
  const linked = path.join(home, '.subconscious', 'claude-code');
  fs.symlinkSync(path.join(home, '.CLAUDE'), linked);
  const { warnings } = prepareClaudeConfigDir({ dir: linked, home });
  assert.match(warnings.join('\n'), /refus/i);
  assert.deepEqual(snapshot(source), before);
});

test('a dir that holds the real target of the user settings is never written over', () => {
  const { home, source } = fakeHome();
  // Stow-style dotfiles: ~/.claude/settings.json links into ~/dotfiles/claude.
  const dotfiles = path.join(home, 'dotfiles', 'claude');
  fs.mkdirSync(dotfiles, { recursive: true });
  fs.renameSync(
    path.join(source, 'settings.json'),
    path.join(dotfiles, 'settings.json'),
  );
  fs.symlinkSync(
    path.join(dotfiles, 'settings.json'),
    path.join(source, 'settings.json'),
  );
  const before = snapshot(dotfiles);

  fs.mkdirSync(path.join(home, '.subconscious'), { recursive: true });
  const linked = path.join(home, '.subconscious', 'claude-code');
  fs.symlinkSync(dotfiles, linked);
  const { warnings } = prepareClaudeConfigDir({ dir: linked, home });
  assert.match(warnings.join('\n'), /refus/i);
  assert.deepEqual(snapshot(dotfiles), before);
});

test('a planted link at the subc settings file is replaced, never written through', () => {
  const { home, source, dir } = fakeHome();
  const before = snapshot(source);
  markSubcDir(dir);
  fs.symlinkSync(
    path.join(source, 'settings.json'),
    path.join(dir, 'settings.json'),
  );
  const { refused } = prepareClaudeConfigDir({ dir, home });
  assert.equal(refused, false);
  assert.equal(
    fs.lstatSync(path.join(dir, 'settings.json')).isSymbolicLink(),
    false,
  );
  assert.deepEqual(snapshot(source), before);
});

test('a dir that is the real target of a shared entry is refused', () => {
  const { home, source } = fakeHome();
  const dotSkills = path.join(home, 'dot', 'skills');
  fs.mkdirSync(path.dirname(dotSkills), { recursive: true });
  fs.renameSync(path.join(source, 'skills'), dotSkills);
  fs.symlinkSync(dotSkills, path.join(source, 'skills'));
  const before = snapshot(path.join(home, 'dot'));
  for (const dir of [dotSkills, path.join(dotSkills, 'nested')]) {
    const { refused, warnings } = prepareClaudeConfigDir({ dir, home });
    assert.equal(refused, true, dir);
    assert.match(warnings.join('\n'), /refus/i);
  }
  assert.deepEqual(snapshot(path.join(home, 'dot')), before);
});

test('a refused dir stops the launch', () => {
  const agent = agentById('claude-code');
  const { home, source } = fakeHome();
  const result = prepareClaudeLaunch(
    agent,
    { CLAUDE_CONFIG_DIR: source },
    {},
    { home, subcDir: source },
  );
  assert.equal(result.refused, true);
});

test('keyboard shortcuts are shared when the user has them', () => {
  const { home, source, dir } = fakeHome();
  fs.writeFileSync(path.join(source, 'keybindings.json'), '{"bindings":[]}');
  prepareClaudeConfigDir({ dir, home });
  assert.equal(
    fs.readlinkSync(path.join(dir, 'keybindings.json')),
    path.join(source, 'keybindings.json'),
  );
});

test('settings changed inside subc are saved aside and named before the next launch replaces them', () => {
  const { home, source, dir } = fakeHome({
    settings: { hooks: {}, permissions: { allow: ['Bash'] }, theme: 'dark' },
  });
  const userBefore = fs.readFileSync(path.join(source, 'settings.json'));
  let result = prepareClaudeConfigDir({ dir, home });
  assert.deepEqual(result.warnings, []);

  // Inside the session: a hook and a permission change, a /model pick, and a
  // key Claude Code itself removed.
  const file = path.join(dir, 'settings.json');
  const edited = {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
    permissions: { allow: ['Bash', 'Read'] },
    model: 'subconscious/glm',
  };
  fs.writeFileSync(file, JSON.stringify(edited));

  result = prepareClaudeConfigDir({ dir, home });
  const warning = result.warnings.join('\n');
  assert.match(warning, /hooks/);
  assert.match(warning, /permissions/);
  assert.doesNotMatch(warning, /model/, 'the model pick is kept, not lost');
  assert.doesNotMatch(warning, /theme/, 'a removed key is not reported');
  const saved = readJson(path.join(dir, 'settings.discarded.json'));
  assert.deepEqual(saved, edited);
  assert.match(warning, /settings\.discarded\.json/);
  if (process.platform !== 'win32') {
    assert.equal(
      fs.statSync(path.join(dir, 'settings.discarded.json')).mode & 0o777,
      0o600,
    );
  }
  assert.deepEqual(
    fs.readFileSync(path.join(source, 'settings.json')),
    userBefore,
  );

  // Nothing changed since: no warning.
  assert.deepEqual(prepareClaudeConfigDir({ dir, home }).warnings, []);
});

test('MCP servers added inside subc are saved aside and named', () => {
  const { home, dir } = fakeHome();
  prepareClaudeConfigDir({ dir, home });
  const file = path.join(dir, '.claude.json');
  const state = readJson(file);
  state.mcpServers = {
    ...state.mcpServers,
    notion: { type: 'http', url: 'https://n' },
  };
  state.projects['/work/app'].mcpServers = {
    db: { command: 'db-mcp' },
    pg: { command: 'pg' },
  };
  state.numStartups = 99;
  fs.writeFileSync(file, JSON.stringify(state));

  const warning = prepareClaudeConfigDir({ dir, home }).warnings.join('\n');
  assert.match(warning, /notion/);
  assert.match(warning, /pg/);
  assert.doesNotMatch(warning, /linear|db-mcp|numStartups/);
  const saved = readJson(path.join(dir, 'mcp.discarded.json'));
  assert.deepEqual(saved.mcpServers.notion, { type: 'http', url: 'https://n' });
  assert.deepEqual(prepareClaudeConfigDir({ dir, home }).warnings, []);
});

test('a first launch with an existing subc dir reports nothing it cannot compare', () => {
  const { home, dir } = fakeHome();
  markSubcDir(dir);
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ hooks: { x: 1 } }),
  );
  assert.deepEqual(prepareClaudeConfigDir({ dir, home }).warnings, []);
});

test('an enabled plugin missing from the index is copied, never linked, into the subc cache', () => {
  const { home, source, dir } = fakeHome({
    settings: {
      enabledPlugins: { 'v@m': true, 'off@m': false, '../x@m': true },
    },
  });
  const version = path.join(source, 'plugins', 'cache', 'm', 'v', 'abc123');
  fs.mkdirSync(path.join(version, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(version, '.mcp.json'), '{"mcpServers":{}}');
  fs.mkdirSync(path.join(source, 'plugins', 'cache', 'm', 'off', '1'), {
    recursive: true,
  });
  const before = snapshot(source);

  const { warnings } = prepareClaudeConfigDir({ dir, home });
  assert.deepEqual(warnings, []);
  const copy = path.join(dir, 'plugins', 'cache', 'm', 'v', 'abc123');
  assert.equal(fs.lstatSync(copy).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(path.join(copy, '.mcp.json'), 'utf8'),
    '{"mcpServers":{}}',
  );
  assert.equal(
    fs.existsSync(path.join(dir, 'plugins', 'cache', 'm', 'off')),
    false,
  );
  assert.equal(fs.existsSync(path.join(dir, 'plugins', 'cache', 'x')), false);

  // A session writing into its copy never reaches the user's plugin.
  fs.writeFileSync(path.join(copy, '.orphaned_at'), 'now');
  prepareClaudeConfigDir({ dir, home });
  assert.deepEqual(snapshot(source), before);
  assert.equal(
    fs.existsSync(path.join(copy, '.orphaned_at')),
    true,
    'an existing copy is not redone',
  );
});

test('a planted link in the subc plugin cache stops the copy', () => {
  const { home, source, dir } = fakeHome({
    settings: { enabledPlugins: { 'v@m': true } },
  });
  fs.mkdirSync(path.join(source, 'plugins', 'cache', 'm', 'v', 'abc'), {
    recursive: true,
  });
  markSubcDir(dir);
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.symlinkSync(
    path.join(source, 'plugins', 'cache'),
    path.join(dir, 'plugins', 'cache'),
  );
  const before = snapshot(source);
  const { warnings } = prepareClaudeConfigDir({ dir, home });
  assert.match(warnings.join('\n'), /link/);
  assert.deepEqual(snapshot(source), before);
});

test('links follow the source when it changes, and the old source is untouched', () => {
  const agent = agentById('claude-code');
  const { home, source, dir } = fakeHome();
  prepareClaudeLaunch(agent, { CLAUDE_CONFIG_DIR: dir }, {}, { home });
  assert.equal(
    fs.readlinkSync(path.join(dir, 'skills')),
    path.join(source, 'skills'),
  );
  const before = snapshot(source);

  const own = customConfig(home);
  prepareClaudeLaunch(
    agent,
    { CLAUDE_CONFIG_DIR: dir },
    { CLAUDE_CONFIG_DIR: own },
    { home },
  );
  assert.equal(
    fs.readlinkSync(path.join(dir, 'skills')),
    path.join(own, 'skills'),
  );
  // A link to an entry the new source lacks is not left pointing at the old one.
  assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
  assert.deepEqual(snapshot(source), before);
});

test('the opt-out never prepares, so a user-set dir is never treated as the subc dir', () => {
  const agent = agentById('claude-code');
  const { home } = fakeHome();
  const own = customConfig(home);
  fs.symlinkSync(path.join(own, 'skills'), path.join(home, 'skills-link'));
  const before = snapshot(own);
  const result = prepareClaudeLaunch(
    agent,
    { CLAUDE_CONFIG_DIR: own, CLAUDE_CODE_ISOLATE: 'off' },
    { CLAUDE_CONFIG_DIR: own },
    { home },
  );
  assert.deepEqual(result, { warnings: [], refused: false, env: {} });
  assert.deepEqual(snapshot(own), before);
});

test('only the subc dir itself is ever prepared', () => {
  const agent = agentById('claude-code');
  const { home } = fakeHome();
  const own = customConfig(home);
  const before = snapshot(own);
  // However the launch env came to point at the user's folder, it is not prepared.
  const result = prepareClaudeLaunch(
    agent,
    { CLAUDE_CONFIG_DIR: own },
    {},
    { home },
  );
  assert.equal(result.refused, false);
  assert.deepEqual(result.env, {});
  assert.deepEqual(snapshot(own), before);
});

test('a source that is not a Claude config folder gets nothing created in it', () => {
  const agent = agentById('claude-code');
  const { home, source, dir } = fakeHome();
  const typo = path.join(home, '.claude-wrk');
  const repo = path.join(home, 'code-repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  for (const own of [typo, repo]) {
    const before = fs.existsSync(own) ? snapshot(own) : undefined;
    const result = prepareClaudeLaunch(
      agent,
      { CLAUDE_CONFIG_DIR: dir },
      { CLAUDE_CONFIG_DIR: own },
      { home },
    );
    assert.match(result.warnings.join('\n'), /not a Claude config folder/, own);
    assert.deepEqual(result.env, { SUBC_CLAUDE_CONFIG_SOURCE: source });
    assert.deepEqual(
      fs.existsSync(own) ? snapshot(own) : undefined,
      before,
      own,
    );
  }
});

test('a Claude config folder at the subc path that subc did not make is refused', () => {
  const agent = agentById('claude-code');
  const { home } = fakeHome();
  const subcBase = path.join(home, 'base');
  const own = customConfig(home, path.join('base', 'claude-code'));
  const before = snapshot(own);
  const result = prepareClaudeLaunch(
    agent,
    { CLAUDE_CONFIG_DIR: own, SUBC_CONFIG_DIR: subcBase },
    { CLAUDE_CONFIG_DIR: own },
    { home },
  );
  assert.equal(result.refused, true);
  assert.match(result.warnings.join('\n'), /did not make/);
  assert.deepEqual(snapshot(own), before);
});

test('an empty existing dir is claimed as the subc dir', () => {
  const { home, dir } = fakeHome();
  fs.mkdirSync(dir, { recursive: true });
  const { refused } = prepareClaudeConfigDir({ dir, home });
  assert.equal(refused, false);
  assert.equal(fs.existsSync(path.join(dir, '.subc-written.json')), true);
});
