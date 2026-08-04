#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const DIA_EXECUTABLE = '/Applications/Dia.app/Contents/MacOS/Dia';
const DIA_PORT_FILE = resolve(
  homedir(),
  'Library',
  'Application Support',
  'Dia',
  'User Data',
  'DevToolsActivePort',
);
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 20_000;

const USAGE = `dia-lifecycle <status|start|stop|restart> [--enable-cdp]

Controls only the user's default Dia process. Separate --user-data-dir
automation profiles are never lifecycle targets.

  status                  Inspect default Dia without starting it
  start [--enable-cdp]    Start default Dia; CDP is opt-in
  stop                    Gracefully SIGTERM only default Dia root processes
  restart [--enable-cdp]  Stop, start, and preserve the default profile
`;

export function parseDiaProcessList(output, executable = DIA_EXECUTABLE) {
  return String(output || '').split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) return [];
    const pid = Number(match[1]);
    const command = match[2];
    const isRoot = command === executable || command.startsWith(`${executable} `);
    if (!isRoot || command.includes('--user-data-dir=')) return [];
    return [{
      pid,
      command,
      remoteDebuggingEnabled: command.includes('--remote-debugging-port='),
    }];
  });
}

function defaultListProcesses() {
  const output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return parseDiaProcessList(output);
}

function defaultReadPort() {
  try {
    const port = Number(readFileSync(DIA_PORT_FILE, 'utf8').split('\n')[0]);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

export function getDefaultDiaStatus({
  listProcesses = defaultListProcesses,
  readPort = defaultReadPort,
} = {}) {
  const processes = listProcesses();
  const remoteDebuggingEnabled = processes.some((processInfo) => (
    processInfo.remoteDebuggingEnabled
  ));
  const port = remoteDebuggingEnabled ? readPort() : undefined;
  return {
    running: processes.length > 0,
    pids: processes.map((processInfo) => processInfo.pid),
    remoteDebuggingEnabled,
    ...(port ? { port } : {}),
  };
}

export async function startDefaultDia({
  enableCdp = false,
  listProcesses = defaultListProcesses,
  readPort = defaultReadPort,
  openApplication = (executable, args) => execFileSync(executable, args, { stdio: 'ignore' }),
  signalProcess = (pid, signal) => process.kill(pid, signal),
  wait = delay,
  timeoutMs = START_TIMEOUT_MS,
} = {}) {
  const current = getDefaultDiaStatus({ listProcesses, readPort });
  if (current.running) return { started: false, ...current };

  const args = ['-a', 'Dia'];
  if (enableCdp) args.push('--args', '--remote-debugging-port=9222');
  try {
    openApplication('open', args);
  } catch (error) {
    throw new Error(`default Dia did not launch through macOS: ${error.message}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const status = getDefaultDiaStatus({ listProcesses, readPort });
    if (status.running && (!enableCdp || status.port)) {
      return { started: true, ...status };
    }
    await wait(100);
  }
  for (const processInfo of listProcesses()) signalProcess(processInfo.pid, 'SIGTERM');
  throw new Error(`default Dia did not become ready within ${timeoutMs}ms`);
}

export async function stopDefaultDia({
  listProcesses = defaultListProcesses,
  signalProcess = (pid, signal) => process.kill(pid, signal),
  wait = delay,
  timeoutMs = STOP_TIMEOUT_MS,
} = {}) {
  const processes = listProcesses();
  if (processes.length === 0) return { stopped: false, pids: [] };
  const pids = processes.map((processInfo) => processInfo.pid);
  for (const pid of pids) signalProcess(pid, 'SIGTERM');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (listProcesses().length === 0) return { stopped: true, pids };
    await wait(100);
  }
  throw new Error('default Dia did not stop after SIGTERM; no force kill was attempted');
}

export async function restartDefaultDia(options = {}) {
  const stopped = await stopDefaultDia(options);
  const started = await startDefaultDia(options);
  return { restarted: true, stopped, started };
}

export function parseLifecycleArgs(args) {
  const command = args[0];
  if (!['status', 'start', 'stop', 'restart'].includes(command)) {
    throw new Error(`unknown lifecycle command: ${String(command)}`);
  }
  if (args.includes('--force')) throw new Error('--force is not supported by safe Dia lifecycle');
  const unknown = args.slice(1).filter((arg) => arg !== '--enable-cdp');
  if (unknown.length > 0) throw new Error(`unknown lifecycle option: ${unknown[0]}`);
  const enableCdp = args.includes('--enable-cdp');
  if (enableCdp && !['start', 'restart'].includes(command)) {
    throw new Error('--enable-cdp is only valid with start or restart');
  }
  return { command, enableCdp };
}

export async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const parsed = parseLifecycleArgs(argv);
  let result;
  if (parsed.command === 'status') result = getDefaultDiaStatus();
  else if (parsed.command === 'start') result = await startDefaultDia(parsed);
  else if (parsed.command === 'stop') result = await stopDefaultDia();
  else result = await restartDefaultDia(parsed);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
