import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as automation from '../src/automation-profile.mjs';

describe('isolated Dia automation profile', () => {
  it('uses a dedicated user-data directory and rejects the main Dia profile tree', () => {
    assert.equal(typeof automation.resolveAutomationConfig, 'function');
    assert.equal(typeof automation.assertSafeProfileDir, 'function');
    if (!automation.resolveAutomationConfig || !automation.assertSafeProfileDir) return;
    const home = '/Users/example';
    const config = automation.resolveAutomationConfig({ home, env: {} });

    assert.equal(config.profileDir, '/Users/example/.local/share/dia-cdp/automation-profile');
    assert.equal(config.portFile, resolve(config.profileDir, 'User Data', 'DevToolsActivePort'));
    assert.equal(config.statePath, '/Users/example/.cache/dia-cdp/automation-profile.json');
    assert.equal(config.runtimeDir, '/Users/example/.cache/dia-cdp/automation-profile-runtime');
    assert.doesNotThrow(() => automation.assertSafeProfileDir(config.profileDir, home));
    assert.throws(
      () => automation.assertSafeProfileDir('/Users/example/Library/Application Support/Dia/User Data', home),
      /main Dia profile/,
    );
    assert.throws(
      () => automation.assertSafeProfileDir('/Users/example/Library/Application Support/Dia/User Data/Default', home),
      /main Dia profile/,
    );
  });

  it('launches Dia with an isolated profile and an ephemeral debugging port', () => {
    assert.equal(typeof automation.buildLaunchArgs, 'function');
    if (!automation.buildLaunchArgs) return;
    assert.deepEqual(automation.buildLaunchArgs('/tmp/dia-automation', 'https://example.com/'), [
      '--user-data-dir=/tmp/dia-automation',
      '--remote-debugging-port=0',
      '--no-first-run',
      'https://example.com/',
    ]);
    assert.throws(
      () => automation.buildLaunchArgs('/tmp/dia-automation', 'file:///tmp/private'),
      /http or https/,
    );
  });

  it('reports existing state without starting or mutating the profile', () => {
    assert.equal(typeof automation.getProfileStatus, 'function');
    if (!automation.getProfileStatus) return;
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-automation-test-'));
    const profileDir = resolve(directory, 'profile');
    const statePath = resolve(directory, 'state.json');
    const portFile = resolve(profileDir, 'DevToolsActivePort');
    try {
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(statePath, JSON.stringify({
        pid: 1234,
        startedAt: '2026-08-04T00:00:00.000Z',
        profileDir,
      }));
      writeFileSync(portFile, '48123\n/devtools/browser/test\n');

      const status = automation.getProfileStatus(
        { profileDir, statePath, portFile },
        { isProcessAlive: (pid) => pid === 1234 },
      );

      assert.deepEqual(status, {
        running: true,
        pid: 1234,
        port: 48123,
        startedAt: '2026-08-04T00:00:00.000Z',
        profileDir,
        portFile,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('starts only the dedicated executable and persists its exact pid', async () => {
    assert.equal(typeof automation.startProfile, 'function');
    if (!automation.startProfile) return;
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-automation-start-'));
    const config = {
      appExecutable: '/Applications/Dia.app/Contents/MacOS/Dia',
      profileDir: resolve(directory, 'profile'),
      portFile: resolve(directory, 'profile', 'DevToolsActivePort'),
      statePath: resolve(directory, 'runtime', 'state.json'),
    };
    const spawnCalls = [];
    try {
      const status = await automation.startProfile(config, {
        spawnProcess: (executable, args, options) => {
          spawnCalls.push([executable, args, options]);
          writeFileSync(config.portFile, '48124\n/devtools/browser/test\n');
          return { pid: 4321, unref() {} };
        },
        isProcessAlive: (pid) => pid === 4321,
        now: () => new Date('2026-08-04T01:00:00.000Z'),
      });

      assert.deepEqual(spawnCalls, [[
        config.appExecutable,
        buildExpectedArgs(config.profileDir),
        { detached: true, stdio: 'ignore' },
      ]]);
      assert.equal(status.running, true);
      assert.equal(status.port, 48124);
      assert.deepEqual(JSON.parse(readFileSync(config.statePath, 'utf8')), {
        pid: 4321,
        startedAt: '2026-08-04T01:00:00.000Z',
        profileDir: config.profileDir,
        appExecutable: config.appExecutable,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('cleans up the newly spawned process when its CDP port never appears', async () => {
    assert.equal(typeof automation.startProfile, 'function');
    if (!automation.startProfile) return;
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-automation-timeout-'));
    const config = {
      appExecutable: '/Applications/Dia.app/Contents/MacOS/Dia',
      profileDir: resolve(directory, 'profile'),
      portFile: resolve(directory, 'profile', 'User Data', 'DevToolsActivePort'),
      statePath: resolve(directory, 'runtime', 'state.json'),
    };
    const signals = [];
    try {
      await assert.rejects(
        automation.startProfile(config, {
          spawnProcess: () => ({ pid: 7654, unref() {} }),
          isProcessAlive: () => true,
          terminateProcessGroup: (pid, signal) => signals.push([pid, signal]),
          timeoutMs: -1,
        }),
        /did not become available/,
      );
      assert.deepEqual(signals, [[7654, 'SIGTERM']]);
      assert.equal(existsSync(config.statePath), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stops only a verified recorded automation process and preserves profile data', async () => {
    assert.equal(typeof automation.stopProfile, 'function');
    if (!automation.stopProfile) return;
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-automation-stop-'));
    const config = {
      appExecutable: '/Applications/Dia.app/Contents/MacOS/Dia',
      profileDir: resolve(directory, 'profile'),
      portFile: resolve(directory, 'profile', 'DevToolsActivePort'),
      statePath: resolve(directory, 'runtime', 'state.json'),
    };
    let alive = true;
    const signals = [];
    try {
      mkdirSync(config.profileDir, { recursive: true });
      mkdirSync(resolve(directory, 'runtime'), { recursive: true });
      writeFileSync(resolve(config.profileDir, 'kept-cookie-state'), 'preserve');
      writeFileSync(config.portFile, '48125\n/devtools/browser/test\n');
      writeFileSync(config.statePath, JSON.stringify({
        pid: 9876,
        startedAt: '2026-08-04T01:00:00.000Z',
        profileDir: config.profileDir,
        appExecutable: config.appExecutable,
      }));

      const result = await automation.stopProfile(config, {
        isProcessAlive: () => alive,
        processMatchesProfile: () => true,
        terminateProcessGroup: (pid, signal) => {
          signals.push([pid, signal]);
          alive = false;
        },
      });

      assert.deepEqual(signals, [[9876, 'SIGTERM']]);
      assert.deepEqual(result, { stopped: true, pid: 9876, profileDir: config.profileDir });
      assert.equal(existsSync(config.statePath), false);
      assert.equal(readFileSync(resolve(config.profileDir, 'kept-cookie-state'), 'utf8'), 'preserve');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses to stop a pid whose command does not match the automation profile', async () => {
    assert.equal(typeof automation.stopProfile, 'function');
    if (!automation.stopProfile) return;
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-automation-guard-'));
    const config = {
      appExecutable: '/Applications/Dia.app/Contents/MacOS/Dia',
      profileDir: resolve(directory, 'profile'),
      portFile: resolve(directory, 'profile', 'DevToolsActivePort'),
      statePath: resolve(directory, 'state.json'),
    };
    try {
      mkdirSync(config.profileDir, { recursive: true });
      writeFileSync(config.statePath, JSON.stringify({
        pid: 2468,
        profileDir: config.profileDir,
        appExecutable: config.appExecutable,
      }));
      await assert.rejects(
        automation.stopProfile(config, {
          isProcessAlive: () => true,
          processMatchesProfile: () => false,
          terminateProcessGroup: () => assert.fail('must not signal an unrelated process'),
        }),
        /does not match the automation profile/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps lifecycle commands separate from explicit CDP commands', () => {
    assert.equal(typeof automation.parseAutomationArgs, 'function');
    if (!automation.parseAutomationArgs) return;
    assert.deepEqual(automation.parseAutomationArgs(['start', 'https://example.com/']), {
      command: 'start',
      initialUrl: 'https://example.com/',
    });
    assert.deepEqual(automation.parseAutomationArgs(['status']), { command: 'status' });
    assert.deepEqual(automation.parseAutomationArgs(['stop', '--force']), {
      command: 'stop',
      force: true,
    });
    assert.deepEqual(automation.parseAutomationArgs(['path']), { command: 'path' });
    assert.deepEqual(automation.parseAutomationArgs(['list']), {
      command: 'cdp',
      cdpArgs: ['list'],
    });
    assert.throws(() => automation.parseAutomationArgs([]), /command is required/);
  });
});

function buildExpectedArgs(profileDir) {
  return [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
  ];
}
