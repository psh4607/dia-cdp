#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUEST_TIMEOUT_MS = 20_000;
const START_TIMEOUT_MS = 3_000;
const currentDir = dirname(fileURLToPath(import.meta.url));
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
  ping                 Verify the Dia extension bridge
  list                 List Dia tabs without CDP remote-debugging
  get <tab-id>         Get one Dia tab
  activate <tab-id>    Activate one Dia tab
`;

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const args = argv.filter((arg) => arg !== '--json');
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  let bridgeCommand;
  let bridgeArgs = {};
  switch (command) {
    case 'ping':
      bridgeCommand = 'ping';
      break;
    case 'list':
      bridgeCommand = 'tabs.list';
      break;
    case 'get':
    case 'activate': {
      const tabId = Number(args[1]);
      if (!Number.isInteger(tabId) || tabId < 0) {
        throw new Error(`${command} requires a numeric tab id`);
      }
      bridgeCommand = `tabs.${command}`;
      bridgeArgs = { tabId };
      break;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }

  const result = await sendBridgeRequest(bridgeCommand, bridgeArgs);
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
