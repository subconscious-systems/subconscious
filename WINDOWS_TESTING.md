# Native Windows verification

Verified on 2026-09-08 using the supplied Windows x64 VM over SSH.
All test execution and the TUI build below ran on Windows, not under WSL.

## Results

- Windows 10.0.26100.1742, Windows PowerShell 5.1.
- `npm run test:windows`: 76 passed, 0 failed, 0 skipped on each of
  Node 20.20.2, 22.23.2, and 24.20.0.
- `npm run test:tui`: passed with Go 1.27.1.
- `npm run build:tui:host`: produced `subc-tui-windows-amd64.exe` on the VM.
- Packed and globally installed the candidate `subconscious-cli@4.1.0`.
  Verified version, help, empty profile listing, agent help, and unauthenticated
  `whoami`. Opened the installed native TUI and exited with `q`.

Installed real agent packages and exercised them through `subc`:

| Agent | Verified launch |
| --- | --- |
| Claude Code 2.1.263 | `subc claude --version`; print-mode round-trip to a local mock Messages gateway |
| Codex 0.153.4 | `subc codex --version` |
| OpenCode 1.18.29 | `subc opencode --version` |
| Pi 0.73.1 | `subc pi --version`, including Windows integration setup |
| DeepSeek Harness | `subc dsh web --help` after a real npm installation |

Claude's native installer placed `claude.exe` in the system-profile `.local\bin`
directory. The Windows launcher discovered it successfully. The mock-gateway
round-trip succeeded with neither Bash nor Git installed. Only dummy credentials
were used; temporary mock profiles were removed afterward.

## Boundaries

- Browser login was intentionally skipped because it is unavailable on this VM.
- No paid inference or real gateway credentials were used. Other agents' version
  and help checks do not establish full inference/session compatibility.
- Cursor/Copilot configuration and hooks are covered by automated tests, not
  interactive IDE testing. ARM64 runtime execution was not tested.
- These VM results describe the local candidate before publication. The
  Windows-only candidate npm archive is a local test artifact, not the full
  cross-platform release package.

The Go test's Unix `0600` permission assertion is retained on Unix; Windows runs
the same profile-content checks without treating ACLs as Unix mode bits. Existing
Unix runbook source files were not changed.
