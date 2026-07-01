import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

describe('dia-cdp wrapper contract', () => {
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
