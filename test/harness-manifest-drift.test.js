import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_HARD_IMAGE_MIB,
  DEFAULT_SOFT_IMAGE_MIB,
} from '../bin/runbook/image-window/window.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNBOOK_DIR = path.join(ROOT, 'bin', 'runbook');
const manifest = JSON.parse(
  readFileSync(
    path.join(ROOT, 'bin', 'harness-manifest.generated.json'),
    'utf8',
  ),
);
const harnesses = Object.values(manifest.harnesses);

// Variables every runbook receives from subc, so a default that falls back to
// one of them is reported as the placeholder rather than an empty string.
const RUNBOOK_TOKENS = {
  MODEL: '{model}',
  GATEWAY_URL: '{baseUrl}',
  API_KEY: '{apiKey}',
  SUBCONSCIOUS_MODELS: '{catalog}',
  HOME: '~',
};
// A command substitution stands in for a document the manifest describes
// separately, so it matches any of these placeholders.
const COMMAND = '{command}';
const COMMAND_PLACEHOLDERS = new Set([
  '{tempFile}',
  '{json}',
  '{claudeSettings}',
]);

function readRunbook(relative) {
  return readFileSync(path.join(RUNBOOK_DIR, relative), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
}

function withoutComments(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function harnessFiles(harness) {
  const dir = path.join(RUNBOOK_DIR, harness.runbook.dir);
  return readdirSync(dir)
    .map((file) => readRunbook(path.join(harness.runbook.dir, file)))
    .join('\n');
}

function closingBrace(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth++;
    if (text[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

// Evaluates the defaults a bash script assigns, assuming no optional input is
// set. Covers only the parameter forms the runbooks use.
function shellEvaluator(text, inputs) {
  const source = withoutComments(text);
  const assignment = (name) =>
    source.match(
      new RegExp(`^\\s*(?:local\\s+)?${name}="([^"\\n]*)"`, 'm'),
    )?.[1];

  const variable = (name, depth) => {
    if (name in RUNBOOK_TOKENS) return RUNBOOK_TOKENS[name];
    if (inputs.has(name)) return inputs.get(name);
    const value = assignment(name);
    return value === undefined
      ? `{unknown:${name}}`
      : evaluate(value, depth + 1);
  };

  const parameter = (body, depth) => {
    const [, name, operator, rest] = body.match(
      /^([A-Za-z_][A-Za-z0-9_]*)(:-|-|%\/)?([\s\S]*)$/,
    );
    if (operator === ':-' || operator === '-') {
      return name in RUNBOOK_TOKENS
        ? RUNBOOK_TOKENS[name]
        : evaluate(rest, depth + 1);
    }
    return variable(name, depth);
  };

  const evaluate = (expression, depth = 0) => {
    if (depth > 10) return '{cycle}';
    let out = '';
    let index = 0;
    while (index < expression.length) {
      if (expression.startsWith('$(', index)) {
        const close = expression.indexOf(')', index);
        const picker = expression
          .slice(index + 2, close)
          .match(/^picker_model_at (\d+)$/);
        out += picker ? `{catalog[${picker[1]}]}` : COMMAND;
        index = close + 1;
        continue;
      }
      if (expression.startsWith('${', index)) {
        const close = closingBrace(expression, index + 1);
        out += parameter(expression.slice(index + 2, close), depth);
        index = close + 1;
        continue;
      }
      const bare = expression.slice(index).match(/^\$([A-Za-z_]\w*)/);
      if (bare) {
        out += variable(bare[1], depth);
        index += bare[0].length;
        continue;
      }
      out += expression[index++];
    }
    return out;
  };

  const defaultsOf = (name) => {
    const found = [];
    const pattern = new RegExp(`\\$\\{${name}(:-|-)`, 'g');
    for (const match of source.matchAll(pattern)) {
      const open = match.index + 1;
      const body = source.slice(open + 1, closingBrace(source, open));
      found.push(evaluate(body.slice(name.length + match[1].length)));
    }
    return found;
  };

  return { source, evaluate, defaultsOf };
}

function normalize(value) {
  return String(value).replaceAll('{baseUrl}/v1', '{baseUrlV1}');
}

function assertSameValue(actual, expected, message) {
  if (actual === COMMAND && COMMAND_PLACEHOLDERS.has(String(expected))) return;
  assert.equal(normalize(actual), normalize(expected), message);
}

function inputMap(harness) {
  return new Map(harness.inputs.map((input) => [input.name, input.default]));
}

function unquote(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) return value.slice(1, value.lastIndexOf('"'));
  return value.split(/\s/)[0];
}

function configEntry(harness, ref) {
  return harness.config.find(
    (entry) => entry.path === ref || entry.name === ref,
  );
}

// Config values use dotted keys for nested fields, so a knob name either is a
// key or starts with one and continues into its object.
function configValue(entry, name) {
  const key = Object.keys(entry.value || {})
    .filter(
      (candidate) => name === candidate || name.startsWith(`${candidate}.`),
    )
    .sort((a, b) => b.length - a.length)[0];
  if (key === undefined) return undefined;
  return name
    .slice(key.length)
    .split('.')
    .filter(Boolean)
    .reduce((value, segment) => value?.[segment], entry.value[key]);
}

test('drift: input defaults match the runbook source', () => {
  for (const harness of harnesses) {
    const inputs = inputMap(harness);
    for (const input of harness.inputs) {
      const text = readRunbook(input.source);
      assert.match(
        text,
        new RegExp(`\\b${input.name}\\b`),
        `${harness.id}: ${input.name} is not in ${input.source}`,
      );
      if (!input.source.endsWith('.sh')) continue;
      const defaults = shellEvaluator(text, inputs).defaultsOf(input.name);
      assert.ok(
        defaults.map(normalize).includes(normalize(input.default)),
        `${harness.id}: ${input.name} default ${JSON.stringify(input.default)} is not one of ${JSON.stringify(defaults)} in ${input.source}`,
      );
    }
  }
});

test('drift: image window defaults match window.js', () => {
  const expected = {
    SUBCONSCIOUS_IMAGE_WINDOW_SOFT_MIB: String(DEFAULT_SOFT_IMAGE_MIB),
    SUBCONSCIOUS_IMAGE_WINDOW_HARD_MIB: String(DEFAULT_HARD_IMAGE_MIB),
  };
  for (const harness of harnesses) {
    for (const input of harness.inputs) {
      if (input.name in expected)
        assert.equal(input.default, expected[input.name], harness.id);
    }
  }
});

test('drift: every run.sh export is in the manifest with the same value', () => {
  for (const harness of harnesses) {
    const script = harness.runbook.launch;
    if (!script) continue;
    const shell = shellEvaluator(readRunbook(script), inputMap(harness));
    const exported = new Map(
      [...shell.source.matchAll(/^\s*export ([A-Z_][A-Z0-9_]*)=(.*)$/gm)].map(
        ([, name, raw]) => [name, shell.evaluate(unquote(raw))],
      ),
    );
    const declared = harness.env.filter((entry) => entry.source === script);
    assert.deepEqual(
      declared.map((entry) => entry.name).sort(),
      [...exported.keys()].sort(),
      `${harness.id}: manifest env differs from the exports in ${script}`,
    );
    for (const entry of declared) {
      assertSameValue(
        exported.get(entry.name),
        entry.value,
        `${harness.id}: ${entry.name}`,
      );
    }
    for (const entry of harness.env) {
      assert.equal(entry.source, script, `${harness.id}: ${entry.name}`);
    }
  }
});

test('drift: launch argv matches the command run.sh executes', () => {
  for (const harness of harnesses) {
    const script = harness.runbook.launch;
    if (!script) continue;
    const flat = withoutComments(readRunbook(script))
      .replace(/\\\n\s*/g, ' ')
      .replace(/\s+/g, ' ');
    for (const argv of [harness.launch.argv, harness.launch.headless_argv]) {
      if (!argv) continue;
      const prefix = argv.slice(
        0,
        argv.findIndex((part) => part.includes('{')),
      );
      assert.ok(
        flat.includes(prefix.join(' ')),
        `${harness.id}: ${prefix.join(' ')} is not run by ${script}`,
      );
    }
  }
});

test('drift: Codex -c overrides match run.sh exactly', () => {
  const codex = manifest.harnesses.codex;
  const shell = shellEvaluator(readRunbook('codex/run.sh'), inputMap(codex));
  const actual = new Map(
    [
      ...shell.source.matchAll(
        /(?:^|[\s(])-c ([A-Za-z_.]+)=("[^"]*"|[^\s)]+)/g,
      ),
    ].map(([, key, raw]) => [key, shell.evaluate(unquote(raw))]),
  );
  const declared = codex.config.filter((entry) => entry.kind === 'cli-config');
  assert.deepEqual(
    declared.map((entry) => entry.name).sort(),
    [...actual.keys()].sort(),
  );
  for (const entry of declared) {
    assertSameValue(actual.get(entry.name), entry.value, entry.name);
  }
});

test('drift: compaction knobs subc sets match the runbook by full name and value', () => {
  for (const harness of harnesses) {
    const sources = harnessFiles(harness);
    const inputs = inputMap(harness);
    for (const [mode, knob] of Object.entries(
      harness.capabilities.compaction,
    )) {
      if (typeof knob !== 'object' || !knob?.set_by_subc) continue;
      const where = `${harness.id} compaction.${mode}`;
      if (knob.kind === 'env' || knob.kind === 'model-catalog-field') {
        assert.match(sources, new RegExp(`\\b${knob.name}\\b`), where);
      } else {
        for (const segment of knob.name.split('.')) {
          const literal = segment.replace('[]', '');
          if (literal.startsWith('<')) continue;
          assert.match(
            sources,
            new RegExp(`\\b${literal}\\b`),
            `${where}: ${segment}`,
          );
        }
      }
      if (knob.config) {
        const entry = configEntry(harness, knob.config);
        assert.ok(entry, `${where}: no config entry ${knob.config}`);
        assert.equal(configValue(entry, knob.name), knob.value, where);
      }
      const input = (knob.override || []).find((name) => inputs.has(name));
      assert.ok(
        input,
        `${where}: no input in override to check the value against`,
      );
      assert.equal(String(knob.value), inputs.get(input), `${where}: ${input}`);
    }
    if (harness.capabilities.compaction.threshold.set_by_subc) {
      assert.ok(
        ['window', 'trigger'].includes(
          harness.capabilities.compaction.threshold.semantics,
        ),
        `${harness.id}: threshold semantics`,
      );
    }
  }
});

test('drift: config payload values match their input defaults', () => {
  const cases = [
    [
      'opencode',
      'OPENCODE_CONFIG_CONTENT',
      'provider.subconscious.models.<id>.limit.context',
      'OPENCODE_CONTEXT_LIMIT',
    ],
    [
      'opencode',
      'OPENCODE_CONFIG_CONTENT',
      'provider.subconscious.models.<id>.limit.output',
      'OPENCODE_OUTPUT_LIMIT',
    ],
    [
      'pi',
      '~/.pi/agent/models.json',
      'providers.subconscious.models[].contextWindow',
      'PI_CONTEXT_WINDOW',
    ],
    [
      'pi',
      '~/.pi/agent/models.json',
      'providers.subconscious.models[].maxTokens',
      'PI_MAX_TOKENS',
    ],
    [
      'deepseek-harness',
      '{tmp}/subc-dsh.XXXXXX/subconscious.cordis.yml',
      'llm-pi-ai.providers.subconscious.defaultContextWindow',
      'DEEPSEEK_HARNESS_CONTEXT_WINDOW',
    ],
    [
      'deepseek-harness',
      '{tmp}/subc-dsh.XXXXXX/subconscious.cordis.yml',
      'llm-pi-ai.providers.subconscious.models[].contextWindow',
      'DEEPSEEK_HARNESS_CONTEXT_WINDOW',
    ],
    [
      'deepseek-harness',
      '{tmp}/subc-dsh.XXXXXX/subconscious.cordis.yml',
      'llm-pi-ai.providers.subconscious.defaultMaxTokens',
      'DEEPSEEK_HARNESS_MAX_TOKENS',
    ],
    [
      'copilot',
      '<VS Code user dir>/chatLanguageModels.json',
      'models.<id>.maxInputTokens',
      'COPILOT_MAX_INPUT_TOKENS',
    ],
    [
      'copilot',
      '<VS Code user dir>/chatLanguageModels.json',
      'models.<id>.maxOutputTokens',
      'COPILOT_MAX_OUTPUT_TOKENS',
    ],
    [
      'codex',
      '{tmp}/codex-model-catalog.XXXXXX.json',
      'context_window',
      'CODEX_CONTEXT_WINDOW',
    ],
    [
      'codex',
      '{tmp}/codex-model-catalog.XXXXXX.json',
      'auto_compact_token_limit',
      'CODEX_AUTO_COMPACT_TOKEN_LIMIT',
    ],
    [
      'codex',
      '{tmp}/codex-model-catalog.XXXXXX.json',
      'multi_agent_version',
      'CODEX_MULTI_AGENT_VERSION',
    ],
  ];
  for (const [id, ref, name, inputName] of cases) {
    const harness = manifest.harnesses[id];
    const entry = configEntry(harness, ref);
    assert.ok(entry, `${id}: ${ref}`);
    assert.equal(
      String(configValue(entry, name)),
      inputMap(harness).get(inputName),
      `${id}: ${name} vs ${inputName}`,
    );
  }
});

test('drift: headers, hooks, and config files appear in the runbook', () => {
  for (const harness of harnesses) {
    const sources = harnessFiles(harness);
    const lower = sources.toLowerCase();
    for (const header of harness.capabilities.headers) {
      if (!header.set_by_subc) continue;
      assert.ok(
        lower.includes(header.name.toLowerCase()),
        `${harness.id}: ${header.name}`,
      );
      if (header.name === 'x-subconscious-client') {
        assert.match(
          sources,
          new RegExp(
            `"?x-subconscious-client"?\\s*:\\s*"?'?${header.value}\\b`,
          ),
          `${harness.id}: x-subconscious-client ${header.value}`,
        );
      }
      if (header.name === 'Authorization') {
        assert.ok(sources.includes('Bearer '), `${harness.id}: Bearer`);
      }
    }
    for (const hook of harness.capabilities.hooks) {
      assert.ok(sources.includes(hook.event), `${harness.id}: ${hook.event}`);
    }
    for (const file of harness.config) {
      if (file.kind !== 'file' && file.kind !== 'dir') continue;
      const stem = path
        .basename(file.path)
        .replace('XXXXXX', '')
        .split('..')[0];
      assert.ok(sources.includes(stem), `${harness.id}: ${file.path}`);
    }
    for (const prerequisite of harness.prerequisites) {
      for (const command of prerequisite.command.split('|')) {
        assert.match(
          sources,
          new RegExp(`\\b${command}\\b`),
          `${harness.id}: ${command}`,
        );
      }
    }
  }
});
