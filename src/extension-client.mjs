#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUEST_TIMEOUT_MS = 45_000;
const START_TIMEOUT_MS = 3_000;
const currentDir = dirname(fileURLToPath(import.meta.url));
const cdpWrapperPath = resolve(currentDir, '..', 'bin', 'dia-cdp');
const bundledManifestPath = resolve(currentDir, '..', 'extension', 'manifest.json');
const stableManifestPath = resolve(
  homedir(),
  '.local',
  'share',
  'dia-cdp',
  'extension',
  'manifest.json',
);
const socketPath = process.env.DIA_EXTENSION_SOCKET
  || resolve(homedir(), '.cache', 'dia-cdp', 'extension-bridge.sock');

export function formatTabList(tabs) {
  return tabs.map((tab) => {
    const marker = tab.active ? '*' : ' ';
    const id = String(tab.id).padEnd(6);
    const title = String(tab.title || '').slice(0, 54).padEnd(54);
    return `${marker} ${id}  ${title}  ${tab.url || ''}`;
  }).join('\n');
}

export function payloadSyncRequired(bundledPath = bundledManifestPath, installedPath = stableManifestPath) {
  try {
    const bundledVersion = JSON.parse(readFileSync(bundledPath, 'utf8')).version;
    const installedVersion = JSON.parse(readFileSync(installedPath, 'utf8')).version;
    return bundledVersion !== installedVersion;
  } catch {
    return true;
  }
}

function syncInstalledPayload() {
  if (!payloadSyncRequired()) return;
  execFileSync(process.execPath, [resolve(currentDir, 'install-native-host.mjs')], {
    stdio: 'inherit',
  });
}

function relayScriptPath() {
  if (process.env.DIA_EXTENSION_RELAY_SCRIPT) return process.env.DIA_EXTENSION_RELAY_SCRIPT;
  const installed = resolve(homedir(), '.local', 'share', 'dia-cdp', 'relay', 'extension-host.mjs');
  return existsSync(installed) ? installed : resolve(currentDir, 'extension-host.mjs');
}

function requestOnce(command, args, targetSocket, timeoutMs) {
  return new Promise((resolveResponse, reject) => {
    const connection = net.connect(targetSocket);
    let buffer = '';
    const timer = setTimeout(() => {
      connection.destroy();
      reject(new Error(`Dia extension bridge did not respond within ${timeoutMs}ms`));
    }, timeoutMs);

    connection.setEncoding('utf8');
    connection.on('connect', () => {
      connection.write(`${JSON.stringify({ id: 1, command, args })}\n`);
    });
    connection.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      connection.end();
      const response = JSON.parse(buffer.slice(0, newline));
      if (response.ok) resolveResponse(response.result);
      else reject(new Error(response.error || 'Dia extension bridge request failed'));
    });
    connection.on('error', (error) => {
      clearTimeout(timer);
      error.bridgeUnavailable = error.code === 'ENOENT' || error.code === 'ECONNREFUSED';
      reject(error);
    });
  });
}

async function startRelay(targetSocket) {
  const child = spawn(process.execPath, [relayScriptPath()], {
    detached: true,
    env: { ...process.env, DIA_EXTENSION_SOCKET: targetSocket },
    stdio: 'ignore',
  });
  child.unref();

  await delay(50);
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(targetSocket)) return;
    await delay(50);
  }
  throw new Error('Dia extension relay did not start');
}

export async function sendBridgeRequest(command, args = {}, options = {}) {
  const targetSocket = options.socketPath || socketPath;
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;

  try {
    return await requestOnce(command, args, targetSocket, timeoutMs);
  } catch (error) {
    if (!error.bridgeUnavailable || options.autoStart === false) throw error;
    await startRelay(targetSocket);
    return requestOnce(command, args, targetSocket, timeoutMs);
  }
}

const USAGE = `dia-extension <command> [args] [--json]

Commands:
  health                            Report relay and extension connection health
  ping                              Verify the Dia extension bridge
  list                              List Dia tabs without CDP remote-debugging
  get <tab-id>                      Get one Dia tab
  activate <tab-id>                 Activate one Dia tab
  window-focus <tab-id>             Focus a tab and bring its Dia window forward
  create <url> [--background]       Create a tab
  close <tab-id>                    Close a tab
  navigate <tab-id> <url>           Navigate a tab
  reload <tab-id>                   Reload a tab
  snapshot <tab-id>                 Read compact page text and actionable elements
  query <tab-id> <selector>         Describe one element
  text <tab-id> [selector]          Read bounded visible text
  html <tab-id> [selector]          Read bounded HTML
  click <tab-id> <selector>         Click an element
  type <tab-id> <selector> <text>   Replace a form value
  focus <tab-id> <selector>         Focus an element
  scroll <tab-id> <selector>        Scroll an element into view
  scroll-by <tab-id> <x> <y>        Scroll the page by pixels
  select <tab-id> <selector> <value> Select a form option
  key <tab-id> <selector> <key>     Dispatch a key press
  shot <tab-id> <path>              Capture the visible tab as PNG

CDP-only commands (require --allow-cdp and may show Dia approval):
  net <target>                      Read network performance entries
  eval <target> <expression>        Evaluate JavaScript through CDP
  evalraw <target> <method> [json]  Send a raw CDP command
  clickxy <target> <x> <y>          Click viewport coordinates through CDP
  loadall <target> <selector> [ms]  Repeatedly click through CDP
  --allow-cdp --cdp <command> ...   Force any command through CDP

Session commands (never start a new CDP connection):
  cdp-status [target]               Show reusable CDP daemon sessions
  cdp-stop [target]                 Stop reusable CDP daemon sessions
`;

function numericTabId(value, command) {
  const tabId = Number(value);
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error(`${command} requires a numeric tab id`);
  }
  return tabId;
}

function requiredArg(value, command, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${command} requires ${label}`);
  }
  return value;
}

function joinedArg(args, startIndex, command, label) {
  if (args.length <= startIndex) throw new Error(`${command} requires ${label}`);
  return args.slice(startIndex).join(' ');
}

export function parseCliArgs(args) {
  const command = args[0];
  if (!command) throw new Error('command is required');

  switch (command) {
    case 'health':
      return { bridgeCommand: 'relay.health', bridgeArgs: {} };
    case 'ping':
      return { bridgeCommand: 'ping', bridgeArgs: {} };
    case 'list':
      return { bridgeCommand: 'tabs.list', bridgeArgs: {} };
    case 'get':
    case 'activate':
    case 'reload':
    case 'close':
      return {
        bridgeCommand: `tabs.${command}`,
        bridgeArgs: { tabId: numericTabId(args[1], command) },
      };
    case 'window-focus':
      return {
        bridgeCommand: 'windows.focusTab',
        bridgeArgs: { tabId: numericTabId(args[1], command) },
      };
    case 'create':
      return {
        bridgeCommand: 'tabs.create',
        bridgeArgs: {
          url: requiredArg(args[1], command, 'a URL'),
          active: !args.includes('--background'),
        },
      };
    case 'navigate':
      return {
        bridgeCommand: 'tabs.navigate',
        bridgeArgs: {
          tabId: numericTabId(args[1], command),
          url: requiredArg(args[2], command, 'a URL'),
        },
      };
    case 'snapshot':
      return {
        bridgeCommand: 'page.snapshot',
        bridgeArgs: { tabId: numericTabId(args[1], command) },
      };
    case 'query':
    case 'click':
    case 'focus':
    case 'scroll':
      return {
        bridgeCommand: `page.${command}`,
        bridgeArgs: {
          tabId: numericTabId(args[1], command),
          selector: requiredArg(args[2], command, 'a selector'),
        },
      };
    case 'text':
    case 'html':
      return {
        bridgeCommand: `page.${command}`,
        bridgeArgs: {
          tabId: numericTabId(args[1], command),
          ...(args[2] ? { selector: args[2] } : {}),
        },
      };
    case 'type':
      return {
        bridgeCommand: 'page.type',
        bridgeArgs: {
          tabId: numericTabId(args[1], command),
          selector: requiredArg(args[2], command, 'a selector'),
          text: joinedArg(args, 3, command, 'text'),
        },
      };
    case 'scroll-by':
      {
        const x = Number(args[2] || 0);
        const y = Number(args[3] || 0);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error('scroll-by requires numeric x and y values');
        }
        return {
          bridgeCommand: 'page.scroll',
          bridgeArgs: { tabId: numericTabId(args[1], command), x, y },
        };
      }
    case 'select':
      return {
        bridgeCommand: 'page.select',
        bridgeArgs: {
          tabId: numericTabId(args[1], command),
          selector: requiredArg(args[2], command, 'a selector'),
          value: joinedArg(args, 3, command, 'a value'),
        },
      };
    case 'key':
      return {
        bridgeCommand: 'page.key',
        bridgeArgs: {
          tabId: numericTabId(args[1], command),
          selector: requiredArg(args[2], command, 'a selector'),
          key: requiredArg(args[3], command, 'a key'),
        },
      };
    case 'shot':
      return {
        bridgeCommand: 'page.screenshot',
        bridgeArgs: { tabId: numericTabId(args[1], command) },
        outputPath: requiredArg(args[2], command, 'an output path'),
      };
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const CDP_ONLY_COMMANDS = new Set(['net', 'eval', 'evalraw', 'clickxy', 'loadall']);

export function classifyRoute(args) {
  const allowCdp = args.includes('--allow-cdp');
  const forceCdp = args.includes('--cdp');
  const routedArgs = args.filter((arg) => arg !== '--allow-cdp' && arg !== '--cdp');
  const command = routedArgs[0];

  if (forceCdp) {
    if (!allowCdp) {
      throw new Error('forcing CDP requires --allow-cdp because Dia may show an approval prompt');
    }
    if (!command) throw new Error('a CDP command is required');
    return { route: 'cdp', cdpArgs: routedArgs, requiresConsent: true };
  }

  if (command === 'cdp-status' || command === 'cdp-stop') {
    return {
      route: 'cdp',
      cdpArgs: [command === 'cdp-status' ? 'status' : 'stop', ...routedArgs.slice(1)],
      requiresConsent: false,
    };
  }

  if (CDP_ONLY_COMMANDS.has(command)) {
    return { route: 'cdp', cdpArgs: routedArgs, requiresConsent: true };
  }

  return { route: 'extension', ...parseCliArgs(routedArgs) };
}

function runCdp(cdpArgs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cdpWrapperPath, cdpArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`Dia CDP command stopped by ${signal}`));
      else if (code === 0) resolveRun();
      else reject(new Error(`Dia CDP command exited with status ${code}`));
    });
  });
}

export function writeScreenshot(dataUrl, outputPath) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('extension returned an invalid PNG screenshot');
  writeFileSync(outputPath, Buffer.from(match[1], 'base64'), { mode: 0o600 });
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const args = argv.filter((arg) => arg !== '--json');
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  syncInstalledPayload();
  const route = classifyRoute(args);
  if (route.route === 'cdp') {
    if (route.requiresConsent && !args.includes('--allow-cdp')) {
      throw new Error(
        `"${route.cdpArgs[0]}" requires CDP and may show Dia's approval prompt. `
        + `Re-run with: dia-browser --allow-cdp ${route.cdpArgs.join(' ')}`,
      );
    }
    await runCdp(route.cdpArgs);
    return;
  }
  const { bridgeCommand, bridgeArgs, outputPath } = route;
  const result = await sendBridgeRequest(bridgeCommand, bridgeArgs);
  if (outputPath) {
    writeScreenshot(result.dataUrl, outputPath);
    console.log(outputPath);
    return;
  }
  if (json || !Array.isArray(result)) console.log(JSON.stringify(result, null, 2));
  else console.log(formatTabList(result));
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  main().catch((error) => {
    const unavailable = error.bridgeUnavailable
      ? 'Dia extension bridge is unavailable. Reload the extension and try again.'
      : error.message;
    console.error(`Error: ${unavailable}`);
    process.exitCode = 1;
  });
}
