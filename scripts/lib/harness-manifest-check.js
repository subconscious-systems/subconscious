export const MANIFEST_FILE = 'bin/harness-manifest.generated.json';
export const OPT_OUT_TRAILER = 'Harness-Manifest: unchanged';

const RUNBOOK_AGENT_FILE = /^bin\/runbook\/[^/]+\/.+/;
const OPT_OUT_LINE = /^\s*harness-manifest:\s*unchanged\s*$/im;

export function runbookChanges(changedFiles) {
  return changedFiles.filter((file) => RUNBOOK_AGENT_FILE.test(file));
}

export function checkHarnessManifestChange({ changedFiles, messages }) {
  const runbookFiles = runbookChanges(changedFiles);
  if (runbookFiles.length === 0) {
    return { ok: true, runbookFiles, message: 'No runbook changes.' };
  }
  if (changedFiles.includes(MANIFEST_FILE)) {
    return { ok: true, runbookFiles, message: 'Harness manifest updated.' };
  }
  if (messages.some((text) => OPT_OUT_LINE.test(text))) {
    return {
      ok: true,
      runbookFiles,
      message: `Runbooks changed; manifest marked unchanged by "${OPT_OUT_TRAILER}".`,
    };
  }
  return {
    ok: false,
    runbookFiles,
    message: [
      'These runbook files changed, but the harness manifest did not:',
      ...runbookFiles.map((file) => `  ${file}`),
      '',
      'Update the agent\'s "harness" block in agents/registry.json and run',
      '`npm run generate`. If the change cannot affect how the harness is',
      'installed, configured, or launched (a comment, a log line), add this',
      'line to a commit message or the PR description instead:',
      '',
      `  ${OPT_OUT_TRAILER}`,
    ].join('\n'),
  };
}
