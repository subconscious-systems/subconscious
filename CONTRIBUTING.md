# Contributing

This repository is the `subc` CLI, published as `subconscious-cli`.

## Prerequisites

- Node.js 18 or newer. CI uses Node 22.
- Go, because `npm run test:tui` and `prepack` build the native TUI.

## Setup

From the repository root:

```bash
npm install
```

`npm install` runs the `prepare` script, which installs the git `commit-msg` hook. If a checkout skipped lifecycle scripts, install the hook yourself:

```bash
npm run prepare
```

## Commit messages

Every commit subject must be a [conventional commit](https://www.conventionalcommits.org/) that Release Please understands:

```text
<type>: <subject>
<type>(<scope>): <subject>
```

Allowed types:

| Type | npm release |
| --- | --- |
| `feat` | minor |
| `fix` | patch |
| `perf` | patch |
| `revert` | patch |
| `refactor` | none |
| `docs` | none |
| `test` | none |
| `build` | none |
| `ci` | none |
| `chore` | none |

`docs:`, `chore:`, and `ci:` do not cut an npm release. `feat:`, `fix:`, and `perf:` do. A scope is optional, as in `fix(cli): accept arrow keys in the base URL prompt`.

The hook rejects any other subject. The same rules run in CI on every commit in the pull request, so `--no-verify` still fails in review.

## Do not edit by hand

- `package.json` `version`
- `CHANGELOG.md`
- `bin/registry.generated.json`
- `bin/runbook/model-capabilities.generated.sh`

Release Please updates the version and changelog when its release pull request merges. After editing `agents/registry.json`, regenerate:

```bash
npm run generate
```

## Checks before a pull request

```bash
npm test
npm run test:tui
```

Windows verification is described in [WINDOWS_TESTING.md](WINDOWS_TESTING.md). Run `npm run test:windows` there.

Open one pull request per change. `main` accepts changes only through a pull request. Do not bump the version yourself.

## Publishing

Merging to `main` updates the Release Please pull request. Merging that pull request tags `vX.Y.Z` and publishes `subconscious-cli` to npm. Laptop `npm publish` is refused.

## Maintainers: protect main

`main` is covered by the repository ruleset `Protect main` (ruleset `24016657`). It requires a pull request, blocks force pushes, and requires the status checks below. The bypass list is empty until a maintainer adds the GitHub user that owns `RELEASE_GITHUB_TOKEN`. That user should be the only bypass, so Release Please can update its release pull request. Do not add a broader bypass.

Required status checks, matching the job names GitHub reports:

- `windows (20)`
- `windows (22)`
- `windows (24)`
- `unix (ubuntu-latest)`
- `unix (macos-latest)`
- `commitlint`

Also require a pull request before merging, and block force pushes.

Repository secrets, both supplied by a maintainer:

- `RELEASE_GITHUB_TOKEN`: a fine-grained or classic PAT that can open pull requests and push to `main` for the release user.
- `NPM_TOKEN`: an npm automation token with publish access to `subconscious-cli`.

`create-subconscious-app` is no longer published from this repo. Deprecate it on npm. Do not unpublish it:

```bash
npm deprecate create-subconscious-app "No longer maintained. Use the subc CLI: npm install -g subconscious-cli"
```
