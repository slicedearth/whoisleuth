# WHOISleuth local application

The optional local application serves the existing console on your computer and
keeps saved records, review drafts and retained files in one selected folder.
It is separate from the command-line evidence tool and rendered-capture companion.
See the [installation-mode comparison](https://www.whoisleuth.com/cli#choose-mode)
to choose between the browser, filesystem-local and terminal workflows.

## Run

This package is currently distributed as a locally assembled archive, not a
published npm release. Obtain its `local-application-package-report.json` from
the reviewed candidate and check `packageName`, `packageVersion`,
`applicationVersion` and `archiveSha256`. The package version is separate from
the application version inside it. The report names the archive in `archiveFile`;
renaming it does not change its byte identity.

Before installation, compare the archive's complete SHA-256 with
`archiveSha256` in that report. For example, with the selected archive named
`reviewed-local-archive.tgz`:

```sh
# macOS
shasum -a 256 ./reviewed-local-archive.tgz
# Linux
sha256sum ./reviewed-local-archive.tgz
```

In PowerShell, use `Get-FileHash -Algorithm SHA256 .\reviewed-local-archive.tgz`.
Do not install if the values differ. A matching digest establishes byte
correspondence with the report, not publisher identity or evidence accuracy;
obtain both from the review you intended to trust.

Install that reviewed archive with scripts disabled:

```sh
npm install --offline --ignore-scripts --omit=optional ./reviewed-local-archive.tgz
npx --no-install whoisleuth-local --workspace ./investigation --init --offline
```

Use Node.js 24.19 or newer. Open the private launch link printed in the terminal.
The server accepts only `127.0.0.1` requests with its own session and origin. The
link is a credential for that running instance; do not share it. There is no
hosting password, external account, telemetry or automatic browser installation.
The archive bundles its reviewed runtime dependencies. Installation can stay
offline and does not select newer transitive versions.
Loopback cookies are host-scoped, not port-isolated. Other servers visited on
`127.0.0.1` in the same browser profile can receive them. Use a dedicated browser
profile when running other local servers; per-port cookie names only prevent
name collisions.

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

## Upgrade an existing installation

1. Stop **all** instances using the workspace before copying it. Make a private
   whole-folder recovery copy, including retained originals, and keep it
   unchanged. That copy is plaintext, not an encrypted portable backup.
2. Verify the new candidate archive against its own report. Install it in a
   separate application directory; do not overwrite the only working
   installation or replace its dependency files piecemeal.
3. Make a **separate rehearsal copy** from the untouched recovery copy. Start
   the new installation against that rehearsal folder, with
   `--workspace ./upgrade-rehearsal --offline` and **without** `--init`.
   `npx --no-install whoisleuth-local --version` reports the package version; the Console footer
   reports the application version. Compare both with the candidate report,
   then check saved records, recovery drafts and original-file integrity.
   Browser-only preferences do not move with SQLite.
4. Stop the rehearsal instance before reopening the original workspace from
   the new installation, again without `--init`. Retain the earlier application
   and untouched recovery copy until verification is complete.

Select the same workspace folder when launching from another installation
directory. Relative paths resolve from the directory where you run the command;
use an explicit absolute path when that directory changes.

If the new or earlier application refuses a workspace version, leave the
database unchanged. Do not edit its schema marker to force it open. Use a
compatible application or rehearse restoration from a supported portable
backup into a separate new workspace. A successful launch alone is not a
complete recovery or downgrade check.

## Temporary folder references

In Dashboard's **Workspace details**, the optional **Temporary restart shortlist**
can hold the folder shown by the current launch or labelled references you supply.
It is a page-local selection aid, not a verified launch history or folder picker.
Paths are revealed deliberately and never inserted into executable commands.
Version and lock state of other folders are not checked. Remove and clear affect
references only; closing the panel, leaving or reloading clears the shortlist.
Stop the process and choose the other folder explicitly using the existing
reopen instructions. The application does not switch or scan folders.

## Development

From a checked-out repository with dependencies installed:

```sh
npm run build
npm run local:app -- --workspace ../investigation --init --offline
npm run local:package:check -- --candidate /tmp/local-application-candidate
```

Package verification uses the existing source-closure compiler and verified
production-build identity. Assembly downloads lockfile-pinned dependencies into
a fresh isolated cache; it does not select updates. The archive then bundles
those dependencies and is installed and exercised offline with scripts disabled
in an isolated directory. Verification does not publish the package.
