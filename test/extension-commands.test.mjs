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

  return {
    runtime: {
      getManifest: () => ({ version: '0.2.0' }),
    },
    tabs: {
      query: async () => tabs,
      get: async (tabId) => tabs.find((tab) => tab.id === tabId),
      update: async (tabId, update) => ({
        ...tabs.find((tab) => tab.id === tabId),
        ...update,
      }),
    },
  };
}

describe('Dia extension commands', () => {
  it('returns bridge metadata for ping', async () => {
    const result = await handleBridgeRequest(createChromeMock(), { command: 'ping' });

    assert.deepEqual(result, {
      extension: 'Dia Codex Bridge',
      version: '0.2.0',
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
