// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_CLI_GUIDANCE = {
  "operationModes": [
    {
      "id": "hosted-console",
      "title": "Hosted Console",
      "availability": "Website",
      "task": "Investigate in the browser and keep Cases, Brands and Watchlists together.",
      "prerequisites": "A supported browser and access to the Console. Nothing to install locally.",
      "requests": "Collection goes through the website service and runs from its host. Optional sources depend on that deployment; each action discloses what it sends.",
      "storage": "Saved work stays in the current browser profile. Unencrypted workspaces are plaintext; encrypted named workspaces are optional. Separately configured scheduled monitoring has its own limited hosted storage.",
      "offline": "Selected-file analysis and retained-evidence review run locally after the page loads. The hosted website is not an offline installation.",
      "href": "/resources",
      "linkLabel": "Console task guide",
      "nodeRequirement": null
    },
    {
      "id": "local-console",
      "title": "Local application",
      "availability": "Local archive only",
      "task": "Use the Console with a filesystem workspace on your own computer.",
      "prerequisites": "A verified, locally assembled archive. Open its private launch link; no hosted login is used.",
      "requests": "Explicit collection runs from your computer. Start with --offline to disable collection; starting the application does not investigate a target.",
      "storage": "Records, drafts and originals live in the selected SQLite folder in plaintext. Encrypted portable backups are separate. Appearance preferences remain browser-local.",
      "offline": "The installed application serves its own pages over loopback. With --offline, review saved work and selected files without collection. Loopback cookies are host-scoped, not isolated by port; use a dedicated browser profile alongside other local servers.",
      "href": "#local-application",
      "linkLabel": "Local application setup",
      "nodeRequirement": ">=24.19.0"
    },
    {
      "id": "main-cli",
      "title": "Command-line tool",
      "availability": "Public npm package",
      "task": "Collect, inspect and verify evidence from a terminal or an explicit workflow.",
      "prerequisites": "Install the public package or run its help once; check the installed version and command help.",
      "requests": "Networked commands run from your computer, not the hosted service. Plans and commands labelled offline do not collect evidence; doctor is offline unless --network is selected.",
      "storage": "Commands use deliberately selected local inputs and output files, not the browser workspace. Ordinary files are plaintext; encrypted-package commands are separate.",
      "offline": "After installation, offline commands need only their declared local inputs. Package installation or updating can require a registry download.",
      "href": "#start",
      "linkLabel": "CLI installation commands",
      "nodeRequirement": ">=24"
    },
    {
      "id": "rendered-capture",
      "title": "Capture companion",
      "availability": "Separate local archive only",
      "task": "Render one explicitly authorised page or compare two existing captures offline.",
      "prerequisites": "Its own verified local archive. Rendering also needs the separately installed matching browser and supported sandbox; help and comparison do not.",
      "requests": "An authorised capture executes page JavaScript and contacts admitted resource operators from your computer. The browser and pinned collector enforce the companion’s request boundaries. It is not part of the main CLI or hosted Console.",
      "storage": "Screenshots and minimised manifests are local output files, unencrypted. Screenshots can contain sensitive visible content; review them before sharing.",
      "offline": "Comparison of supplied captures makes no request. Capturing a page and explicitly downloading the browser require network access.",
      "href": "#capture-companion",
      "linkLabel": "Capture companion setup",
      "nodeRequirement": ">=24"
    }
  ],
  "runOnce": [
    "npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help",
    "npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth example.test --plan --json"
  ],
  "install": [
    "npm install --global --ignore-scripts @slicedearth/whoisleuth-cli",
    "whoisleuth doctor"
  ],
  "update": [
    "npm install --global --ignore-scripts @slicedearth/whoisleuth-cli@latest",
    "whoisleuth --version",
    "whoisleuth doctor"
  ],
  "verification": [
    "Confirm Node.js 24 or later and compare whoisleuth --version with the reviewed release you intended to install.",
    "Review the scoped package identity, source location, licence, notices and registry-provided integrity or provenance metadata before relying on an installation.",
    "A matching package digest detects changed bytes; it does not establish who operated the terminal or whether observed evidence is true or current.",
    "Release-specific final evidence is published only with the reviewed release; this page does not claim a future release has completed that assurance."
  ],
  "localArchive": {
    "install": "npm install --offline --ignore-scripts --omit=optional ./reviewed-local-archive.tgz",
    "initialize": "npx --no-install whoisleuth-local --workspace ./review-workspace --init --offline",
    "reopen": "npx --no-install whoisleuth-local --workspace ./review-workspace --offline",
    "verification": [
      "Use the selected candidate report to check packageName, packageVersion, applicationVersion and archiveSha256. The local package and enclosed application have separate versions.",
      "Compare the complete archive SHA-256 with archiveSha256 before installing. A matching digest establishes corresponding bytes, not publisher identity or evidence accuracy.",
      "Archive assembly downloads existing pinned dependencies. Installation from the bundled reviewed archive stays offline with scripts disabled; this channel is not a public npm release."
    ],
    "upgrade": [
      "Stop every instance using the workspace, then keep an unchanged private whole-folder recovery copy. SQLite and that copy are plaintext.",
      "Verify the new archive against its own report and install it separately. Reopen a separate rehearsal copy offline without --init; keep the recovery copy untouched.",
      "Check saved records, recovery drafts and original-file integrity, not just startup. Keep the earlier installation and untouched copy until verification is complete.",
      "An unsupported workspace version must remain unchanged. Use a compatible application or supported portable backup; never edit a schema marker to force opening."
    ]
  },
  "commonWorkflows": [
    {
      "label": "Plan before collection",
      "command": "whoisleuth lookup example.test --deep --plan --json"
    },
    {
      "label": "Review supplied evidence offline",
      "command": "whoisleuth review-evidence evidence.json --json"
    },
    {
      "label": "Compare retained observations",
      "command": "whoisleuth diff earlier.json later.json --json"
    },
    {
      "label": "Discover fixed workflow recipes",
      "command": "whoisleuth workflow-plan --list --json"
    },
    {
      "label": "Create an offline Case file",
      "command": "whoisleuth case open --domain example.test --output cases.json"
    },
    {
      "label": "Explain one recipe",
      "command": "whoisleuth workflow-plan --explain evidence-handoff"
    },
    {
      "label": "Prepare a reviewed public handoff",
      "command": "whoisleuth case-pack cases.json --audience public --reviewed --json"
    }
  ],
  "exitCodes": [
    {
      "code": 0,
      "meaning": "Command completed; individual evidence sources may still be partial or inconclusive."
    },
    {
      "code": 2,
      "meaning": "Command, option, input, or standard-input shape was invalid."
    },
    {
      "code": 3,
      "meaning": "The requested collection, lookup, or comparison could not run."
    },
    {
      "code": 4,
      "meaning": "A bounded operation completed partially or met an explicit failure policy."
    },
    {
      "code": 70,
      "meaning": "Unexpected CLI bootstrap failure."
    },
    {
      "code": 130,
      "meaning": "The analyst cancelled; no partial final result was emitted."
    },
    {
      "code": 143,
      "meaning": "The process received SIGTERM; no partial final result was emitted."
    }
  ],
  "configuration": [
    "Version-1 local profiles can set only safe presentation, Fast-mode, bounded concurrency, observer and vantage defaults.",
    "Profiles cannot add a target, enable Deep collection, choose an output path, approve network work, or set a failure policy.",
    "Explicit command options override defaults from the same option group."
  ],
  "handoffs": [
    "Browser exports and CLI artefacts remain separate versioned documents; compatibility and privacy projections are checked before import or packaging.",
    "A browser handoff prepares or imports reviewed local material. It does not upload, submit, publish, enforce, or start monitoring."
  ],
  "interchangeRecipes": [
    {
      "id": "workspace-verification",
      "label": "Check a browser workspace before restoring it",
      "commands": [
        "whoisleuth verify-artifact workspace.json --json",
        "whoisleuth interchange-report workspace.json --json"
      ],
      "result": "Review structure, section integrity, supported versions and the proposed browser import before applying any records."
    },
    {
      "id": "lookup-replay",
      "label": "Continue a CLI Lookup in the browser",
      "commands": [
        "whoisleuth lookup example.test --deep --browse --save-lookup lookup.json",
        "whoisleuth verify-artifact lookup.json --json",
        "whoisleuth export lookup.json --output evidence.json",
        "whoisleuth verify-artifact evidence.json --json"
      ],
      "result": "Keep lookup.json as the private CLI original. Replay evidence.json from Console Lookup, inspect its source states and then choose whether to retain it in a Case."
    },
    {
      "id": "case-handoff",
      "label": "Prepare a reviewed Case handoff",
      "commands": [
        "whoisleuth case-pack cases.json --audience public --reviewed --json --output case-pack.json",
        "whoisleuth sharing-review case-pack.json --marking clear --recipient-scope public --purpose \"Reviewed evidence handoff\" --human-reviewed --personal-data-reviewed --redactions-confirmed --json"
      ],
      "result": "Verify the output digest and review the audience projection before deliberately sharing the separate file."
    }
  ],
  "boundaries": [
    "Offline commands may read only deliberately selected bounded files or standard input and make no request.",
    "Network commands run from the local machine and disclose the selected target only to the source classes declared by that command.",
    "Authorised active commands require their dedicated acknowledgement and never enter Lookup, Bulk, monitoring, or an automatic recipe.",
    "Redirected and machine-readable output contains no ANSI; file output is bounded, private, atomic and refuses replacement without --force."
  ]
} as const;
