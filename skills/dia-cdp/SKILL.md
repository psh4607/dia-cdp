---
name: dia-cdp
description: Use when inspecting, debugging, capturing, or interacting with pages open in Dia through the approval-free extension bridge, a separate automation profile, or CDP fallback.
---

# Dia CDP

Use the plugin-bundled extension bridge first. It avoids Dia's remote-debugging
approval dialog for tab management, page inspection, interaction, and visible
screenshots. Use the `dia-cdp` CLI only as a CDP fallback for capabilities the
extension cannot provide, such as network response bodies, raw CDP domains, and
performance traces.

Do not call the old `chrome-cdp` skill or `~/.codex/skills/chrome-cdp/scripts/cdp.mjs`
for Dia pages. Use the bundled `scripts/dia-cdp` wrapper from this skill
directory, or `dia-cdp` on `PATH` when the user has installed the CLI shim.

## Commands

Use the unified router by default. It chooses the extension for ordinary work
and never starts CDP unless the command is CDP-only and `--allow-cdp` is present:

```bash
scripts/dia-browser health
scripts/dia-browser list
scripts/dia-browser snapshot <tab-id>
scripts/dia-browser click <tab-id> '#save'
scripts/dia-browser shot <tab-id> /tmp/dia.png
scripts/dia-browser net <tab-id>
```

Arbitrary JavaScript is capability-gated and disabled by default. Enable it only
when the user has authorized page evaluation, then target a numeric extension
tab id:

```bash
scripts/dia-browser capabilities
scripts/dia-browser capability page-eval on
scripts/dia-browser eval <tab-id> 'document.title'
scripts/dia-browser capability page-eval off
```

The user can also select the Dia Codex Bridge extension icon and change the
**Page evaluation** switch. The popup and CLI use the same relay-backed setting,
so do not treat them as separate permissions. The popup refreshes from the
relay every two seconds and disables the switch while the bridge is unavailable.

For an advanced command that genuinely needs raw CDP:

```bash
scripts/dia-browser --allow-cdp --cdp evalraw <cdp-target> DOM.getDocument
```

Inspect or stop existing CDP sessions without opening a new CDP connection:

```bash
scripts/dia-browser cdp-status
scripts/dia-browser cdp-stop <cdp-target>
scripts/dia-browser safe-stop
```

Manage the default Dia process separately from CDP sessions:

```bash
scripts/dia-browser dia-status
scripts/dia-browser dia-start
scripts/dia-browser safe-dia-stop
scripts/dia-browser safe-dia-restart
scripts/dia-browser safe-dia-restart --enable-cdp
```

`safe-stop` detaches only reusable CDP daemon sessions and leaves Dia running.
`safe-dia-stop` sends `SIGTERM` only to verified default Dia root processes;
it never targets any process with `--user-data-dir` and never force-kills.
`safe-dia-restart` waits for the extension bridge to reconnect. Keep CDP off by
default and use `--enable-cdp` only when an advanced command genuinely needs it.

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
scripts/dia-extension window-focus <tab-id>
scripts/dia-browser net <tab-id>
scripts/dia-browser clickxy <tab-id> 120 240
scripts/dia-browser loadall <tab-id> '.load-more' 1000
```

Manage navigation without CDP:

```bash
scripts/dia-extension create https://example.com/
scripts/dia-extension navigate <tab-id> https://example.com/
scripts/dia-extension reload <tab-id>
scripts/dia-extension close <tab-id>
```

Use a separate automation-only Dia user-data-dir when the user's main Dia
cookies, login state, extensions, and tabs are not required:

```bash
scripts/dia-automation path
scripts/dia-automation start https://example.com/
scripts/dia-automation status
scripts/dia-automation list
scripts/dia-automation snap <target>
scripts/dia-automation stop
```

Log in to required sites inside that profile once. Never copy or concurrently
share the main Dia profile. `status`, `path`, and `stop` do not start Dia, and
`stop` signals only the recorded process after verifying its user-data-dir.

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
- The bridge exposes fixed operations by default. Arbitrary main-world
  JavaScript evaluation is accepted only while the private relay capability
  `page-eval` is enabled. Results and expressions are bounded.
- The extension popup and CLI both read and write the relay capability file;
  the green `ON` badge means bridge-connected, not page-eval-enabled.
- `net` returns the page's bounded Resource Timing entries. Response bodies,
  raw request interception, and performance traces still require CDP.
- Window focus uses the existing extension APIs and adds no manifest permission.
- Cookies, downloads, clipboard access, request observation or modification,
  file URL access, and incognito access stay unsupported unless the user asks
  for one capability and accepts its specific permission trade-off.
- Chrome does not allow `debugger` as an optional permission. Future on/off
  settings must control CDP exposure or attach/detach behavior rather than claim
  to revoke that manifest permission dynamically.
- The extension keeps its local WebSocket alive with a 20-second heartbeat and
  uses a 30-second alarm to reconnect after worker suspension or relay startup.
- A user LaunchAgent starts the relay at login and restarts it after crashes.
  Stable payloads synchronize on the first command after a plugin version change.
- Approved CDP tab daemons are reused for eight hours by default. The router
  requires `--allow-cdp` before it can start a CDP-only command.
- A missing extension bridge is not a CDP failure. Use `dia-extension ping` to
  distinguish bridge installation from Dia remote-debugging state.
- Runtime state lives under `~/.cache/dia-cdp`, separate from `chrome-cdp`.
- `scripts/dia-cdp` is relative to this skill directory and survives plugin install.
- For local dev servers where browser profile state does not matter, Playwright is still fine.
