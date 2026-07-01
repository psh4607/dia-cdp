import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = resolve(import.meta.dirname, '../src/cdp.mjs');

describe('forked CDP engine contract', () => {
  it('contains Dia as the first macOS browser candidate', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const diaIndex = source.indexOf("'Dia/User Data'");
    const chromeIndex = source.indexOf("'Google/Chrome'");

    assert.ok(diaIndex >= 0, 'Dia candidate missing');
    assert.ok(chromeIndex >= 0, 'Chrome candidate missing');
    assert.ok(diaIndex < chromeIndex, 'Dia must be preferred over Chrome');
  });

  it('keeps daemon-backed page commands', () => {
    const source = readFileSync(sourcePath, 'utf8');

    assert.match(source, /Per-tab persistent daemon/);
    assert.match(source, /getOrStartTabDaemon/);
    assert.match(source, /Target\.getTargets/);
  });

  it('uses a Dia-specific runtime directory', () => {
    const source = readFileSync(sourcePath, 'utf8');

    assert.match(source, /'dia-cdp'/);
    assert.doesNotMatch(source, /resolve\(homedir\(\), '\.cache', 'cdp'\)/);
  });

  it('bounds WebSocket connection attempts', () => {
    const source = readFileSync(sourcePath, 'utf8');

    assert.match(source, /const CONNECT_TIMEOUT = 12000;/);
    assert.match(source, /Timeout connecting to CDP WebSocket/);
    assert.match(source, /settle\(rej, new Error\(`Timeout connecting to CDP WebSocket after \$\{CONNECT_TIMEOUT\}ms`\)\);\n\s+try \{ this\.#ws\?\.close\(\); \} catch \{\}/);
  });
});
