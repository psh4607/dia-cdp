import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as lifecycle from '../src/dia-lifecycle.mjs';

const DIA = '/Applications/Dia.app/Contents/MacOS/Dia';

describe('default Dia lifecycle', () => {
  it('selects only default-profile Dia root processes', () => {
    assert.equal(typeof lifecycle.parseDiaProcessList, 'function');
    if (!lifecycle.parseDiaProcessList) return;
    const processes = lifecycle.parseDiaProcessList([
      `20354 ${DIA} --remote-debugging-port=9222`,
      `30021 ${DIA} --user-data-dir=/tmp/dia-automation --remote-debugging-port=0`,
      '30030 /Applications/Dia.app/Contents/Frameworks/ArcCore.framework/Helpers/Browser Helper --type=gpu-process',
      '40000 /bin/zsh -lc something',
    ].join('\n'));

    assert.deepEqual(processes, [{
      pid: 20354,
      command: `${DIA} --remote-debugging-port=9222`,
      remoteDebuggingEnabled: true,
    }]);
  });

  it('reports default Dia status without starting it', () => {
    assert.equal(typeof lifecycle.getDefaultDiaStatus, 'function');
    if (!lifecycle.getDefaultDiaStatus) return;
    let calls = 0;
    const status = lifecycle.getDefaultDiaStatus({
      listProcesses: () => {
        calls += 1;
        return [{ pid: 20354, command: `${DIA} --remote-debugging-port=9222`, remoteDebuggingEnabled: true }];
      },
      readPort: () => 9222,
    });

    assert.deepEqual(status, {
      running: true,
      pids: [20354],
      remoteDebuggingEnabled: true,
      port: 9222,
    });
    assert.equal(calls, 1);
  });

  it('starts the default profile without CDP unless explicitly enabled', async () => {
    assert.equal(typeof lifecycle.startDefaultDia, 'function');
    if (!lifecycle.startDefaultDia) return;
    const openCalls = [];
    let running = false;
    const result = await lifecycle.startDefaultDia({
      enableCdp: false,
      listProcesses: () => running
        ? [{ pid: 51000, command: DIA, remoteDebuggingEnabled: false }]
        : [],
      openApplication: (executable, args) => {
        openCalls.push([executable, args]);
        running = true;
      },
      wait: async () => {},
    });

    assert.deepEqual(openCalls, [['open', ['-a', 'Dia']]]);
    assert.equal(result.started, true);
    assert.equal(result.remoteDebuggingEnabled, false);
  });

  it('can explicitly start the default profile with CDP exposed', async () => {
    assert.equal(typeof lifecycle.startDefaultDia, 'function');
    if (!lifecycle.startDefaultDia) return;
    const openCalls = [];
    let running = false;
    await lifecycle.startDefaultDia({
      enableCdp: true,
      listProcesses: () => running
        ? [{ pid: 52000, command: `${DIA} --remote-debugging-port=9222`, remoteDebuggingEnabled: true }]
        : [],
      openApplication: (executable, args) => {
        openCalls.push([executable, args]);
        running = true;
      },
      readPort: () => 9222,
      wait: async () => {},
    });

    assert.deepEqual(openCalls, [[
      'open',
      ['-a', 'Dia', '--args', '--remote-debugging-port=9222'],
    ]]);
  });

  it('stops only verified default-profile roots with SIGTERM', async () => {
    assert.equal(typeof lifecycle.stopDefaultDia, 'function');
    if (!lifecycle.stopDefaultDia) return;
    let processes = [{ pid: 20354, command: DIA, remoteDebuggingEnabled: false }];
    const signals = [];
    const result = await lifecycle.stopDefaultDia({
      listProcesses: () => processes,
      signalProcess: (pid, signal) => {
        signals.push([pid, signal]);
        processes = [];
      },
      wait: async () => {},
    });

    assert.deepEqual(signals, [[20354, 'SIGTERM']]);
    assert.deepEqual(result, { stopped: true, pids: [20354] });
  });

  it('restarts by stopping the verified default root before starting a new one', async () => {
    assert.equal(typeof lifecycle.restartDefaultDia, 'function');
    if (!lifecycle.restartDefaultDia) return;
    let processInfo = { pid: 20354, command: DIA, remoteDebuggingEnabled: false };
    const events = [];
    const result = await lifecycle.restartDefaultDia({
      listProcesses: () => processInfo ? [processInfo] : [],
      signalProcess: (pid, signal) => {
        events.push(['signal', pid, signal]);
        processInfo = undefined;
      },
      openApplication: (executable, args) => {
        events.push(['open', executable, args]);
        processInfo = { pid: 53000, command: executable, remoteDebuggingEnabled: false };
      },
      wait: async () => {},
    });

    assert.deepEqual(events, [
      ['signal', 20354, 'SIGTERM'],
      ['open', 'open', ['-a', 'Dia']],
    ]);
    assert.equal(result.restarted, true);
    assert.equal(result.started.started, true);
  });

  it('parses lifecycle commands without an implicit force mode', () => {
    assert.equal(typeof lifecycle.parseLifecycleArgs, 'function');
    if (!lifecycle.parseLifecycleArgs) return;
    assert.deepEqual(lifecycle.parseLifecycleArgs(['status']), { command: 'status', enableCdp: false });
    assert.deepEqual(lifecycle.parseLifecycleArgs(['start']), { command: 'start', enableCdp: false });
    assert.deepEqual(lifecycle.parseLifecycleArgs(['restart', '--enable-cdp']), {
      command: 'restart',
      enableCdp: true,
    });
    assert.throws(() => lifecycle.parseLifecycleArgs(['stop', '--force']), /--force is not supported/);
  });
});
