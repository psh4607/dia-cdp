import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleBridgeRequest, sanitizeTab } from '../extension/commands.js';

function createChromeMock() {
  const tabs = [
    {
      id: 10,
      windowId: 2,
      index: 0,
      active: true,
      pinned: false,
      title: 'Example',
      url: 'https://example.com/',
      status: 'complete',
      incognito: false,
    },
  ];

  const scriptCalls = [];
  const tabCalls = [];
  const windowCalls = [];
  let captureFailuresRemaining = 0;

  return {
    scriptCalls,
    tabCalls,
    windowCalls,
    failNextCapture() { captureFailuresRemaining += 1; },
    setTabActive(active) { tabs[0].active = active; },
    runtime: {
      getManifest: () => ({ version: '0.4.0' }),
    },
    scripting: {
      executeScript: async (details) => {
        scriptCalls.push(details);
        return [{ result: { operation: details.args[0], args: details.args[1] } }];
      },
    },
    tabs: {
      query: async () => tabs,
      get: async (tabId) => tabs.find((tab) => tab.id === tabId),
      update: async (tabId, update) => {
        tabCalls.push(['update', tabId, update]);
        return { ...tabs.find((tab) => tab.id === tabId), ...update };
      },
      reload: async (tabId) => { tabCalls.push(['reload', tabId]); },
      create: async (createProperties) => {
        tabCalls.push(['create', createProperties]);
        return { ...tabs[0], id: 11, ...createProperties };
      },
      remove: async (tabId) => { tabCalls.push(['remove', tabId]); },
      captureVisibleTab: async (windowId, options) => {
        tabCalls.push(['captureVisibleTab', windowId, options]);
        if (captureFailuresRemaining > 0) {
          captureFailuresRemaining -= 1;
          throw new Error('Failed to capture tab: image readback failed');
        }
        return 'data:image/png;base64,c2NyZWVuc2hvdA==';
      },
    },
    windows: {
      update: async (windowId, update) => {
        windowCalls.push(['update', windowId, update]);
        return { id: windowId, ...update };
      },
    },
  };
}

describe('Dia extension commands', () => {
  it('returns bridge metadata for ping', async () => {
    const result = await handleBridgeRequest(createChromeMock(), { command: 'ping' });

    assert.deepEqual(result, {
      extension: 'Dia Codex Bridge',
      version: '0.4.0',
    });
  });

  it('lists sanitized tab metadata', async () => {
    const result = await handleBridgeRequest(createChromeMock(), { command: 'tabs.list' });

    assert.deepEqual(result, [{
      id: 10,
      windowId: 2,
      index: 0,
      active: true,
      pinned: false,
      status: 'complete',
      title: 'Example',
      url: 'https://example.com/',
    }]);
    assert.equal('incognito' in result[0], false);
  });

  it('gets and activates a numeric tab id', async () => {
    const chromeApi = createChromeMock();
    const selected = await handleBridgeRequest(chromeApi, {
      command: 'tabs.get',
      args: { tabId: 10 },
    });
    const activated = await handleBridgeRequest(chromeApi, {
      command: 'tabs.activate',
      args: { tabId: 10 },
    });

    assert.equal(selected.id, 10);
    assert.equal(activated.active, true);
  });

  it('focuses the selected tab and its containing window', async () => {
    const chromeApi = createChromeMock();
    const focused = await handleBridgeRequest(chromeApi, {
      command: 'windows.focusTab',
      args: { tabId: 10 },
    });

    assert.deepEqual(chromeApi.tabCalls, [['update', 10, { active: true }]]);
    assert.deepEqual(chromeApi.windowCalls, [['update', 2, { focused: true }]]);
    assert.equal(focused.id, 10);
    assert.equal(focused.active, true);
  });

  it('runs allowlisted page operations through chrome.scripting', async () => {
    const chromeApi = createChromeMock();
    for (const operation of [
      'snapshot',
      'query',
      'text',
      'html',
      'click',
      'type',
      'focus',
      'scroll',
      'select',
      'key',
    ]) {
      const result = await handleBridgeRequest(chromeApi, {
        command: `page.${operation}`,
        args: { tabId: 10, selector: '#save' },
      });
      assert.deepEqual(result, {
        operation,
        args: { selector: '#save' },
      });
    }

    assert.equal(chromeApi.scriptCalls.length, 10);
    assert.equal(chromeApi.scriptCalls[0].target.tabId, 10);
    assert.equal(typeof chromeApi.scriptCalls[0].func, 'function');
  });

  it('runs network, eval, coordinate click, and load-all without chrome.debugger', async () => {
    const chromeApi = createChromeMock();
    await handleBridgeRequest(chromeApi, {
      command: 'page.network', args: { tabId: 10 },
    });
    await handleBridgeRequest(chromeApi, {
      command: 'page.eval', args: { tabId: 10, expression: 'document.title' },
    });
    await handleBridgeRequest(chromeApi, {
      command: 'page.clickxy', args: { tabId: 10, x: 120, y: 240 },
    });
    await handleBridgeRequest(chromeApi, {
      command: 'page.loadall',
      args: { tabId: 10, selector: '.load-more', intervalMs: 250 },
    });

    assert.equal(chromeApi.scriptCalls.length, 4);
    assert.equal(chromeApi.scriptCalls[0].args[0], 'network');
    assert.equal(chromeApi.scriptCalls[1].world, 'MAIN');
    assert.equal(chromeApi.scriptCalls[1].func.name, 'executePageEvaluation');
    assert.deepEqual(chromeApi.scriptCalls[1].args, ['document.title']);
    assert.equal(chromeApi.scriptCalls[2].args[0], 'clickxy');
    assert.equal(chromeApi.scriptCalls[3].func.name, 'executeLoadAll');
    assert.deepEqual(chromeApi.scriptCalls[3].args, [{
      selector: '.load-more',
      intervalMs: 250,
    }]);
  });

  it('navigates, reloads, creates, and closes tabs', async () => {
    const chromeApi = createChromeMock();

    const navigated = await handleBridgeRequest(chromeApi, {
      command: 'tabs.navigate',
      args: { tabId: 10, url: 'https://openai.com/' },
    });
    const reloaded = await handleBridgeRequest(chromeApi, {
      command: 'tabs.reload', args: { tabId: 10 },
    });
    const created = await handleBridgeRequest(chromeApi, {
      command: 'tabs.create', args: { url: 'https://example.com/new', active: false },
    });
    const closed = await handleBridgeRequest(chromeApi, {
      command: 'tabs.close', args: { tabId: 10 },
    });

    assert.equal(navigated.url, 'https://openai.com/');
    assert.deepEqual(reloaded, { reloaded: true, tabId: 10 });
    assert.equal(created.id, 11);
    assert.deepEqual(closed, { closed: true, tabId: 10 });
    assert.deepEqual(chromeApi.tabCalls.slice(-4), [
      ['update', 10, { url: 'https://openai.com/' }],
      ['reload', 10],
      ['create', { url: 'https://example.com/new', active: false }],
      ['remove', 10],
    ]);
  });

  it('captures the requested visible tab without CDP', async () => {
    const chromeApi = createChromeMock();

    assert.deepEqual(await handleBridgeRequest(chromeApi, {
      command: 'page.screenshot', args: { tabId: 10 },
    }), {
      dataUrl: 'data:image/png;base64,c2NyZWVuc2hvdA==',
      format: 'png',
    });
    assert.deepEqual(chromeApi.tabCalls, [
      ['captureVisibleTab', 2, { format: 'png' }],
    ]);
  });

  it('retries a transient image readback failure after activating a background tab', async () => {
    const chromeApi = createChromeMock();
    chromeApi.setTabActive(false);
    chromeApi.failNextCapture();

    const result = await handleBridgeRequest(chromeApi, {
      command: 'page.screenshot', args: { tabId: 10 },
    });

    assert.equal(result.format, 'png');
    assert.equal(
      chromeApi.tabCalls.filter(([command]) => command === 'captureVisibleTab').length,
      2,
    );
  });

  it('rejects invalid ids and unsupported commands', async () => {
    const chromeApi = createChromeMock();

    await assert.rejects(
      handleBridgeRequest(chromeApi, { command: 'tabs.get', args: { tabId: '10' } }),
      /tabId must be a non-negative integer/,
    );
    await assert.rejects(
      handleBridgeRequest(chromeApi, { command: 'page.eval' }),
      /tabId must be a non-negative integer/,
    );
    await assert.rejects(
      handleBridgeRequest(chromeApi, { command: 'page.unsupported' }),
      /unsupported command/,
    );
  });

  it('keeps only explicitly allowed tab fields', () => {
    assert.deepEqual(sanitizeTab({ id: 1, title: 'A', secret: 'nope' }), {
      id: 1,
      title: 'A',
    });
  });
});
