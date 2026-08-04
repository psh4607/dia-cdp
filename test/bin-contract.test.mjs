import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

describe('dia-cdp wrapper contract', () => {
  it('ships a unified extension-first browser router', () => {
    const wrapper = readFileSync(resolve(root, 'bin/dia-browser'), 'utf8');

    assert.match(wrapper, /src\/extension-client\.mjs/);
  });

  it('ships an isolated Dia automation profile launcher', () => {
    const wrapperPath = resolve(root, 'bin/dia-automation');
    const enginePath = resolve(root, 'src/automation-profile.mjs');
    assert.equal(existsSync(wrapperPath), true, 'bin/dia-automation must exist');
    assert.equal(existsSync(enginePath), true, 'automation profile engine must exist');
    assert.ok(statSync(wrapperPath).mode & 0o111, 'bin/dia-automation must be executable');
    const wrapper = readFileSync(wrapperPath, 'utf8');
    assert.match(wrapper, /src\/automation-profile\.mjs/);
  });

  it('ships a safe default Dia lifecycle controller', () => {
    const wrapperPath = resolve(root, 'bin/dia-lifecycle');
    const enginePath = resolve(root, 'src/dia-lifecycle.mjs');
    assert.equal(existsSync(wrapperPath), true, 'bin/dia-lifecycle must exist');
    assert.equal(existsSync(enginePath), true, 'default Dia lifecycle engine must exist');
    assert.ok(statSync(wrapperPath).mode & 0o111, 'bin/dia-lifecycle must be executable');
    const wrapper = readFileSync(wrapperPath, 'utf8');
    assert.match(wrapper, /src\/dia-lifecycle\.mjs/);
  });

  it('execs the project-local CDP engine with Dia DevToolsActivePort', () => {
    const wrapper = readFileSync(resolve(root, 'bin/dia-cdp'), 'utf8');

    assert.match(wrapper, /CDP_SCRIPT="\$PROJECT_ROOT\/src\/cdp\.mjs"/);
    assert.match(wrapper, /Application Support\/Dia\/User Data\/DevToolsActivePort/);
    assert.match(wrapper, /exec env CDP_PORT_FILE="\$PORT_FILE" node "\$CDP_SCRIPT" "\$@"/);
  });

  it('resolves its real path when launched through a symlink', () => {
    const wrapper = readFileSync(resolve(root, 'bin/dia-cdp'), 'utf8');

    assert.match(wrapper, /SOURCE="\$\{BASH_SOURCE\[0\]\}"/);
    assert.match(wrapper, /while \[\[ -L "\$SOURCE" \]\]/);
    assert.match(wrapper, /readlink "\$SOURCE"/);
  });
});
