import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

describe('dia-cdp bundled skill', () => {
  it('ships a Codex-readable SKILL.md', () => {
    const skill = readFileSync(resolve(root, 'skills/dia-cdp/SKILL.md'), 'utf8');

    assert.match(skill, /^---\nname: dia-cdp\n/m);
    assert.match(skill, /^description: Use when .*Dia.*CDP/m);
    assert.match(skill, /scripts\/dia-cdp list/);
    assert.match(skill, /scripts\/dia-extension list/);
    assert.match(skill, /scripts\/dia-extension snapshot/);
    assert.match(skill, /scripts\/dia-extension click/);
    assert.match(skill, /scripts\/dia-extension type/);
    assert.match(skill, /scripts\/dia-extension shot/);
    assert.match(skill, /scripts\/dia-browser/);
    assert.match(skill, /scripts\/dia-automation start/);
    assert.match(skill, /scripts\/dia-extension window-focus/);
    assert.match(skill, /separate.*user-data-dir/i);
    assert.match(skill, /cookies.*downloads.*clipboard/i);
    assert.match(skill, /--allow-cdp/);
    assert.match(skill, /CDP fallback/);
    assert.match(skill, /Do not call.*chrome-cdp/);
    assert.doesNotMatch(skill, /projects\/seongho\/projects\/dia-cdp\/src\/cdp\.mjs/);
  });

  it('ships a skill-local automation profile wrapper', () => {
    const scriptPath = resolve(root, 'skills/dia-cdp/scripts/dia-automation');
    const script = readFileSync(scriptPath, 'utf8');
    const stat = statSync(scriptPath);

    assert.match(script, /exec "\$PLUGIN_ROOT\/bin\/dia-automation" "\$@"/);
    assert.ok(stat.mode & 0o111, 'automation profile wrapper must be executable');
  });

  it('ships a skill-local CLI wrapper for plugin installs', () => {
    const scriptPath = resolve(root, 'skills/dia-cdp/scripts/dia-cdp');
    const script = readFileSync(scriptPath, 'utf8');
    const stat = statSync(scriptPath);

    assert.match(script, /PLUGIN_ROOT="\$\(cd "\$SCRIPT_DIR\/\.\.\/\.\.\/\.\." && pwd\)"/);
    assert.match(script, /exec "\$PLUGIN_ROOT\/bin\/dia-cdp" "\$@"/);
    assert.ok(stat.mode & 0o111, 'skill wrapper must be executable');
  });

  it('ships a skill-local extension-first router wrapper', () => {
    const scriptPath = resolve(root, 'skills/dia-cdp/scripts/dia-browser');
    const script = readFileSync(scriptPath, 'utf8');
    const stat = statSync(scriptPath);

    assert.match(script, /exec "\$PLUGIN_ROOT\/bin\/dia-browser" "\$@"/);
    assert.ok(stat.mode & 0o111, 'router wrapper must be executable');
  });

  it('ships a skill-local extension bridge wrapper', () => {
    const scriptPath = resolve(root, 'skills/dia-cdp/scripts/dia-extension');
    const script = readFileSync(scriptPath, 'utf8');
    const stat = statSync(scriptPath);

    assert.match(script, /exec "\$PLUGIN_ROOT\/bin\/dia-extension" "\$@"/);
    assert.ok(stat.mode & 0o111, 'extension bridge wrapper must be executable');
  });
});
