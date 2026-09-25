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

`main` is covered by the repository ruleset `Protect main` (ruleset `24016657`). It requires a pull request, blocks force pushes, and requires the status checks below. Release Please pushes its own branch and a person merges that pull request, so the token user does not need a bypass on `main`.

Required status checks, matching the job names GitHub reports:

- `windows (20)`
- `windows (22)`
- `windows (24)`
- `unix (ubuntu-latest)`
- `unix (macos-latest)`
- `commitlint`

Also require a pull request before merging, and block force pushes.

Repository secret, supplied by a maintainer:

- `RELEASE_GITHUB_TOKEN`: a fine-grained PAT for `subconscious-systems/subconscious` with Contents read and write, and Pull requests read and write. Metadata read is included automatically.

npm publish uses [trusted publishing](https://docs.npmjs.com/trusted-publishers), not a long-lived token. On the `subconscious-cli` package settings, add one GitHub Actions trusted publisher:

- Organization or user: `subconscious-systems`
- Repository: `subconscious`
- Workflow filename: `release-please.yaml`
- Environment name: leave empty
- Allowed actions: allow direct `npm publish`

After a publish succeeds, set the package's publishing access to require two-factor authentication and disallow tokens.
