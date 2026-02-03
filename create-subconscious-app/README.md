# create-subconscious-app

Create a new Subconscious agent project from examples.

## Usage

```bash
# Interactive mode
npx create-subconscious-app

# With project name (prompts for example selection)
npx create-subconscious-app my-agent

# Fully non-interactive
npx create-subconscious-app my-agent -e e2b_cli

# List available examples
npx create-subconscious-app --list
```

## Options

| Option | Description |
|--------|-------------|
| `[project-name]` | Name of project directory to create |
| `-e, --example <name>` | Example to use (skips selection prompt) |
| `--list` | Print available examples and exit |
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |

## Available Examples

Run `npx create-subconscious-app --list` to see all available examples, or browse them at [github.com/subconscious-systems/subconscious/tree/main/examples](https://github.com/subconscious-systems/subconscious/tree/main/examples).

## How It Works

1. Fetches the example manifest from the Subconscious repository
2. Downloads the selected example using [giget](https://github.com/unjs/giget)
3. Updates the project name in `package.json` or `pyproject.toml`
4. Prints next steps for getting started

## Adding a New Example

Want to contribute an example? Simply:

1. Create a folder in `examples/` with your code
2. Add a `package.json` (for JS/TS) or `pyproject.toml` (for Python) with `name` and `description` fields
3. Open a PR

When merged to main, a GitHub Action automatically updates the manifest and your example becomes available immediately.

## License

MIT
