#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const cdpEnginePath = resolve(currentDir, 'cdp.mjs');

const USAGE = `dia-automation <start|status|stop|path|cdp-command> [args]

Runs a separate Dia automation profile without sharing the user's main profile.

Lifecycle:
  start [http-url]   Start the dedicated profile on an ephemeral CDP port
  status             Inspect the dedicated profile without starting it
  stop [--force]     Stop only the recorded dedicated profile process
  path               Print the dedicated user-data directory

After start, pass any dia-cdp command directly:
  dia-automation list
  dia-automation snap <target>
`;

export function assertSafeProfileDir(profileDir, home = homedir()) {
  const resolvedProfile = resolve(profileDir);
  const mainProfile = resolve(home, 'Library', 'Application Support', 'Dia', 'User Data');
  const relation = relative(mainProfile, resolvedProfile);
  if (relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))) {
    throw new Error('automation profile must not use the main Dia profile tree');
  }
  if (resolvedProfile === resolve(home) || resolvedProfile === '/') {
    throw new Error('automation profile directory is too broad');
  }
  return resolvedProfile;
}

export function resolveAutomationConfig({ home = homedir(), env = process.env } = {}) {
  const profileDir = assertSafeProfileDir(
    env.DIA_AUTOMATION_PROFILE_DIR
      || resolve(home, '.local', 'share', 'dia-cdp', 'automation-profile'),
    home,
  );
  return {
    appExecutable: env.DIA_APP_EXECUTABLE || '/Applications/Dia.app/Contents/MacOS/Dia',
    profileDir,
    portFile: resolve(profileDir, 'User Data', 'DevToolsActivePort'),
    statePath: env.DIA_AUTOMATION_STATE_PATH
      || resolve(home, '.cache', 'dia-cdp', 'automation-profile.json'),
    runtimeDir: env.DIA_AUTOMATION_RUNTIME_DIR
      || resolve(home, '.cache', 'dia-cdp', 'automation-profile-runtime'),
  };
}

export function buildLaunchArgs(profileDir, initialUrl) {
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
  ];
  if (initialUrl) {
    let parsed;
    try {
      parsed = new URL(initialUrl);
    } catch {
      throw new Error('initial URL must be a valid http or https URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('initial URL must use http or https');
    }
    args.push(parsed.href);
  }
  return args;
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getProfileStatus(config, { isProcessAlive = defaultIsProcessAlive } = {}) {
  let state;
  try {
    state = JSON.parse(readFileSync(config.statePath, 'utf8'));
  } catch {
    return { running: false, profileDir: config.profileDir, portFile: config.portFile };
  }
  if (!Number.isInteger(state.pid) || state.pid <= 0 || state.profileDir !== config.profileDir) {
    return { running: false, profileDir: config.profileDir, portFile: config.portFile };
  }
  let port;
  if (existsSync(config.portFile)) {
    const candidate = Number(readFileSync(config.portFile, 'utf8').split('\n')[0]);
    if (Number.isInteger(candidate) && candidate > 0 && candidate <= 65535) port = candidate;
  }
  return {
    running: isProcessAlive(state.pid),
    pid: state.pid,
    ...(port ? { port } : {}),
    startedAt: state.startedAt,
    profileDir: config.profileDir,
    portFile: config.portFile,
  };
}

function removeIfPresent(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function startProfile(config, {
  spawnProcess = spawn,
  isProcessAlive = defaultIsProcessAlive,
  now = () => new Date(),
  wait = delay,
  terminateProcessGroup = defaultTerminateProcessGroup,
  timeoutMs = Number(process.env.DIA_AUTOMATION_START_TIMEOUT_MS || 20_000),
  initialUrl,
} = {}) {
  assertSafeProfileDir(config.profileDir);
  const current = getProfileStatus(config, { isProcessAlive });
  if (current.running && current.port) return current;

  mkdirSync(config.profileDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(config.statePath), { recursive: true, mode: 0o700 });
  removeIfPresent(config.portFile);

  const child = spawnProcess(
    config.appExecutable,
    buildLaunchArgs(config.profileDir, initialUrl),
    { detached: true, stdio: 'ignore' },
  );
  if (!Number.isInteger(child.pid) || child.pid <= 0) {
    throw new Error('Dia automation process did not return a valid pid');
  }
  child.unref?.();
  writeFileSync(config.statePath, JSON.stringify({
    pid: child.pid,
    startedAt: now().toISOString(),
    profileDir: config.profileDir,
    appExecutable: config.appExecutable,
  }, null, 2), { mode: 0o600 });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const status = getProfileStatus(config, { isProcessAlive });
    if (!status.running) {
      removeIfPresent(config.statePath);
      removeIfPresent(config.portFile);
      throw new Error('Dia automation process exited before CDP became available');
    }
    if (status.port) return status;
    await wait(100);
  }
  if (isProcessAlive(child.pid)) terminateProcessGroup(child.pid, 'SIGTERM');
  removeIfPresent(config.statePath);
  removeIfPresent(config.portFile);
  throw new Error(`Dia automation CDP did not become available within ${timeoutMs}ms`);
}

function defaultProcessMatchesProfile(pid, profileDir) {
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    });
    return command.includes(`--user-data-dir=${profileDir}`);
  } catch {
    return false;
  }
}

function defaultTerminateProcessGroup(pid, signal) {
  process.kill(process.platform === 'win32' ? pid : -pid, signal);
}

export async function stopProfile(config, {
  isProcessAlive = defaultIsProcessAlive,
  processMatchesProfile = defaultProcessMatchesProfile,
  terminateProcessGroup = defaultTerminateProcessGroup,
  wait = delay,
  timeoutMs = 10_000,
  force = false,
} = {}) {
  let state;
  try {
    state = JSON.parse(readFileSync(config.statePath, 'utf8'));
  } catch {
    return { stopped: false, profileDir: config.profileDir };
  }
  if (
    !Number.isInteger(state.pid)
    || state.pid <= 0
    || state.profileDir !== config.profileDir
    || state.appExecutable !== config.appExecutable
  ) {
    throw new Error('recorded Dia process does not match the automation profile');
  }
  if (!isProcessAlive(state.pid)) {
    removeIfPresent(config.statePath);
    removeIfPresent(config.portFile);
    return { stopped: false, pid: state.pid, profileDir: config.profileDir };
  }
  if (!processMatchesProfile(state.pid, config.profileDir)) {
    throw new Error('recorded Dia process does not match the automation profile');
  }

  terminateProcessGroup(state.pid, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(state.pid) && Date.now() <= deadline) await wait(100);
  if (isProcessAlive(state.pid) && force) {
    terminateProcessGroup(state.pid, 'SIGKILL');
    await wait(100);
  }
  if (isProcessAlive(state.pid)) {
    throw new Error('Dia automation process did not stop; retry with --force');
  }
  removeIfPresent(config.statePath);
  removeIfPresent(config.portFile);
  return { stopped: true, pid: state.pid, profileDir: config.profileDir };
}

export function parseAutomationArgs(args) {
  const command = args[0];
  if (!command) throw new Error('command is required');
  if (command === 'start') return { command, ...(args[1] ? { initialUrl: args[1] } : {}) };
  if (command === 'status' || command === 'path') return { command };
  if (command === 'stop') return { command, force: args.includes('--force') };
  return { command: 'cdp', cdpArgs: args };
}

async function runCdpCommand(config, cdpArgs) {
  const status = getProfileStatus(config);
  if (!status.running || !status.port) {
    throw new Error('Dia automation profile is not running; run dia-automation start first');
  }
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cdpEnginePath, ...cdpArgs], {
      env: {
        ...process.env,
        CDP_PORT_FILE: config.portFile,
        DIA_CDP_APPROVAL_FREE: '1',
        DIA_CDP_RUNTIME_DIR: config.runtimeDir,
      },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`Dia automation CDP command stopped by ${signal}`));
      else if (code === 0) resolveRun();
      else reject(new Error(`Dia automation CDP command exited with status ${code}`));
    });
  });
}

export async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const config = resolveAutomationConfig();
  const parsed = parseAutomationArgs(argv);
  switch (parsed.command) {
    case 'start':
      console.log(JSON.stringify(await startProfile(config, { initialUrl: parsed.initialUrl }), null, 2));
      return;
    case 'status':
      console.log(JSON.stringify(getProfileStatus(config), null, 2));
      return;
    case 'stop':
      console.log(JSON.stringify(await stopProfile(config, { force: parsed.force }), null, 2));
      return;
    case 'path':
      console.log(config.profileDir);
      return;
    case 'cdp':
      await runCdpCommand(config, parsed.cdpArgs);
      return;
    default:
      throw new Error(`unknown command: ${parsed.command}`);
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
