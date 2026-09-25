import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentList } from './agents.js';
import { DEFAULT_PLATFORM_URL, getApiKey, getPlatformUrl } from './auth.js';
import { isAbortError, normalizeModelIds, resolveModelCatalog } from './models.js';
import { discoverSessions, SESSION_HARNESSES } from './sessions.js';
import { compareVersions, fetchLatestVersion } from './update-check.js';
import {
  DEFAULT_PROFILE,
  listProfiles,
  loadProfile,
  resolvedModelSetting,
  RUNBOOK_DEFAULTS,
  SUPPORTED_MODELS as PACKAGED_MODELS,
} from './profiles.js';

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const TUI_SOURCE_DIR = path.resolve(BIN_DIR, '../tui');

export function nativeTargetName(platform = process.platform, arch = process.arch) {
  const goArch = { x64: 'amd64', arm64: 'arm64' }[arch];
  if (!goArch || !['darwin', 'linux', 'win32'].includes(platform)) return null;
  const goOS = platform === 'win32' ? 'windows' : platform;
  const extension = platform === 'win32' ? '.exe' : '';
  return `subc-tui-${goOS}-${goArch}${extension}`;
}

export function isTuiResult(result) {
  return (
    result !== null &&
    typeof result === 'object' &&
    (result.updatePrompt === true ||
      (Array.isArray(result.args) && result.args.every((arg) => typeof arg === 'string'))) &&
    (result.baseUrl === undefined || typeof result.baseUrl === 'string') &&
    (result.installedVersion === undefined || typeof result.installedVersion === 'string') &&
    (result.latestVersion === undefined || typeof result.latestVersion === 'string')
  );
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function tuiSourceIsNewerThan(binary, sourceFile = path.join(TUI_SOURCE_DIR, 'cmd/subc-tui/main.go')) {
  try {
    const [binaryStat, sourceStat] = await Promise.all([fs.stat(binary), fs.stat(sourceFile)]);
    return sourceStat.mtimeMs > binaryStat.mtimeMs;
  } catch {
    return false;
  }
}

function sourceTuiCommand() {
  return {
    command: 'go',
    args: ['run', './cmd/subc-tui'],
    cwd: TUI_SOURCE_DIR,
  };
}

export async function resolveTuiExecutable(options = {}) {
  const override = options.binary || process.env.SUBC_TUI_BIN?.trim();
  if (override) {
    return { command: override, args: options.binaryArgs || [], cwd: undefined };
  }

  const hasSource = await pathExists(path.join(TUI_SOURCE_DIR, 'go.mod'));
  const target = nativeTargetName(options.platform, options.arch);
  if (target) {
    const packaged = path.join(BIN_DIR, 'native', target);
    // Source checkouts keep a cached host binary for speed. If TUI source is
    // newer, that cache is stale (for example it will reject --updates).
    if (await pathExists(packaged) && !(hasSource && (await tuiSourceIsNewerThan(packaged)))) {
      return { command: packaged, args: [], cwd: undefined };
    }
  }

  // Source checkouts can run the TUI without committing native build output.
  // Published packages always contain a prebuilt platform binary.
  if (hasSource) return sourceTuiCommand();
  return null;
}

function selectedModelFor(profile) {
  return resolvedModelSetting(process.env.SUBCONSCIOUS_MODEL || profile.values.MODEL);
}

function subagentModelFor(profile) {
  return resolvedModelSetting(profile.values.CLAUDE_CODE_SUBAGENT_MODEL);
}

function gatewayFor(profile) {
  return (
    process.env.SUBCONSCIOUS_BASE_URL?.trim() ||
    profile.values.GATEWAY_URL?.trim() ||
    RUNBOOK_DEFAULTS.GATEWAY_URL
  ).replace(/\/+$/, '');
}

function platformFor(profile) {
  return getPlatformUrl(profile);
}

async function packageVersion() {
  const pkg = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8'),
  );
  return pkg.version;
}

function serializeSessions(sessions = []) {
  return sessions.map((session) => ({
    key: session.key,
    harness: session.harness,
    harnessName: session.harnessName,
    title: session.title,
    cwd: session.cwd,
    updatedAt: session.updatedAt,
    model: session.model,
    portable: session.portable,
  }));
}

function sessionHarnessList() {
  return Object.entries(SESSION_HARNESSES).map(([id, harness]) => ({
    id,
    name: harness.name,
    portable: harness.portable,
  }));
}

function agentMenuItems() {
  return agentList().map((agent) => ({
    command: agent.alias,
    name: agent.name,
    action: agent.action,
    description: agent.description,
    launch: agent.launch,
  }));
}

const ATOMIC_REPLACE_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replaceFile(tmp, file) {
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    if (!ATOMIC_REPLACE_CODES.has(error.code)) throw error;
    // Windows rejects a rename over a file another process still has open.
    await fs.rm(file, { force: true });
    await fs.rename(tmp, file);
  }
}

export async function writeAtomicJson(file, value) {
  const payload = `${JSON.stringify(value)}\n`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await fs.writeFile(tmp, payload, { mode: 0o600 });
      await replaceFile(tmp, file);
      return;
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      if (!ATOMIC_REPLACE_CODES.has(error.code) || attempt === 7) throw error;
      await delay(20 * (attempt + 1));
    }
  }
}

export async function createLocalTuiState(profileName = DEFAULT_PROFILE, options = {}) {
  const activeProfile = options.profile || (await loadProfile(profileName));
  const names = [...new Set([profileName, ...(await listProfiles())])].sort((a, b) => {
    if (a === profileName) return -1;
    if (b === profileName) return 1;
    return a.localeCompare(b);
  });
  const profiles = await Promise.all(
    names.map(async (name) => {
      const profile = name === profileName ? activeProfile : await loadProfile(name);
      const auth = await getApiKey(profile);
      return {
        name,
        model: selectedModelFor(profile),
        subagentModel: subagentModelFor(profile),
        authenticated: Boolean(auth?.key),
      };
    }),
  );

  const requestedModel = selectedModelFor(activeProfile);
  const gatewayUrl = gatewayFor(activeProfile);
  const platformUrl = platformFor(activeProfile);

  return {
    version: await packageVersion(),
    activeProfile: profileName,
    profilePath: activeProfile.path,
    profiles,
    models: normalizeModelIds([requestedModel, ...PACKAGED_MODELS], requestedModel),
    selectedModel: requestedModel,
    subagentModel: subagentModelFor(activeProfile),
    gatewayUrl,
    savedGatewayUrl:
      activeProfile.values.GATEWAY_URL?.trim().replace(/\/+$/, '') ||
      RUNBOOK_DEFAULTS.GATEWAY_URL,
    gatewayOverridden: Boolean(process.env.SUBCONSCIOUS_BASE_URL?.trim()),
    platformUrl,
    savedPlatformUrl:
      activeProfile.values.PLATFORM_URL?.trim().replace(/\/+$/, '') || DEFAULT_PLATFORM_URL,
    platformOverridden: Boolean(process.env.SUBCONSCIOUS_URL?.trim()),
    modelError: '',
    modelSource: 'packaged',
    modelsLoading: true,
    sessionsLoading: true,
    sessions: [],
    sessionHarnesses: sessionHarnessList(),
    agents: agentMenuItems(),
    updateAvailable: false,
    latestVersion: '',
  };
}

function whenAborted(signal) {
  return new Promise((_, reject) => {
    const fail = () => {
      const error = new Error('cancelled');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}

async function raceAbort(signal, promise) {
  if (!signal) return promise;
  return Promise.race([promise, whenAborted(signal)]);
}

export async function loadRemoteTuiUpdates(state, options = {}) {
  const signal = options.signal;
  const writePatch = options.writePatch || (async () => {});
  const resolveCatalog = options.resolveCatalog || resolveModelCatalog;
  const discover = options.discoverSessions || discoverSessions;
  const fetchLatest = options.fetchLatestVersion || fetchLatestVersion;
  const readApiKey = options.getApiKey || getApiKey;
  const updateDisabled =
    options.disableUpdateCheck ?? process.env.SUBC_DISABLE_UPDATE_CHECK?.trim() === '1';

  const tasks = [
    (async () => {
      const profile = options.profile || (await loadProfile(state.activeProfile));
      if (signal?.aborted) return;
      const auth = await readApiKey(profile);
      if (signal?.aborted) return;
      const catalog = await resolveCatalog({
        baseUrl: state.gatewayUrl,
        apiKey: auth?.key,
        selectedModel: state.selectedModel,
        fallbackModels: PACKAGED_MODELS,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        signal,
      });
      if (signal?.aborted) return;
      await writePatch({
        models: catalog.models,
        modelError: catalog.error?.message || '',
        modelSource: catalog.source,
        modelsLoading: false,
      });
    })(),
    (async () => {
      const sessions = await raceAbort(
        signal,
        discover({
          max: options.maxSessions || 500,
          home: options.home,
          roots: options.roots,
          indexes: options.indexes,
          execute: options.execute,
          signal,
        }),
      );
      if (signal?.aborted) return;
      await writePatch({
        sessions: serializeSessions(sessions),
        sessionsLoading: false,
      });
    })(),
  ];

  if (!updateDisabled) {
    tasks.push(
      (async () => {
        try {
          const latest = await fetchLatest({
            fetchImpl: options.updateFetchImpl || options.fetchImpl,
            timeoutMs: options.updateTimeoutMs,
            signal,
          });
          if (signal?.aborted || !latest) return;
          if (compareVersions(latest, state.version) > 0) {
            await writePatch({ updateAvailable: true, latestVersion: latest });
          }
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) return;
        }
      })(),
    );
  }

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    if (isAbortError(result.reason) || signal?.aborted) continue;
    throw result.reason;
  }
}

export async function createTuiState(profileName = DEFAULT_PROFILE, options = {}) {
  const state = await createLocalTuiState(profileName, options);
  let next = { ...state };
  await loadRemoteTuiUpdates(state, {
    ...options,
    writePatch: async (partial) => {
      next = { ...next, ...partial };
    },
  });
  return next;
}

function spawnAndWait(command, args, options = {}) {
  const spawnImpl = options.spawn || spawn;
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.stdio ?? 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Subconscious TUI exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export async function runTui(options = {}) {
  const executable = await resolveTuiExecutable(options);
  if (!executable) return null;

  const providedState = options.state;
  const state = providedState || (await createLocalTuiState(options.profileName, options));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-tui-'));
  const statePath = path.join(tempDir, 'state.json');
  const resultPath = path.join(tempDir, 'result.json');
  const updatesPath = path.join(tempDir, 'updates.json');
  const controller = new AbortController();

  let patch = {};
  const writePatch = async (partial) => {
    if (controller.signal.aborted) return;
    patch = { ...patch, ...partial };
    try {
      await writeAtomicJson(updatesPath, patch);
    } catch {
      // The TUI may have already exited and removed the working directory.
    }
  };

  const remote = providedState
    ? Promise.resolve()
    : loadRemoteTuiUpdates(state, { ...options, signal: controller.signal, writePatch });

  try {
    // This state intentionally contains only display data. API keys are used
    // by the Node command engine and are never passed into the TUI process.
    await fs.writeFile(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    const code = await spawnAndWait(
      executable.command,
      [...executable.args, '--state', statePath, '--result', resultPath, '--updates', updatesPath],
      { cwd: executable.cwd, spawn: options.spawn, stdio: options.stdio },
    );
    controller.abort();
    await remote.catch(() => {});
    if (code !== 0) throw new Error(`Subconscious TUI exited with status ${code}`);

    try {
      const result = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
      return isTuiResult(result) ? result : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  } catch (error) {
    controller.abort();
    await remote.catch(() => {});
    throw error;
  } finally {
    controller.abort();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
