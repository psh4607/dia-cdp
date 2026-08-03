#!/usr/bin/env node

import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RELAY_PORT,
  bridgePaths,
  ensureBridgeToken,
} from './bridge-config.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '..');
const bundledExtensionDirectory = resolve(projectRoot, 'extension');
const extensionInstallDirectory = resolve(homedir(), '.local', 'share', 'dia-cdp', 'extension');
const relayInstallDirectory = resolve(homedir(), '.local', 'share', 'dia-cdp', 'relay');
const installedRelayScript = resolve(relayInstallDirectory, 'extension-host.mjs');
const installedConfigScript = resolve(relayInstallDirectory, 'bridge-config.mjs');
const { tokenPath } = bridgePaths();

const USAGE = `install-dia-extension-host [--dry-run]

Installs the Dia Codex Bridge extension and user-only loopback relay.
`;

const help = process.argv.includes('--help') || process.argv.includes('-h');
const dryRun = process.argv.includes('--dry-run');

if (help) {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (dryRun) {
    console.log(JSON.stringify({
      extensionInstallDirectory,
      relayInstallDirectory,
      tokenPath,
      relayOrigin: `http://127.0.0.1:${DEFAULT_RELAY_PORT}`,
    }, null, 2));
  } else {
    const token = ensureBridgeToken(tokenPath);

    mkdirSync(extensionInstallDirectory, { recursive: true, mode: 0o700 });
    for (const fileName of ['manifest.json', 'commands.js', 'service-worker.js']) {
      const target = resolve(extensionInstallDirectory, fileName);
      copyFileSync(resolve(bundledExtensionDirectory, fileName), target);
      chmodSync(target, 0o600);
    }
    const installedExtensionConfig = resolve(extensionInstallDirectory, 'bridge-config.js');
    writeFileSync(installedExtensionConfig, [
      `export const BRIDGE_TOKEN = ${JSON.stringify(token)};`,
      `export const RELAY_ORIGIN = ${JSON.stringify(`http://127.0.0.1:${DEFAULT_RELAY_PORT}`)};`,
      '',
    ].join('\n'), { mode: 0o600 });
    chmodSync(installedExtensionConfig, 0o600);

    mkdirSync(relayInstallDirectory, { recursive: true, mode: 0o700 });
    copyFileSync(resolve(currentDir, 'extension-host.mjs'), installedRelayScript);
    copyFileSync(resolve(currentDir, 'bridge-config.mjs'), installedConfigScript);
    chmodSync(installedRelayScript, 0o700);
    chmodSync(installedConfigScript, 0o600);

    console.log(`Installed stable extension payload: ${extensionInstallDirectory}`);
    console.log(`Installed stable loopback relay: ${relayInstallDirectory}`);
    console.log(`Installed private bridge token: ${tokenPath}`);
    console.log('Load or reload the unpacked extension directory in Dia to connect it.');
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  console.error(USAGE);
  process.exitCode = 1;
}
