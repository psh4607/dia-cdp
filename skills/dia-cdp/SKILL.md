---
name: dia-cdp
description: Use when inspecting, debugging, capturing, or interacting with pages open in Dia through the approval-free extension bridge or CDP fallback.
---

# Dia CDP

Use the plugin-bundled extension bridge first. It avoids Dia's remote-debugging
approval dialog for tab management, page inspection, interaction, and visible
screenshots. Use the `dia-cdp` CLI only as a CDP fallback for capabilities the
extension cannot provide, such as network response bodies and performance traces.

## When To Use

- The user asks to inspect, debug, screenshot, or interact with a page open in Dia.
- The target page depends on Dia's logged-in session, cookies, extensions, or tabs.
- The user mentions Dia, not Google Chrome, for browser state.

Do not call the old `chrome-cdp` skill or `~/.codex/skills/chrome-cdp/scripts/cdp.mjs`
for Dia pages. Use the bundled `scripts/dia-cdp` wrapper from this skill
directory, or `dia-cdp` on `PATH` when the user has installed the CLI shim.

## Commands

List Dia tabs without CDP:

```bash
scripts/dia-extension list
```

Inspect and interact with a page without CDP:

```bash
scripts/dia-extension snapshot <tab-id>
scripts/dia-extension query <tab-id> '#save'
scripts/dia-extension text <tab-id> main
scripts/dia-extension html <tab-id> main
scripts/dia-extension click <tab-id> '#save'
scripts/dia-extension type <tab-id> '#name' 'Seongho Bak'
scripts/dia-extension focus <tab-id> '#search'
scripts/dia-extension scroll <tab-id> '#details'
scripts/dia-extension select <tab-id> '#team' backend
scripts/dia-extension key <tab-id> '#search' Enter
scripts/dia-extension shot <tab-id> /tmp/dia.png
```

Manage navigation without CDP:

```bash
scripts/dia-extension create https://example.com/
scripts/dia-extension navigate <tab-id> https://example.com/
scripts/dia-extension reload <tab-id>
scripts/dia-extension close <tab-id>
```

For CDP-only work, list Dia CDP targets:

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

- The extension bridge requests `tabs`, `scripting`, and `<all_urls>` so one
  install-time grant replaces recurring remote-debugging approvals for ordinary
  web pages. It does not request `debugger` or `nativeMessaging`.
- The bridge exposes fixed operations and deliberately does not accept arbitrary
  JavaScript evaluation.
- A missing extension bridge is not a CDP failure. Use `dia-extension ping` to
  distinguish bridge installation from Dia remote-debugging state.
- Runtime state lives under `~/.cache/dia-cdp`, separate from `chrome-cdp`.
- `scripts/dia-cdp` is relative to this skill directory and survives plugin install.
- For local dev servers where browser profile state does not matter, Playwright is still fine.
