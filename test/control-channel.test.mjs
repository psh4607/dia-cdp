import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createControlChannel } from '../extension/control-channel.js';

describe('extension control channel', () => {
  it('correlates a popup capability request with the relay response', async () => {
    const sent = [];
    const channel = createControlChannel({
      send(message) {
        sent.push(message);
        return true;
      },
      timeoutMs: 100,
    });

    const response = channel.request('relay.capabilities.get', {});
    assert.equal(sent[0].type, 'control-request');
    assert.equal(sent[0].command, 'relay.capabilities.get');
    channel.handleMessage({
      type: 'control-response',
      id: sent[0].id,
      ok: true,
      result: { pageEval: true },
    });

    assert.deepEqual(await response, { pageEval: true });
  });

  it('rejects immediately while the bridge is disconnected', async () => {
    const channel = createControlChannel({ send: () => false, timeoutMs: 100 });

    await assert.rejects(
      channel.request('relay.capabilities.get', {}),
      /bridge is disconnected/i,
    );
  });

  it('surfaces relay errors to the popup', async () => {
    const sent = [];
    const channel = createControlChannel({
      send(message) {
        sent.push(message);
        return true;
      },
      timeoutMs: 100,
    });

    const response = channel.request('relay.capabilities.set', {
      name: 'page-eval',
      enabled: true,
    });
    channel.handleMessage({
      type: 'control-response',
      id: sent[0].id,
      ok: false,
      error: 'write failed',
    });

    await assert.rejects(response, /write failed/);
  });
});
