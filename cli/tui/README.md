# Subconscious native TUI

`subc` with no arguments opens this Go application when attached to a terminal.
It presents the coding-agent registry, active profile, live model catalog, and
account/configuration commands. The selected action is returned to the existing
Node command engine, which keeps all explicit `subc <command>` behavior stable.

## Development

```bash
npm run build:tui:host --prefix cli
subc-local
```

Run both test suites with:

```bash
npm test --prefix cli
npm run test:tui --prefix cli
```

`npm pack` and `npm publish` run `build:tui` automatically and include stripped,
CGO-free binaries for macOS, Linux, and Windows on arm64 and x64/amd64.
