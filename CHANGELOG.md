# Changelog

## [6.1.0](https://github.com/subconscious-systems/subconscious/compare/v6.0.1...v6.1.0) (2026-10-05)


### Features

* publish a machine-readable harness manifest ([#104](https://github.com/subconscious-systems/subconscious/issues/104)) ([ca1b02c](https://github.com/subconscious-systems/subconscious/commit/ca1b02ce2eabe8252808b5256de3a92ccedd8e62))
* trim screenshots before upload in Pi and OpenCode (SUBCON-678) ([#95](https://github.com/subconscious-systems/subconscious/issues/95)) ([15306e6](https://github.com/subconscious-systems/subconscious/commit/15306e6e65830ce411c09a6d1653d7193b8dc7ec))


### Bug fixes

* **clipboard:** read JPEG images from Linux clipboards ([#122](https://github.com/subconscious-systems/subconscious/issues/122)) ([514deaa](https://github.com/subconscious-systems/subconscious/commit/514deaaaaf00c595ec23722171ba3a4f23364eb6))
* **config:** stop redacting token budget settings ([#98](https://github.com/subconscious-systems/subconscious/issues/98)) ([036841f](https://github.com/subconscious-systems/subconscious/commit/036841f6725e4f65a8b103bf4383acbc36ff9c6d))
* **copilot:** preserve user config and quote hook paths ([#116](https://github.com/subconscious-systems/subconscious/issues/116)) ([0668cd8](https://github.com/subconscious-systems/subconscious/commit/0668cd889cf964c163bae3d9f2bb10d4ce87baff))
* **cursor:** quote hook executable paths and escape JSON ([df4d220](https://github.com/subconscious-systems/subconscious/commit/df4d2205029d5710ed949a1ae0bffb07be881aeb))
* **cursor:** quote hook executable paths and escape JSON ([6a155cb](https://github.com/subconscious-systems/subconscious/commit/6a155cb2efdf35a1fd116b6481c2bedee909018b))
* **feedback:** reject missing option values ([#111](https://github.com/subconscious-systems/subconscious/issues/111)) ([2cad416](https://github.com/subconscious-systems/subconscious/commit/2cad4161887f83a2525cba6ef985d40d85b66801))
* keep ~/.codex/hooks.json when the hook merge fails ([#105](https://github.com/subconscious-systems/subconscious/issues/105)) ([27d3903](https://github.com/subconscious-systems/subconscious/commit/27d3903f3dcb48c29347dc3cb087f0d5323abde2))
* **models:** bound response body reads by discovery timeout ([#109](https://github.com/subconscious-systems/subconscious/issues/109)) ([52c4194](https://github.com/subconscious-systems/subconscious/commit/52c41947f55309b1f6312d5dcdcdb6a3c18ed6ad))
* **pi:** load compaction credentials from the configured agent directory ([#118](https://github.com/subconscious-systems/subconscious/issues/118)) ([a3cca6c](https://github.com/subconscious-systems/subconscious/commit/a3cca6c819fe45686bbb04e98e1cb71b30903e21))
* **sessions:** ignore non-object JSONL records ([#110](https://github.com/subconscious-systems/subconscious/issues/110)) ([27e45f5](https://github.com/subconscious-systems/subconscious/commit/27e45f538aab8f962009a4557dde929b96ab9c9d))
* **tui:** reload complete state when switching profiles ([#113](https://github.com/subconscious-systems/subconscious/issues/113)) ([687a736](https://github.com/subconscious-systems/subconscious/commit/687a7367aa17d8986a3e9a3bcdddfb889e057a0a))
* **update-check:** order prerelease identifiers by ASCII ([#97](https://github.com/subconscious-systems/subconscious/issues/97)) ([75d0675](https://github.com/subconscious-systems/subconscious/commit/75d06750ca27acfbc00458e71a14f93066678ec7))
* **upgrade:** use semver precedence when comparing versions ([#96](https://github.com/subconscious-systems/subconscious/issues/96)) ([6044967](https://github.com/subconscious-systems/subconscious/commit/604496718660da2bed40930a9c1d3e0e914fe03b))
* **usage:** round token counts to significant figures before choosing K/M/B ([#85](https://github.com/subconscious-systems/subconscious/issues/85)) ([281e995](https://github.com/subconscious-systems/subconscious/commit/281e99544d2dbbf4ac15be8ec72f2a48ddf1d98e))
* **whoami:** stop reporting server errors as an invalid key ([#101](https://github.com/subconscious-systems/subconscious/issues/101)) ([ab28d82](https://github.com/subconscious-systems/subconscious/commit/ab28d82ef80bec660bbeea2f18a47a5b18e39a16))

## [6.0.1](https://github.com/subconscious-systems/subconscious/compare/v6.0.0...v6.0.1) (2026-09-28)


### Bug fixes

* list the accepted editors in subc config edit errors ([ec31b2f](https://github.com/subconscious-systems/subconscious/commit/ec31b2f7dedd1a1953fcdedd4eb8e843dc1df8ec)), closes [#83](https://github.com/subconscious-systems/subconscious/issues/83)

## [6.0.0](https://github.com/subconscious-systems/subconscious/compare/v5.0.3...v6.0.0) (2026-09-25)


### ⚠ BREAKING CHANGES

* **cli:** replace localhost login with device codes

### Features

* --max-subagents and --subagent-effort, so a run can say what it needs ([164c993](https://github.com/subconscious-systems/subconscious/commit/164c9934074040f77ef80a2dd4946eacf7da47ff))
* add hack-cli-starter example ([3843ae2](https://github.com/subconscious-systems/subconscious/commit/3843ae2e7a93c7c15d7b2bb634920698f3f01941))
* add hack-cli-starter example ([a075ff1](https://github.com/subconscious-systems/subconscious/commit/a075ff16a5cbc1c8dd5bda6f87eb3c046fe5c324))
* **cli:** add cross-harness session resume ([4aa056c](https://github.com/subconscious-systems/subconscious/commit/4aa056cdc56462279d9dcd6bff25490c81ce0e6b))
* **cli:** add Give feedback to the TUI (SUBCON-790) ([d5e1869](https://github.com/subconscious-systems/subconscious/commit/d5e1869804e056b6e0c19d1a147bda7386259408))
* **cli:** add live models and update prompts ([a84779f](https://github.com/subconscious-systems/subconscious/commit/a84779fd25c98cbc43bd4bd5aaa85ade748316ab))
* **cli:** add separate native Windows integrations ([eb11642](https://github.com/subconscious-systems/subconscious/commit/eb116422d41051c82fce382712c4deffa70e3b3e))
* **cli:** add subc usage and platform URL config ([e22569a](https://github.com/subconscious-systems/subconscious/commit/e22569a974d18ced903dd953aa687244002b148a))
* **cli:** add subc usage and platform URL config ([22550a5](https://github.com/subconscious-systems/subconscious/commit/22550a5186fd68a823c133d6d30c049694998a18))
* **cli:** add Subconscious Code launcher ([7d39259](https://github.com/subconscious-systems/subconscious/commit/7d39259a117eb74de67e8175d8b5379eb0049f40))
* **cli:** attach screenshots to subc feedback (SUBCON-790) ([715296f](https://github.com/subconscious-systems/subconscious/commit/715296f768d3c5b0342fa1db92935fc6a83b973b))
* **cli:** brand the update prompt ([b4f8c95](https://github.com/subconscious-systems/subconscious/commit/b4f8c95eb4baa6a251a406c5108a268f99180b75))
* **cli:** derive OpenCode model names from ids ([91d99bb](https://github.com/subconscious-systems/subconscious/commit/91d99bbe06579515e22d6fb162d54eb2cbcd5195))
* **cli:** fetch profile-scoped models from /v1/models/available ([0cb58a0](https://github.com/subconscious-systems/subconscious/commit/0cb58a0ee22457bd8fb6602de02c483aee80d990))
* **cli:** install precompiled sc binaries ([97dae35](https://github.com/subconscious-systems/subconscious/commit/97dae35eaf37971c82aaace726c46faf45f51f80))
* **cli:** install precompiled sc binaries ([d17b8f1](https://github.com/subconscious-systems/subconscious/commit/d17b8f193cdfe86354be0f2ba3ed0e7c282d6013))
* **cli:** native Windows preview and session resume ([4571822](https://github.com/subconscious-systems/subconscious/commit/4571822aa4578291e0a5176f48b9c2749166f840))
* **cli:** release native control center and agent updates ([37e76ba](https://github.com/subconscious-systems/subconscious/commit/37e76bac85d34b6e21b2bb84803e0bc2fe4fc4b7))
* **cli:** replace localhost login with device codes ([a33da90](https://github.com/subconscious-systems/subconscious/commit/a33da90bd40f3b8059fdb69a8be5b6d801815132))
* **cli:** show daily allowance as a percent ([5b0d018](https://github.com/subconscious-systems/subconscious/commit/5b0d0184979c9dbf12f8587d43afbb035875e799))
* **cli:** subc feedback — contact support from the CLI (SUBCON-790) ([efe0f16](https://github.com/subconscious-systems/subconscious/commit/efe0f161b72f1520b068c9a85fc4ef92b9b6e20f))
* current multi-agent implementation and per-model Codex limits ([f9e860f](https://github.com/subconscious-systems/subconscious/commit/f9e860f21e2e5bbccab1bce249b95973dab7cadc))
* **examples:** add coding-agent templates + browser automation ([#47](https://github.com/subconscious-systems/subconscious/issues/47)) ([7180e16](https://github.com/subconscious-systems/subconscious/commit/7180e16c9879a406c8d1f9d072593e74480878a0))
* make coding-agent installer OS-aware and harden install walkthrough ([37ffd9a](https://github.com/subconscious-systems/subconscious/commit/37ffd9a88c9c42d39a5c70aadfbf1e8c4d5096c9))
* manifest v2 — paste-and-run setup commands, metadata, CI validation ([0becb70](https://github.com/subconscious-systems/subconscious/commit/0becb7058511a13c49b97efba72408d15bd8a20f))
* manifest v2 — paste-and-run setup, metadata, CI validation ([e7d1043](https://github.com/subconscious-systems/subconscious/commit/e7d1043a6b2ad1368ff1e450c4c206ccdb512b2b))
* migrate all examples to the OpenAI-compatible Subconscious API ([b7ba138](https://github.com/subconscious-systems/subconscious/commit/b7ba13857fba0cf09b5e7b03afade615974c1535))
* single source of truth for coding-agent configs ([f6fa94c](https://github.com/subconscious-systems/subconscious/commit/f6fa94c251c7ac8d1449fea37b9b225ea7be1efe))
* turn subconscious-cli into a coding-agent launcher ([70734c8](https://github.com/subconscious-systems/subconscious/commit/70734c8ee26ba69c73417311315449d5e0845525))
* warn below Codex 0.143.0, the version that honours v2 subagents ([6ca191e](https://github.com/subconscious-systems/subconscious/commit/6ca191ec330654a57ad45f8d8c9d6372d1f51048))


### Bug fixes

* adding claude code version check ([770e2b1](https://github.com/subconscious-systems/subconscious/commit/770e2b16186c6c469cfd61eaa328ed5579f091a7))
* better model unsetting procedures ([60f25b8](https://github.com/subconscious-systems/subconscious/commit/60f25b88754372957f8fbf0436beb5e5c0e90a2e))
* bring the Codex runbook in line with current Codex, and document its knobs ([8cf0915](https://github.com/subconscious-systems/subconscious/commit/8cf0915b5c4c267d03be2ebf6919797141913da4))
* check for Go before publishing the cli ([976e1b8](https://github.com/subconscious-systems/subconscious/commit/976e1b829b549d33ee14098d088dfb20527da5bd))
* **ci:** allow shell as a valid example language ([0e91ef9](https://github.com/subconscious-systems/subconscious/commit/0e91ef9e61e77a8fc3c68f4076d92163a9391a83))
* **ci:** allow shell as a valid example language ([#54](https://github.com/subconscious-systems/subconscious/issues/54)) ([27d3be8](https://github.com/subconscious-systems/subconscious/commit/27d3be8b2d3ccba7ec96ff7a152b578d543b1af6))
* **cli:** detect curl-installed OpenCode in ~/.opencode/bin ([61c0db2](https://github.com/subconscious-systems/subconscious/commit/61c0db2878539311795425c8b18f312106a818bb))
* **cli:** detect curl-installed OpenCode in ~/.opencode/bin ([0dd8c95](https://github.com/subconscious-systems/subconscious/commit/0dd8c95548a291c33d14cdb66e1e34b28541536e)), closes [#71](https://github.com/subconscious-systems/subconscious/issues/71)
* **cli:** enable DeepSeek V4.1 Flash vision and release 4.1.3 ([68eb933](https://github.com/subconscious-systems/subconscious/commit/68eb9330b5a95a5b69c8b28b565506aae0c1dc4f))
* **cli:** harden precompiled sc installation ([4dbf382](https://github.com/subconscious-systems/subconscious/commit/4dbf382e8e52e92b3ca9b6cd195a730ed44f9b8c))
* **cli:** keep Claude's /model list inside the granted catalog ([a357a8a](https://github.com/subconscious-systems/subconscious/commit/a357a8a99c873deef05c6a3053389b1dea81bd33))
* **cli:** keep overlapping TUI updates from dropping fields ([fc3b93c](https://github.com/subconscious-systems/subconscious/commit/fc3b93cb8d05ec5519eeec0e504dabf18577ead6))
* **cli:** let arrow keys edit the prefilled base URL ([46dafec](https://github.com/subconscious-systems/subconscious/commit/46dafeccab6eb6d975cc2b2fcdf2f0ccb9f4f4fb))
* **cli:** move rare URL settings to the bottom of the TUI ([e013f7a](https://github.com/subconscious-systems/subconscious/commit/e013f7a3999b86d036d0eb0bcddb28342474c6d0))
* **cli:** only paste screenshots into feedback (SUBCON-790) ([7652c58](https://github.com/subconscious-systems/subconscious/commit/7652c581224ec9528380b2f7b607660bf76d53ab))
* **cli:** opt Claude Code launches out of server-side auto mode classifier ([c659bb4](https://github.com/subconscious-systems/subconscious/commit/c659bb45e8601743ddd58ac38184cdd1f8ddbe8f))
* **cli:** pack the CLI when git hooks are not installed ([928a9fd](https://github.com/subconscious-systems/subconscious/commit/928a9fda96f232da3bd18e0dcaa5a3f27e040eb8))
* **cli:** point a failed feedback send at support email (SUBCON-790) ([7020e8f](https://github.com/subconscious-systems/subconscious/commit/7020e8f1f1d82a629c0719224eccc78260e551d3))
* **cli:** preserve npm executable metadata ([dd1f51a](https://github.com/subconscious-systems/subconscious/commit/dd1f51af2679f5f73d14d78e4b9a7e4e2172bb9a))
* **cli:** print a clickable /cli/device URL ([a0eca79](https://github.com/subconscious-systems/subconscious/commit/a0eca79831aca337f4ebfafdc3747bc7c65dc2dd))
* **cli:** refresh OpenCode models on launch ([1b3ba9d](https://github.com/subconscious-systems/subconscious/commit/1b3ba9d90116c96608fefb6526161fda6e425f42))
* **cli:** refresh Pi models on launch ([d5ff073](https://github.com/subconscious-systems/subconscious/commit/d5ff0739684db2198cb8c4a2892341f123a944ba))
* **cli:** retry TUI update writes when Windows locks the file ([3c003b8](https://github.com/subconscious-systems/subconscious/commit/3c003b85ea0e2f4ff485bea7d55325b79b131cd9))
* **cli:** update the running global installation ([409e1b5](https://github.com/subconscious-systems/subconscious/commit/409e1b57f14a2b10e057ab5bd6d853e3824d03d9))
* **cli:** use detected package manager for in-app updates ([b4523e0](https://github.com/subconscious-systems/subconscious/commit/b4523e0bafbec1fedc10d6bddcf74fdde16ce071))
* **cli:** use Marathon instead of Windows sc command ([5cd2ad9](https://github.com/subconscious-systems/subconscious/commit/5cd2ad90d91253a2ed14149d9127a45f9c4eb27b))
* **cli:** use Marathon on Unix as well as Windows ([b810844](https://github.com/subconscious-systems/subconscious/commit/b8108444d8990d982a6e1c86bf6c4798bbf3c08d))
* **cli:** use Messages API for Copilot ([e295e23](https://github.com/subconscious-systems/subconscious/commit/e295e2314417a4c5e07288053049b5efc3f7b58c))
* configure Copilot thinking limits ([f6e6b57](https://github.com/subconscious-systems/subconscious/commit/f6e6b572f609fe1a3582bbd33a2edb2ec5c7e9a5))
* default spawned agents to low reasoning effort ([5a17ccf](https://github.com/subconscious-systems/subconscious/commit/5a17ccf806f198ee5ad346a6ff056b79b11706db))
* **examples:** getting_started_notebook works in Colab + fix stale link ([#45](https://github.com/subconscious-systems/subconscious/issues/45)) ([2536ebb](https://github.com/subconscious-systems/subconscious/commit/2536ebb8ea0a1af957d5d6d3eb6f818262b33acb))
* **examples:** migrate e2b_cli from deprecated @e2b/sdk to e2b ([#46](https://github.com/subconscious-systems/subconscious/issues/46)) ([b996969](https://github.com/subconscious-systems/subconscious/commit/b996969f68e6410a5c0322cafea581548354ae22))
* improving claude version check ([538c0d6](https://github.com/subconscious-systems/subconscious/commit/538c0d61d70dfb62c283fd402418aced8e32ab1f))
* install Codex hooks once instead of on every launch ([43c88e2](https://github.com/subconscious-systems/subconscious/commit/43c88e2204b38544d045120c903f1d5f1eee5ff0))
* let the codex test stub run without CAPTURED_ARGS ([72684e6](https://github.com/subconscious-systems/subconscious/commit/72684e63d0b9052a5aed9fe2dfdb02bd38c43ff8))
* open the subc TUI before catalog and session fetches ([66e6dfc](https://github.com/subconscious-systems/subconscious/commit/66e6dfc9f28556c17f6e5169a0a7ca233e71ecee))
* preserve Copilot agent prompt capacity ([f6b3414](https://github.com/subconscious-systems/subconscious/commit/f6b3414e8fb8faed94d7b68c6e34d34683f8d455))
* prompting update on subc if new version ([328c4ae](https://github.com/subconscious-systems/subconscious/commit/328c4ae8a9f4d61da15ada7eeef5f48976514e9e))
* skip a stale cached TUI binary in source checkouts ([59021f9](https://github.com/subconscious-systems/subconscious/commit/59021f90dfa8a4106741397e20d0b121e6680e91))
* stop installing Codex hooks from the launcher ([194ec2a](https://github.com/subconscious-systems/subconscious/commit/194ec2ae85b7241b7932d0dba41e698d863b134b))


### Reverts

* keep installing Codex hooks from the launcher ([166ddf8](https://github.com/subconscious-systems/subconscious/commit/166ddf8cd7406b3d80e918ad58d68107a5f0fd29))
