# subconscious-cli

Authenticate with Subconscious from your terminal. One command opens your browser, signs you in (or up), and saves your API key locally.

## Quick start

```bash
npx subconscious-cli login
```

That's it. Your API key is saved to `~/.subcon/config.json` and ready to use.

## How it works

```
Terminal                          Browser
  │                                  │
  │  1. Start local callback server  │
  │  2. Open browser ───────────────►│
  │                                  │  3. Sign in / sign up via Clerk
  │                                  │  4. API key auto-created
  │  5. Receive key ◄────────────────│  
  │  6. Save to ~/.subcon/config.json│
  │                                  │  "You can close this tab"
  ✓ Logged in!                       │
```

## Commands

### `login`

Opens your browser to sign in (or create an account). After authentication, your API key is automatically generated and saved.

```bash
npx subconscious-cli login
```

### `logout`

Removes your saved API key.

```bash
npx subconscious-cli logout
```

### `whoami`

Shows your current authentication status and which key is active.

```bash
npx subconscious-cli whoami
```

## Where keys are stored

Keys are saved to `~/.subcon/config.json` with `600` permissions (owner-read-only). The file looks like:

```json
{
  "subconscious_api_key": "sk-..."
}
```

Environment variable `SUBCONSCIOUS_API_KEY` takes precedence over the config file.

## Global install

If you prefer a persistent command:

```bash
npm install -g subconscious-cli
subconscious-cli login
```
