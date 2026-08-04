import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as client from '../src/extension-client.mjs';

describe('dia-extension CLI', () => {
  it('maps extension-first CLI commands to allowlisted bridge requests', () => {
    assert.equal(typeof client.parseCliArgs, 'function');
    assert.deepEqual(client.parseCliArgs(['snapshot', '10']), {
      bridgeCommand: 'page.snapshot',
      bridgeArgs: { tabId: 10 },
    });
    assert.deepEqual(client.parseCliArgs(['click', '10', '#save']), {
      bridgeCommand: 'page.click',
      bridgeArgs: { tabId: 10, selector: '#save' },
    });
    assert.deepEqual(client.parseCliArgs(['type', '10', '#name', 'Seongho', 'Bak']), {
      bridgeCommand: 'page.type',
      bridgeArgs: { tabId: 10, selector: '#name', text: 'Seongho Bak' },
    });
    assert.deepEqual(client.parseCliArgs(['type', '10', '#name', '']), {
      bridgeCommand: 'page.type',
      bridgeArgs: { tabId: 10, selector: '#name', text: '' },
    });
    assert.deepEqual(client.parseCliArgs(['navigate', '10', 'https://openai.com/']), {
      bridgeCommand: 'tabs.navigate',
      bridgeArgs: { tabId: 10, url: 'https://openai.com/' },
    });
    assert.deepEqual(client.parseCliArgs(['shot', '10', '/tmp/dia.png']), {
      bridgeCommand: 'page.screenshot',
      bridgeArgs: { tabId: 10 },
      outputPath: '/tmp/dia.png',
    });
    assert.throws(() => client.parseCliArgs(['eval', '10', 'alert(1)']), /unknown command/);
    assert.throws(() => client.parseCliArgs(['scroll-by', '10', 'left', '20']), /numeric x and y/);
  });

  it('writes a bridge screenshot data URL as PNG bytes', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-shot-'));
    const path = resolve(directory, 'shot.png');
    try {
      assert.equal(typeof client.writeScreenshot, 'function');
      client.writeScreenshot('data:image/png;base64,cG5n', path);
      assert.equal(readFileSync(path, 'utf8'), 'png');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
