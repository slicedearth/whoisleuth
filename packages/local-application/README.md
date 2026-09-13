# WHOISleuth local application

The optional local application serves the existing console on your computer and
keeps saved records, review drafts and retained files in one selected folder.
It is separate from the command-line evidence tool and rendered-capture companion.

## Run

This package is currently distributed as a locally assembled archive, not a
published npm release. Install that reviewed archive with scripts disabled:

```sh
npm install --offline --ignore-scripts --omit=optional ./whoisleuth-local-1.0.0.tgz
npx --no-install whoisleuth-local --workspace ./investigation --init --offline
```

Use Node.js 24.19 or newer. Open the private launch link printed in the terminal.
The server accepts only `127.0.0.1` requests with its own session and origin. The
link is a credential for that running instance; do not share it. There is no
hosting password, external account, telemetry or automatic browser installation.
The archive bundles its reviewed runtime dependencies. Installation can stay
offline and does not select newer transitive versions.

Omit `--init` to reopen a workspace. Omit `--offline` to enable the same deliberate
collection actions as the console; those requests then originate from this
computer. Use only targets you are authorised to assess. `--port 0` selects an
available port; select a fixed free port to retain the browser origin used for
appearance preferences and temporary page state.

## Storage and recovery

The selected folder contains `workspace.sqlite` and may briefly contain its
transaction journal. Saved collections and evidence files share atomic writes;
concurrent tabs use revision checks. A lost acknowledgement is checked against
its exact commit receipt. An unknown outcome requires reopening and inspecting
saved work, not blindly repeating a write.

The database is **not encrypted**. On systems with POSIX permissions, the folder
and files must be private to the current user; the application does not silently
change existing permissions. Use operating-system access controls and disk
encryption. Clearing browser site data does not delete this folder. Browser
preferences and temporary page state are not filesystem-backed.

Use the console’s encrypted workspace backup and evidence-file package controls
for portable recovery. Backups exclude unfinished forms and recovery drafts.
To rehearse recovery, start with another new folder and `--init --offline`, import
the backup, restore its original files or evidence package, and compare the
restored records and file-verification results. Keep the source folder unchanged.
An archive import adds selected data using the existing merge rules; it is not a
destructive database replacement.

Stop the application with Ctrl+C before moving, deleting or copying the folder.
Copy the whole folder only after **all** instances using it have stopped. A
filesystem copy is not an encrypted export. Unsupported database versions are
rejected without rewriting them; use a compatible application or a supported
portable backup instead.

## Development

From a checked-out repository with dependencies installed:

```sh
npm run build
npm run local:app -- --workspace ../investigation --init --offline
npm run local:package:check -- --candidate /tmp/local-application-candidate
```

Package verification uses the existing source-closure compiler and verified
production-build identity. It installs and exercises the exact archive in an
isolated directory. It does not publish the package.
