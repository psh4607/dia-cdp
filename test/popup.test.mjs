import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPopupController } from '../extension/popup.js';

function createElements() {
  return {
    status: { textContent: '', dataset: {} },
    toggle: { checked: false, disabled: false, addEventListener() {} },
    error: { textContent: '', hidden: true },
  };
}

describe('capability popup', () => {
  it('renders the relay-backed page-eval state', async () => {
    const elements = createElements();
    const controller = createPopupController({
      elements,
      sendMessage: async () => ({ ok: true, result: { pageEval: true } }),
    });

    await controller.refresh();

    assert.equal(elements.toggle.checked, true);
    assert.equal(elements.toggle.disabled, false);
    assert.equal(elements.status.textContent, 'Bridge connected');
    assert.equal(elements.status.dataset.state, 'connected');
  });

  it('writes through the relay and adopts its returned state', async () => {
    const calls = [];
    const elements = createElements();
    elements.toggle.checked = true;
    const controller = createPopupController({
      elements,
      sendMessage: async (message) => {
        calls.push(message);
        return { ok: true, result: { pageEval: true } };
      },
    });

    await controller.setPageEval(true);

    assert.deepEqual(calls[0], {
      type: 'relay-control',
      command: 'relay.capabilities.set',
      args: { name: 'page-eval', enabled: true },
    });
    assert.equal(elements.toggle.checked, true);
    assert.equal(elements.toggle.disabled, false);
  });

  it('disables the toggle and shows an error when the relay is unavailable', async () => {
    const elements = createElements();
    elements.toggle.checked = true;
    const controller = createPopupController({
      elements,
      sendMessage: async () => ({ ok: false, error: 'Dia extension bridge is disconnected' }),
    });

    await controller.refresh();

    assert.equal(elements.toggle.checked, false);
    assert.equal(elements.toggle.disabled, true);
    assert.equal(elements.status.textContent, 'Bridge unavailable');
    assert.equal(elements.error.hidden, false);
    assert.match(elements.error.textContent, /disconnected/);
  });

  it('restores the previous state when a toggle write fails', async () => {
    const elements = createElements();
    elements.toggle.checked = true;
    const controller = createPopupController({
      elements,
      sendMessage: async () => ({ ok: false, error: 'write failed' }),
    });

    await controller.setPageEval(true, false);

    assert.equal(elements.toggle.checked, false);
    assert.equal(elements.toggle.disabled, false);
    assert.equal(elements.error.hidden, false);
    assert.match(elements.error.textContent, /write failed/);
  });
});
