import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

describe('Codex plugin package', () => {
  it('defines a root plugin manifest with bundled skills', () => {
    const plugin = readJson('.codex-plugin/plugin.json');

    assert.equal(plugin.name, 'dia-cdp');
    assert.equal(plugin.version, '0.1.0');
    assert.equal(plugin.repository, 'https://github.com/psh4607/dia-cdp');
    assert.equal(plugin.skills, './skills/');
    assert.equal(plugin.interface.displayName, 'Dia CDP');
    assert.match(plugin.interface.longDescription, /Dia-focused Chrome DevTools Protocol CLI/);
  });

  it('defines a marketplace snapshot that installs the root plugin', () => {
    const marketplace = readJson('.agents/plugins/marketplace.json');
    const plugin = marketplace.plugins[0];

    assert.equal(marketplace.name, 'dia-cdp');
    assert.equal(plugin.name, 'dia-cdp');
    assert.equal(plugin.source.source, 'local');
    assert.equal(plugin.source.path, '.');
    assert.equal(plugin.policy.installation, 'AVAILABLE');
    assert.equal(plugin.policy.authentication, 'ON_USE');
  });
});
