---
name: dia-cdp
description: Use when inspecting, debugging, capturing, or interacting with pages open in Dia through CDP, especially when the user uses Dia instead of Chrome.
---

# Dia CDP

Use the plugin-bundled extension bridge for tab metadata when it is installed.
It avoids Dia's remote-debugging approval dialog. Use the `dia-cdp` CLI for
deeper browser inspection that requires Chrome DevTools Protocol access.

## When To Use

- The user asks to inspect, debug, screenshot, or interact with a page open in Dia.
- The target page depends on Dia's logged-in session, cookies, extensions, or tabs.
- The user mentions Dia, not Google Chrome, for browser state.

Do not call the old `chrome-cdp` skill or `~/.codex/skills/chrome-cdp/scripts/cdp.mjs`
for Dia pages. Use the bundled `scripts/dia-cdp` wrapper from this skill
directory, or `dia-cdp` on `PATH` when the user has installed the CLI shim.

## Commands

List Dia tabs without CDP when the extension bridge is available:

```bash
scripts/dia-extension list
```

Otherwise list Dia CDP targets:

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

- The extension bridge requests `tabs` plus loopback-only access to
  `http://127.0.0.1/*`; it does not request `debugger`, `nativeMessaging`, or
  access to remote websites.
- A missing extension bridge is not a CDP failure. Use `dia-extension ping` to
  distinguish bridge installation from Dia remote-debugging state.
- Runtime state lives under `~/.cache/dia-cdp`, separate from `chrome-cdp`.
- `scripts/dia-cdp` is relative to this skill directory and survives plugin install.
- For local dev servers where browser profile state does not matter, Playwright is still fine.
