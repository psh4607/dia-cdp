---
name: dia-cdp
description: Use when inspecting, debugging, capturing, or interacting with pages open in Dia through CDP, especially when the user uses Dia instead of Chrome.
---

# Dia CDP

Use the plugin-bundled `dia-cdp` CLI for Dia browser inspection. It connects to
Dia's `DevToolsActivePort` and uses the CDP engine shipped with this plugin.

## When To Use

- The user asks to inspect, debug, screenshot, or interact with a page open in Dia.
- The target page depends on Dia's logged-in session, cookies, extensions, or tabs.
- The user mentions Dia, not Google Chrome, for browser state.

Do not call the old `chrome-cdp` skill or `~/.codex/skills/chrome-cdp/scripts/cdp.mjs`
for Dia pages. Use the bundled `scripts/dia-cdp` wrapper from this skill
directory, or `dia-cdp` on `PATH` when the user has installed the CLI shim.

## Commands

List Dia tabs:

```bash
scripts/dia-cdp list
```

Use the target prefix from `list`:

```bash
scripts/dia-cdp snap <target>
scripts/dia-cdp shot <target> /tmp/dia.png
scripts/dia-cdp eval <target> 'document.title'
scripts/dia-cdp html <target> 'main'
scripts/dia-cdp net <target>
```

If Dia is not exposing CDP on port `9222`:

```bash
scripts/dia-cdp --restart list
```

If Dia refuses to quit and the user explicitly accepts closing it:

```bash
scripts/dia-cdp --restart --force-kill list
```

## Notes

- Runtime state lives under `~/.cache/dia-cdp`, separate from `chrome-cdp`.
- `scripts/dia-cdp` is relative to this skill directory and survives plugin install.
- For local dev servers where browser profile state does not matter, Playwright is still fine.
