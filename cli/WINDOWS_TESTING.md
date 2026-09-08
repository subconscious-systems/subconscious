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
- Tested native release ZIP extraction, replacement of an existing executable,
  checksum rejection, and rejection of archives missing a root `sc.exe`.
  Archive tests use an inert fixture, not a working Subconscious Code binary.

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
- Nothing was published or tagged. The Windows-only candidate npm archive is a
  local test artifact, not the full cross-platform release package.
- A native Windows x64 `sc.exe` candidate was built in the sibling
  `subconscious-code` repository using Rust 1.98.1 and MSVC, with a static CRT.
  PE dependency inspection found Windows system DLLs only, not the VC++ runtime.
  Its ZIP and SHA-256 file were installed using the real Windows installer;
  only GitHub metadata/download responses were substituted with local artifacts.
  The installed `subc sc --version` wrapper and native interactive TUI launch/quit
  passed. A real PowerShell tool call through a local mock streaming gateway
  passed, including tool-result replay, API-key filtering, and USERPROFILE-based
  global memory without HOME. No Windows release has been published yet.
- The separate shell backend passed its 12 targeted tests on built-in Windows
  PowerShell 5.1, then on PowerShell 7.6.5 with Git Bash 5.3.15 installed as an
  explicit alternative. PowerShell is the Windows default; Git Bash is optional.
- Subconscious Code's full native Windows workspace test run passed: 553 tests,
  0 failures, 3 pre-existing ignored benchmarks. Formatting and full-workspace
  Clippy checks passed with warnings denied. The local x64 release candidate is
  `sc 0.1.3+windows-local-20260908`; its downloaded ZIP checksum was verified.

The Go test's Unix `0600` permission assertion is retained on Unix; Windows runs
the same profile-content checks without treating ACLs as Unix mode bits. Existing
Unix runbook source files were not changed.
