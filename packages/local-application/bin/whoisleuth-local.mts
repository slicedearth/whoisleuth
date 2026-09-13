#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import manifest from '../package.json' with { type: 'json' };
import { parseLocalApplicationArguments } from '../arguments.mts';

const HELP = `WHOISleuth local application

Usage:
  whoisleuth-local --workspace <directory> [--port <0-65535>] [--offline]
  whoisleuth-local --workspace <new-directory> --init [--port <0-65535>] [--offline]
  whoisleuth-local --version

Use Node.js 24.19 or newer. The application listens only on 127.0.0.1.
Port 0 selects an available port; an explicit port preserves browser preferences.
Open the private launch link printed in this terminal. No hosting password is used.
Saved records, drafts and retained files live in the selected folder, not IndexedDB.
The workspace is not encrypted; protect the folder and use encrypted portable backups.
--init creates a new workspace and never overwrites an existing file.
--offline disables product collection. Without it, existing explicit network actions use this machine.
Stop with Ctrl+C before moving, deleting or copying the workspace folder.
Exit 0 means normal completion; exit 2 means invalid input or an operation failure.
`;

try {
  const options = parseLocalApplicationArguments(process.argv.slice(2));
  if (options.operation === 'help') process.stdout.write(HELP);
  else if (options.operation === 'version') process.stdout.write(`${manifest.version}\n`);
  else {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    if (major < 24 || major === 24 && minor < 19) throw new Error('The local application requires Node.js 24.19 or newer.');
    const [{ app }, { startLocalApplication }] = await Promise.all([import('../../../server.mts'), import('../../../lib/local-application-host.mts')]);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const instance = await startLocalApplication({ ...options, application: app, buildDirectory: path.join(root, 'frontend/build') });
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      void instance.close().then(() => { process.off('SIGINT', stop); process.off('SIGTERM', stop); })
        .catch(() => { process.stderr.write('The local application could not confirm a clean shutdown. Inspect the workspace before restarting.\n'); process.exitCode = 2; });
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    process.stdout.write(`Filesystem workspace: ${instance.directory}\n${options.offline ? 'Offline collection mode.' : 'Network collection remains explicit.'}\nOpen this private launch link:\n${instance.launchUrl}\nStop with Ctrl+C before moving the workspace.\n`);
  }
} catch (cause) {
  // Native paths and stacks are not exposed. Argument errors contain only the
  // selected option names; workspace errors already use bounded descriptions.
  const message = cause instanceof Error && (cause instanceof TypeError || 'code' in cause && String(cause.code).startsWith('LOCAL_DATA_'))
    ? cause.message.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 500) : 'The local application could not start. Check the runtime, production build, selected folder and private filesystem permissions.';
  process.stderr.write(`Local application error: ${message}\n`); process.exitCode = 2;
}
