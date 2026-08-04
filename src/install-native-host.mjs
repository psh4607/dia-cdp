#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
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
const installedCapabilitiesScript = resolve(relayInstallDirectory, 'bridge-capabilities.mjs');
const launchAgentLabel = 'com.psh4607.dia-cdp.relay';
const launchAgentsDirectory = resolve(homedir(), 'Library', 'LaunchAgents');
const launchAgentPath = resolve(launchAgentsDirectory, `${launchAgentLabel}.plist`);
const relayLogDirectory = resolve(homedir(), '.cache', 'dia-cdp');
const { capabilitiesPath, tokenPath } = bridgePaths();

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
      capabilitiesPath,
      relayOrigin: `http://127.0.0.1:${DEFAULT_RELAY_PORT}`,
      launchAgentPath,
    }, null, 2));
  } else {
    const token = ensureBridgeToken(tokenPath);

    mkdirSync(extensionInstallDirectory, { recursive: true, mode: 0o700 });
    for (const fileName of [
      'manifest.json',
      'commands.js',
      'page-operations.js',
      'control-channel.js',
      'service-worker.js',
      'popup.html',
      'popup.css',
      'popup.js',
    ]) {
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
    copyFileSync(resolve(currentDir, 'bridge-capabilities.mjs'), installedCapabilitiesScript);
    chmodSync(installedRelayScript, 0o700);
    chmodSync(installedConfigScript, 0o600);
    chmodSync(installedCapabilitiesScript, 0o600);

    mkdirSync(launchAgentsDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(relayLogDirectory, { recursive: true, mode: 0o700 });
    const launchAgent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchAgentLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${installedRelayScript}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${resolve(relayLogDirectory, 'extension-relay.log')}</string>
  <key>StandardErrorPath</key>
  <string>${resolve(relayLogDirectory, 'extension-relay.error.log')}</string>
</dict>
</plist>
`;
    writeFileSync(launchAgentPath, launchAgent, { mode: 0o600 });
    chmodSync(launchAgentPath, 0o600);

    const launchDomain = `gui/${process.getuid()}`;
    try {
      execFileSync('launchctl', ['bootout', launchDomain, launchAgentPath], { stdio: 'ignore' });
    } catch {
      // The service may not be loaded yet.
    }
    execFileSync('launchctl', ['bootstrap', launchDomain, launchAgentPath], { stdio: 'ignore' });
    execFileSync('launchctl', ['kickstart', '-k', `${launchDomain}/${launchAgentLabel}`], {
      stdio: 'ignore',
    });

    console.log(`Installed stable extension payload: ${extensionInstallDirectory}`);
    console.log(`Installed stable loopback relay: ${relayInstallDirectory}`);
    console.log(`Installed relay LaunchAgent: ${launchAgentPath}`);
    console.log(`Installed private bridge token: ${tokenPath}`);
    console.log('Load or reload the unpacked extension directory in Dia to connect it.');
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  console.error(USAGE);
  process.exitCode = 1;
}
