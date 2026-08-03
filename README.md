# dia-cdp

Permission-minimized extension bridge, standalone CDP CLI, and Codex plugin for
the Dia browser on macOS.

This project is a Dia-focused fork of a lightweight raw Chrome DevTools Protocol
CLI. It does not depend on Codex's bundled `chrome-cdp` skill directory.

## Codex Plugin Install

Install from the public marketplace repo:

```bash
codex plugin marketplace add psh4607/dia-cdp --ref main
codex plugin add dia-cdp@dia-cdp
```

Verify:

```bash
codex plugin list --json | jq '.installed[] | select(.pluginId == "dia-cdp@dia-cdp")'
```

The plugin ships the `dia-cdp` skill and a skill-local `scripts/dia-cdp`
wrapper, so Codex agents can use the bundled CLI from the installed plugin
cache without depending on the old `chrome-cdp` skill.

## Dia Extension Bridge

The extension bridge lists, reads, and activates Dia tabs without opening a CDP
WebSocket and without triggering Dia's `Allow debugging` dialog. The first
version intentionally requests only narrowly scoped permissions:

- `tabs`, to read tab titles and URLs
- `http://127.0.0.1/*`, to communicate with the user-only loopback relay

It does not request the powerful `debugger` or `nativeMessaging` permissions,
nor access to remote websites.

### Install the local payloads

Preview the extension and relay destinations without writing anything:

```bash
bin/install-dia-extension-host --dry-run
```

Install both payloads for the current macOS user:

```bash
bin/install-dia-extension-host
```

The unpacked extension is copied to a version-independent location:

```text
~/.local/share/dia-cdp/extension/
```

The relay runtime is likewise copied to:

```text
~/.local/share/dia-cdp/relay/
```

The installer generates a private relay token at:

```text
~/.local/share/dia-cdp/bridge-token
```

The token file and the generated extension configuration are readable only by
the current macOS user.

### Load the unpacked extension

1. Open Dia's extensions page and enable Developer mode.
2. Choose **Load unpacked** and select `~/.local/share/dia-cdp/extension/`.
3. Verify that Dia shows the stable extension id
   `jkijmmbnkcgjmpagmpflooolealenfkf`.

### Use the bridge

```bash
bin/dia-extension ping
bin/dia-extension list
bin/dia-extension get <tab-id>
bin/dia-extension activate <tab-id>
```

The CLI starts a relay bound only to `127.0.0.1:47137` and communicates with it
through a user-only Unix socket at `~/.cache/dia-cdp/extension-bridge.sock`.
The relay requires both the private token and the extension's exact origin. A
public manifest key keeps that extension id unchanged when the plugin
installation path or version changes; no private signing key ships with the
repository. Stable extension and relay installation directories likewise keep
the bridge working when Codex refreshes its plugin cache.

## CLI Install

Use the project wrapper directly:

```bash
/Users/seongho/projects/seongho/projects/dia-cdp/bin/dia-cdp list
```

For the local user command, point `~/.local/bin/dia-cdp` at this wrapper:

```bash
ln -sfn /Users/seongho/projects/seongho/projects/dia-cdp/bin/dia-cdp ~/.local/bin/dia-cdp
```

`~/.local/bin` is already on this machine's `PATH`.

## Usage

List Dia tabs:

```bash
dia-cdp list
```

Capture an accessibility snapshot:

```bash
dia-cdp snap <target>
```

Evaluate JavaScript:

```bash
dia-cdp eval <target> 'document.title'
```

Capture a screenshot:

```bash
dia-cdp shot <target> /tmp/dia.png
```

Restart Dia with CDP on port `9222`:

```bash
dia-cdp --restart list
```

If Dia blocks graceful quit and you explicitly accept closing it:

```bash
dia-cdp --restart --force-kill list
```

## How It Works

`bin/dia-cdp` is the Dia launcher and safety wrapper. It uses:

- Dia app: `/Applications/Dia.app`
- Port file: `~/Library/Application Support/Dia/User Data/DevToolsActivePort`
- CDP port: `9222`
- Engine: `src/cdp.mjs`

`src/cdp.mjs` holds the raw CDP client and per-tab daemon. `extension/` contains
the Manifest V3 extension, while `src/extension-host.mjs` and
`src/extension-client.mjs` implement the loopback HTTP and Unix-socket bridge.
Runtime sockets and page cache live under `~/.cache/dia-cdp` or
`$XDG_RUNTIME_DIR/dia-cdp`, so this project does not share daemon state with the
original `chrome-cdp` script.

## Plugin Layout

- `.agents/plugins/marketplace.json` exposes this repository as a Codex plugin marketplace.
- `.codex-plugin/plugin.json` describes the `dia-cdp` plugin.
- `extension/` contains the permission-minimized Dia extension.
- `skills/dia-cdp/SKILL.md` tells Codex when to prefer Dia CDP over Chrome CDP.
- `skills/dia-cdp/scripts/dia-cdp` runs the CLI bundled in the installed plugin.
