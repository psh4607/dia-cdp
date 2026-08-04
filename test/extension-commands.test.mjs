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
  let captureFailuresRemaining = 0;

  return {
    scriptCalls,
    tabCalls,
    failNextCapture() { captureFailuresRemaining += 1; },
    setTabActive(active) { tabs[0].active = active; },
    runtime: {
      getManifest: () => ({ version: '0.3.1' }),
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
  };
}

describe('Dia extension commands', () => {
  it('returns bridge metadata for ping', async () => {
    const result = await handleBridgeRequest(createChromeMock(), { command: 'ping' });

    assert.deepEqual(result, {
      extension: 'Dia Codex Bridge',
      version: '0.3.1',
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
