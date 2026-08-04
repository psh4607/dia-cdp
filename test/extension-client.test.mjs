import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as client from '../src/extension-client.mjs';

describe('dia-extension CLI', () => {
  it('detects when the stable extension payload needs a plugin update sync', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-sync-'));
    const bundled = resolve(directory, 'bundled.json');
    const installed = resolve(directory, 'installed.json');
    try {
      writeFileSync(bundled, JSON.stringify({ version: '0.4.0' }));
      writeFileSync(installed, JSON.stringify({ version: '0.3.1' }));
      assert.equal(typeof client.payloadSyncRequired, 'function');
      assert.equal(client.payloadSyncRequired(bundled, installed), true);
      writeFileSync(installed, JSON.stringify({ version: '0.4.0' }));
      assert.equal(client.payloadSyncRequired(bundled, installed), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('classifies extension-first routes without silently falling back to CDP', () => {
    assert.equal(typeof client.classifyRoute, 'function');
    assert.deepEqual(client.classifyRoute(['snapshot', '10']), {
      route: 'extension',
      bridgeCommand: 'page.snapshot',
      bridgeArgs: { tabId: 10 },
    });
    assert.deepEqual(client.classifyRoute(['net', 'ABCDEF12']), {
      route: 'cdp',
      cdpArgs: ['net', 'ABCDEF12'],
      requiresConsent: true,
    });
    assert.deepEqual(client.classifyRoute(['cdp-status']), {
      route: 'cdp',
      cdpArgs: ['status'],
      requiresConsent: false,
    });
    assert.throws(
      () => client.classifyRoute(['--cdp', 'click', 'ABCDEF12', '#save']),
      /--allow-cdp/,
    );
    assert.deepEqual(
      client.classifyRoute(['--allow-cdp', '--cdp', 'click', 'ABCDEF12', '#save']),
      {
        route: 'cdp',
        cdpArgs: ['click', 'ABCDEF12', '#save'],
        requiresConsent: true,
      },
    );
  });

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
