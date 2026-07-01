# dia-cdp

Standalone CDP CLI and Codex plugin for the Dia browser on macOS.

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

`src/cdp.mjs` holds the raw CDP client and per-tab daemon. Runtime sockets and
page cache live under `~/.cache/dia-cdp` or `$XDG_RUNTIME_DIR/dia-cdp`, so this
project does not share daemon state with the original `chrome-cdp` script.

## Plugin Layout

- `.agents/plugins/marketplace.json` exposes this repository as a Codex plugin marketplace.
- `.codex-plugin/plugin.json` describes the `dia-cdp` plugin.
- `skills/dia-cdp/SKILL.md` tells Codex when to prefer Dia CDP over Chrome CDP.
- `skills/dia-cdp/scripts/dia-cdp` runs the CLI bundled in the installed plugin.
