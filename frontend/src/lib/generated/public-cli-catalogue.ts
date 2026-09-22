// Generated from canonical runtime-neutral metadata. Do not edit by hand.
const SHARED_COMMAND_OPTIONS = [
  {
    "option": "--help",
    "scope": "common",
    "usage": "--help",
    "description": "Show command usage, options and an example without executing it.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--output",
    "scope": "common",
    "usage": "--output \u003cfile>",
    "description": "Write output atomically to this local file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--force",
    "scope": "common",
    "usage": "--force",
    "description": "Allow replacement of the selected output file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--config",
    "scope": "common",
    "usage": "--config \u003cfile>",
    "description": "Load explicit versioned CLI configuration from this file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--profile",
    "scope": "common",
    "usage": "--profile \u003cvalue>",
    "description": "Select a named profile from the supplied configuration.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--palette",
    "scope": "common",
    "usage": "--palette \u003cauto|light|dark>",
    "description": "Choose the terminal colour palette; redirected output and no-colour settings still take precedence.",
    "values": [
      "auto",
      "light",
      "dark"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--network",
    "scope": "command",
    "usage": "--network",
    "description": "Include the optional public DNS and port 43 runtime checks.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--json",
    "scope": "command",
    "usage": "--json",
    "description": "Write structured JSON to stdout or the selected output file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--quiet",
    "scope": "command",
    "usage": "--quiet",
    "description": "Suppress ordinary terminal presentation.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--no-color",
    "scope": "command",
    "usage": "--no-color",
    "description": "Suppress ANSI colour in terminal output.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--common",
    "scope": "command",
    "usage": "--common",
    "description": "Show only commands marked as common.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--group",
    "scope": "command",
    "usage": "--group \u003cinvestigate|respond|assure|utilities>",
    "description": "Filter commands by task group.",
    "values": [
      "investigate",
      "respond",
      "assure",
      "utilities"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--mode",
    "scope": "command",
    "usage": "--mode \u003coffline|network>",
    "description": "Filter commands by offline or network collection mode.",
    "values": [
      "offline",
      "network"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--workflow",
    "scope": "command",
    "usage": "--workflow \u003cvalue>",
    "description": "Label the workflow recorded in the evidence manifest.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--configuration-digest",
    "scope": "command",
    "usage": "--configuration-digest \u003cvalue>",
    "description": "Record a supplied configuration digest in the manifest provenance.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--package",
    "scope": "command",
    "usage": "--package",
    "description": "Create a portable evidence ZIP containing the selected files.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--bagit",
    "scope": "command",
    "usage": "--bagit",
    "description": "Create a BagIt 1.0 package with SHA-512 checksums.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--passphrase-file",
    "scope": "command",
    "usage": "--passphrase-file \u003cfile>",
    "description": "Read the archive passphrase from a local file, not a command-line value.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--folder",
    "scope": "command",
    "usage": "--folder \u003cfile>",
    "description": "Create a new evidence folder containing the selected files.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--junit",
    "scope": "command",
    "usage": "--junit",
    "description": "Write JUnit XML for automated result reporting.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--markdown",
    "scope": "command",
    "usage": "--markdown",
    "description": "Write a Markdown report.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--html",
    "scope": "command",
    "usage": "--html",
    "description": "Write an HTML report.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--no-attribution",
    "scope": "command",
    "usage": "--no-attribution",
    "description": "Omit the optional product attribution from presentation output.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--fast",
    "scope": "command",
    "usage": "--fast",
    "description": "Select registration-first Fast collection.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--deep",
    "scope": "command",
    "usage": "--deep",
    "description": "Select broader Deep collection and its additional source requests.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--exact-url",
    "scope": "command",
    "usage": "--exact-url",
    "description": "With Deep Lookup, send the selected URL path and query to the website; omit its fragment.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--observer",
    "scope": "command",
    "usage": "--observer \u003cvalue>",
    "description": "Attach the supplied observer label to the retained observation.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--vantage",
    "scope": "command",
    "usage": "--vantage \u003cvalue>",
    "description": "Attach the supplied collection-vantage label.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--plan",
    "scope": "command",
    "usage": "--plan",
    "description": "Describe intended collection and limits without making requests.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--summary",
    "scope": "command",
    "usage": "--summary",
    "description": "Show a concise terminal result.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--verbose",
    "scope": "command",
    "usage": "--verbose",
    "description": "Show the detailed terminal result.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--browse",
    "scope": "command",
    "usage": "--browse",
    "description": "Open the interactive terminal evidence browser.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--save-lookup",
    "scope": "command",
    "usage": "--save-lookup \u003cfile>",
    "description": "After a normal evidence-browser close, save the completed private Lookup JSON to a new file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--strict-exit",
    "scope": "command",
    "usage": "--strict-exit",
    "description": "Use the command’s strict outcome policy when deciding the exit status.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--fail-on",
    "scope": "command",
    "usage": "--fail-on \u003cpolicy[,policy...]>",
    "description": "Return a failure-policy exit status for the selected comma-separated outcomes.",
    "values": [
      "source-failure",
      "inconclusive",
      "danger"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--events",
    "scope": "command",
    "usage": "--events",
    "description": "Emit collection progress events on stderr.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--jsonl",
    "scope": "command",
    "usage": "--jsonl",
    "description": "Write one JSON record per line.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--csv",
    "scope": "command",
    "usage": "--csv",
    "description": "Write compact CSV rows.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--csv-with-metadata",
    "scope": "command",
    "usage": "--csv-with-metadata",
    "description": "Write CSV with source, observation-time and collection-state metadata.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--domains",
    "scope": "command",
    "usage": "--domains",
    "description": "Write the selected domain names only.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--queries",
    "scope": "command",
    "usage": "--queries",
    "description": "Write the selected original queries only.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--registered-only",
    "scope": "command",
    "usage": "--registered-only",
    "description": "Keep registered results in the presented output.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--inconclusive-only",
    "scope": "command",
    "usage": "--inconclusive-only",
    "description": "Keep inconclusive results in the presented output.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--errors-only",
    "scope": "command",
    "usage": "--errors-only",
    "description": "Keep error results in the presented output.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--concurrency",
    "scope": "command",
    "usage": "--concurrency \u003cinteger>",
    "description": "Set the maximum number of concurrent collection tasks.",
    "values": [],
    "repeatable": false,
    "ranges": [
      {
        "minimum": 1,
        "maximum": 8,
        "whenOptionPresent": null
      },
      {
        "minimum": 1,
        "maximum": 3,
        "whenOptionPresent": "--deep"
      }
    ],
    "defaultDescription": "4 in Fast mode; 2 in Deep mode"
  },
  {
    "option": "--checkpoint",
    "scope": "command",
    "usage": "--checkpoint \u003cfile>",
    "description": "Save resumable collection state to this local file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--resume",
    "scope": "command",
    "usage": "--resume",
    "description": "Resume collection from the selected checkpoint.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--tlds",
    "scope": "command",
    "usage": "--tlds \u003cvalue>",
    "description": "Use this comma-separated set of domain endings.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--preset",
    "scope": "command",
    "usage": "--preset \u003ccommon|impersonation|all>",
    "description": "Choose candidate-generation families; explicit families select a custom set instead.",
    "values": [
      "common",
      "impersonation",
      "all"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": "all"
  },
  {
    "option": "--families",
    "scope": "command",
    "usage": "--families \u003cvalue>",
    "description": "Select the candidate-generation families explicitly.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--keyboard",
    "scope": "command",
    "usage": "--keyboard \u003cqwerty|azerty|qwertz|all>",
    "description": "Choose keyboard layouts for adjacent-key candidates.",
    "values": [
      "qwerty",
      "azerty",
      "qwertz",
      "all"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": "qwerty"
  },
  {
    "option": "--dictionary",
    "scope": "command",
    "usage": "--dictionary \u003cfile>",
    "description": "Read candidate words from this local dictionary.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--snapshot",
    "scope": "command",
    "usage": "--snapshot \u003cfile>",
    "description": "Use this retained observation snapshot.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--scan-limit",
    "scope": "command",
    "usage": "--scan-limit \u003cinteger>",
    "description": "Limit the number of generated candidates to collect.",
    "values": [],
    "repeatable": false,
    "ranges": [
      {
        "minimum": 1,
        "maximum": 500,
        "whenOptionPresent": null
      },
      {
        "minimum": 1,
        "maximum": 50,
        "whenOptionPresent": "--deep"
      }
    ],
    "defaultDescription": "100 in Fast mode; 50 in Deep mode"
  },
  {
    "option": "--chunk-size",
    "scope": "command",
    "usage": "--chunk-size \u003cinteger>",
    "description": "Set the number of candidates processed per checkpoint chunk.",
    "values": [],
    "repeatable": false,
    "ranges": [
      {
        "minimum": 1,
        "maximum": 100,
        "whenOptionPresent": null
      }
    ],
    "defaultDescription": "25"
  },
  {
    "option": "--resolver",
    "scope": "command",
    "usage": "--resolver \u003cvalue>",
    "description": "Choose the supported DNS resolver for collection.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--allowlist",
    "scope": "command",
    "usage": "--allowlist \u003cfile>",
    "description": "Read reviewed domains whose priority should be suppressed, without changing their evidence.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--observation-snapshot",
    "scope": "command",
    "usage": "--observation-snapshot \u003cfile>",
    "description": "Compare with this retained observation snapshot.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--acquisition-only",
    "scope": "command",
    "usage": "--acquisition-only",
    "description": "Present only acquisition candidates.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--suppressed-only",
    "scope": "command",
    "usage": "--suppressed-only",
    "description": "Present only candidates suppressed by the allowlist.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--selectors",
    "scope": "command",
    "usage": "--selectors \u003cvalue>",
    "description": "Supply explicit DKIM selectors; no selector enumeration is performed.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--retired-selectors",
    "scope": "command",
    "usage": "--retired-selectors \u003cvalue>",
    "description": "Supply previously retired DKIM selectors for review.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--mail-profile",
    "scope": "command",
    "usage": "--mail-profile \u003cstandard|defensive-no-mail|parked>",
    "description": "Choose the expected mail posture for the review.",
    "values": [
      "standard",
      "defensive-no-mail",
      "parked"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": "standard"
  },
  {
    "option": "--include-inherited-dns",
    "scope": "command",
    "usage": "--include-inherited-dns",
    "description": "Explicitly collect inherited DMARC and parent-delegation evidence.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--sarif",
    "scope": "command",
    "usage": "--sarif",
    "description": "Write the posture review as SARIF.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--owned-domain",
    "scope": "command",
    "usage": "--owned-domain",
    "description": "Declare that the reviewed domain is owned by the analyst.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--trust-anchor",
    "scope": "command",
    "usage": "--trust-anchor \u003cfile>",
    "description": "Read the analyst-selected DNSSEC trust anchor.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--owned-or-authorized",
    "scope": "command",
    "usage": "--owned-or-authorized",
    "description": "Acknowledge ownership or permission for this active collection.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--active-probe",
    "scope": "command",
    "usage": "--active-probe",
    "description": "Explicitly enable the bounded active protocol exchange.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--profile",
    "scope": "command",
    "usage": "--profile \u003cvalue>",
    "description": "Select the registry fixture capability profile.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--suffix",
    "scope": "command",
    "usage": "--suffix \u003cvalue>",
    "description": "Select the registry suffix.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--scenario",
    "scope": "command",
    "usage": "--scenario \u003cregistered|not_found|inconclusive>",
    "description": "Choose the expected registry fixture outcome.",
    "values": [
      "registered",
      "not_found",
      "inconclusive"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--summary-json",
    "scope": "command",
    "usage": "--summary-json",
    "description": "Write the concise structured summary.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--manifest",
    "scope": "command",
    "usage": "--manifest \u003cfile>",
    "description": "Use the selected investigation manifest.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--manifest-entry",
    "scope": "command",
    "usage": "--manifest-entry \u003cmanifest-entry>",
    "description": "Select an artefact entry from the supplied manifest.",
    "values": [
      "artifact-1",
      "artifact-2",
      "artifact-3",
      "artifact-4",
      "artifact-5",
      "artifact-6",
      "artifact-7",
      "artifact-8",
      "artifact-9",
      "artifact-10",
      "artifact-11",
      "artifact-12",
      "artifact-13",
      "artifact-14",
      "artifact-15",
      "artifact-16",
      "artifact-17",
      "artifact-18",
      "artifact-19",
      "artifact-20",
      "artifact-21",
      "artifact-22",
      "artifact-23",
      "artifact-24",
      "artifact-25",
      "artifact-26",
      "artifact-27",
      "artifact-28",
      "artifact-29",
      "artifact-30",
      "artifact-31",
      "artifact-32",
      "artifact-33",
      "artifact-34",
      "artifact-35",
      "artifact-36",
      "artifact-37",
      "artifact-38",
      "artifact-39",
      "artifact-40",
      "artifact-41",
      "artifact-42",
      "artifact-43",
      "artifact-44",
      "artifact-45",
      "artifact-46",
      "artifact-47",
      "artifact-48",
      "artifact-49",
      "artifact-50",
      "artifact-51",
      "artifact-52",
      "artifact-53",
      "artifact-54",
      "artifact-55",
      "artifact-56",
      "artifact-57",
      "artifact-58",
      "artifact-59",
      "artifact-60",
      "artifact-61",
      "artifact-62",
      "artifact-63",
      "artifact-64",
      "artifact-65",
      "artifact-66",
      "artifact-67",
      "artifact-68",
      "artifact-69",
      "artifact-70",
      "artifact-71",
      "artifact-72",
      "artifact-73",
      "artifact-74",
      "artifact-75",
      "artifact-76",
      "artifact-77",
      "artifact-78",
      "artifact-79",
      "artifact-80",
      "artifact-81",
      "artifact-82",
      "artifact-83",
      "artifact-84",
      "artifact-85",
      "artifact-86",
      "artifact-87",
      "artifact-88",
      "artifact-89",
      "artifact-90",
      "artifact-91",
      "artifact-92",
      "artifact-93",
      "artifact-94",
      "artifact-95",
      "artifact-96",
      "artifact-97",
      "artifact-98",
      "artifact-99",
      "artifact-100",
      "artifact-101",
      "artifact-102",
      "artifact-103",
      "artifact-104",
      "artifact-105",
      "artifact-106",
      "artifact-107",
      "artifact-108",
      "artifact-109",
      "artifact-110",
      "artifact-111",
      "artifact-112",
      "artifact-113",
      "artifact-114",
      "artifact-115",
      "artifact-116",
      "artifact-117",
      "artifact-118",
      "artifact-119",
      "artifact-120",
      "artifact-121",
      "artifact-122",
      "artifact-123",
      "artifact-124",
      "artifact-125",
      "artifact-126",
      "artifact-127",
      "artifact-128",
      "artifact-129"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--package",
    "scope": "command",
    "usage": "--package",
    "description": "Verify a portable evidence ZIP or encrypted package rather than a single report.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--bagit",
    "scope": "command",
    "usage": "--bagit",
    "description": "Verify the selected package as BagIt 1.0.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--folder",
    "scope": "command",
    "usage": "--folder \u003cfile>",
    "description": "Verify the evidence package within this selected folder.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--search",
    "scope": "command",
    "usage": "--search \u003cvalue>",
    "description": "Search the selected local archive.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--require-match",
    "scope": "command",
    "usage": "--require-match",
    "description": "Require the local archive search to find a match.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--reveal",
    "scope": "command",
    "usage": "--reveal",
    "description": "Include retained values otherwise redacted by archive inspection.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--expect-content-digest",
    "scope": "command",
    "usage": "--expect-content-digest \u003cvalue>",
    "description": "Compare archive content with the supplied version-qualified or historical digest.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--private-key-file",
    "scope": "command",
    "usage": "--private-key-file \u003cfile>",
    "description": "Read the private signing key from this local file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--public-key-file",
    "scope": "command",
    "usage": "--public-key-file \u003cfile>",
    "description": "Read the public verification key from this local file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--trust-store-file",
    "scope": "command",
    "usage": "--trust-store-file \u003cfile>",
    "description": "Read the analyst-selected signer trust store.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--reported-action",
    "scope": "command",
    "usage": "--reported-action \u003creported-action>",
    "description": "Record an analyst-reported identity action; repeat for separate actions.",
    "values": [
      "opened_link",
      "entered_password",
      "approved_signin",
      "granted_consent",
      "entered_device_code",
      "executed_command"
    ],
    "repeatable": true,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--mmdb",
    "scope": "command",
    "usage": "--mmdb \u003cfile>",
    "description": "Use the selected local IP-location database.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--case-id",
    "scope": "command",
    "usage": "--case-id \u003cvalue>",
    "description": "Select the retained Case identifier.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--domain",
    "scope": "command",
    "usage": "--domain \u003cvalue>",
    "description": "Supply the Case domain.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--title",
    "scope": "command",
    "usage": "--title \u003cvalue>",
    "description": "Supply the Case title.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--new-incident",
    "scope": "command",
    "usage": "--new-incident",
    "description": "Create a separate incident instead of updating a matching Case.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--text",
    "scope": "command",
    "usage": "--text \u003cvalue>",
    "description": "Supply the note text directly.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--note-file",
    "scope": "command",
    "usage": "--note-file \u003cfile>",
    "description": "Read note text from a selected local file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--input",
    "scope": "command",
    "usage": "--input \u003cfile>",
    "description": "Read the selected local input file.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--expect-file-digest",
    "scope": "command",
    "usage": "--expect-file-digest \u003cvalue>",
    "description": "Require the input file to match this SHA-256 digest.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--audience",
    "scope": "command",
    "usage": "--audience \u003cinternal|trusted|public>",
    "description": "Choose the export audience and its field-disclosure policy.",
    "values": [
      "internal",
      "trusted",
      "public"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--reviewed",
    "scope": "command",
    "usage": "--reviewed",
    "description": "Confirm the required human review of the exported material.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--previous",
    "scope": "command",
    "usage": "--previous \u003cfile>",
    "description": "Compare against this earlier retained report.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--limit",
    "scope": "command",
    "usage": "--limit \u003cinteger>",
    "description": "Limit the number of watchlist targets checked in this run.",
    "values": [],
    "repeatable": false,
    "ranges": [
      {
        "minimum": 1,
        "maximum": 20,
        "whenOptionPresent": null
      }
    ],
    "defaultDescription": "20"
  },
  {
    "option": "--concurrency",
    "scope": "command",
    "usage": "--concurrency \u003cinteger>",
    "description": "Set the maximum number of concurrent collection tasks.",
    "values": [],
    "repeatable": false,
    "ranges": [
      {
        "minimum": 1,
        "maximum": 3,
        "whenOptionPresent": null
      }
    ],
    "defaultDescription": "2"
  },
  {
    "option": "--fail-on",
    "scope": "command",
    "usage": "--fail-on \u003cpolicy[,policy...]>",
    "description": "Return a failure-policy exit status for the selected comma-separated outcomes.",
    "values": [
      "source-failure",
      "inconclusive",
      "material-drift"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--marking",
    "scope": "command",
    "usage": "--marking \u003cclear|green|amber|amber-strict|red>",
    "description": "Declare the information-sharing marking.",
    "values": [
      "clear",
      "green",
      "amber",
      "amber-strict",
      "red"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--recipient-scope",
    "scope": "command",
    "usage": "--recipient-scope \u003cpublic|community|organization|named-recipients>",
    "description": "Declare the intended recipient scope.",
    "values": [
      "public",
      "community",
      "organization",
      "named-recipients"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--purpose",
    "scope": "command",
    "usage": "--purpose \u003cvalue>",
    "description": "Record the purpose of the intended sharing.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--human-reviewed",
    "scope": "command",
    "usage": "--human-reviewed",
    "description": "Confirm that a person reviewed the material.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--personal-data-reviewed",
    "scope": "command",
    "usage": "--personal-data-reviewed",
    "description": "Confirm that personal-data disclosure was reviewed.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--redactions-confirmed",
    "scope": "command",
    "usage": "--redactions-confirmed",
    "description": "Confirm that the intended redactions were checked.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--list",
    "scope": "command",
    "usage": "--list",
    "description": "List available workflow recipes.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--explain",
    "scope": "command",
    "usage": "--explain \u003cexplain>",
    "description": "Explain a selected workflow without executing it.",
    "values": [
      "domain-triage",
      "lookalike-review",
      "owned-domain-review",
      "historical-comparison",
      "campaign-review",
      "certificate-anomaly",
      "registry-disagreement",
      "evidence-handoff",
      "planned-domain-change",
      "post-change-verification"
    ],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--select",
    "scope": "command",
    "usage": "--select \u003cvalue>",
    "description": "Bind a literal input to a workflow step; repeat for further inputs.",
    "values": [],
    "repeatable": true,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--use-artifact",
    "scope": "command",
    "usage": "--use-artifact \u003cvalue>",
    "description": "Connect a step input to an earlier compatible output.",
    "values": [],
    "repeatable": true,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--confirm-review",
    "scope": "command",
    "usage": "--confirm-review \u003cvalue>",
    "description": "Confirm human review for the named step in this invocation.",
    "values": [],
    "repeatable": true,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--approve-network",
    "scope": "command",
    "usage": "--approve-network",
    "description": "Approve the workflow’s declared network steps for this invocation.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--resume",
    "scope": "command",
    "usage": "--resume \u003cfile>",
    "description": "Resume the selected workflow checkpoint; approvals must be supplied again.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--interactive",
    "scope": "command",
    "usage": "--interactive",
    "description": "Prompt for missing supported inputs on an interactive terminal.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--left-session",
    "scope": "command",
    "usage": "--left-session \u003cvalue>",
    "description": "Select the left-hand retained capture session.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--right-session",
    "scope": "command",
    "usage": "--right-session \u003cvalue>",
    "description": "Select the right-hand retained capture session.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  },
  {
    "option": "--compact",
    "scope": "command",
    "usage": "--compact",
    "description": "Write a compact report presentation.",
    "values": [],
    "repeatable": false,
    "ranges": [],
    "defaultDescription": null
  }
] as const;
export const PUBLIC_CLI_CATALOGUE = {
  "commandCount": 50,
  "groups": [
    "investigate",
    "respond",
    "assure",
    "utilities"
  ],
  "modes": [
    "offline",
    "network"
  ],
  "commands": [
    {
      "id": "completion",
      "summary": "Print shell completion",
      "description": "Print a static shell-completion script for the installed CLI.",
      "group": "utilities",
      "common": false,
      "usage": "whoisleuth completion \u003cbash|zsh|fish|powershell>",
      "example": "whoisleuth completion zsh > ~/.zfunc/_whoisleuth",
      "boundary": "Generation is offline and writes only the script to stdout. The command never modifies shell configuration.",
      "collection": {
        "mode": "offline",
        "scope": "Prints one static script and changes no shell configuration."
      },
      "inputs": [
        {
          "name": "shell",
          "valueKind": "enum",
          "minimum": 1,
          "maximum": 1,
          "values": [
            "bash",
            "zsh",
            "fish",
            "powershell"
          ],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [],
      "inputLimits": [
        "Prints one static script and changes no shell configuration.",
        "shell: 1-1 enum value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "metadata_only",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command emits fixed installed metadata and makes no network request or local evidence read."
        ]
      }
    },
    {
      "id": "doctor",
      "summary": "Check the local CLI runtime",
      "description": "Check the supported runtime and local terminal capabilities.",
      "group": "utilities",
      "common": true,
      "usage": "whoisleuth doctor [--network] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth doctor --json",
      "boundary": "The default check is offline. Public DNS and port 43 checks run only when --network is explicitly supplied.",
      "collection": {
        "mode": "network",
        "scope": "Network access is opt-in with --network and is limited to fixed public DNS, HTTPS, and WHOIS diagnostics."
      },
      "inputs": [],
      "importantOptions": [
        "--network",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[6], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "conditional_network",
      "disclosureClass": "conditional_bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.doctor"
      ],
      "inputLimits": [
        "Network access is opt-in with --network and is limited to fixed public DNS, HTTPS, and WHOIS diagnostics."
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "runtime_diagnostics",
        "networkMode": "conditional_bounded_passive",
        "dataSent": [
          "fixed_diagnostic_probe"
        ],
        "recipients": [
          "dns_resolver",
          "target_public_service",
          "registry_service"
        ],
        "authorisation": "explicit_network_approval",
        "retention": "local_output_deliberate",
        "export": "metadata_only",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "Network diagnostics are opt-in and use only fixed public diagnostic destinations."
        ]
      }
    },
    {
      "id": "commands",
      "summary": "List installed command contracts",
      "description": "List the installed command contracts in terminal or versioned JSON form.",
      "group": "utilities",
      "common": true,
      "usage": "whoisleuth commands [--common] [--group \u003cinvestigate|respond|assure|utilities>] [--mode \u003coffline|network>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth commands --json",
      "boundary": "Catalogue generation is offline. It reports declared command modes and limits without executing collection or inspecting local evidence.",
      "collection": {
        "mode": "offline",
        "scope": "Reads the embedded command catalogue and performs no collection."
      },
      "inputs": [],
      "importantOptions": [
        "--common",
        "--group",
        "--mode",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[10], SHARED_COMMAND_OPTIONS[11], SHARED_COMMAND_OPTIONS[12], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.command-catalogue"
      ],
      "inputLimits": [
        "Reads the embedded command catalogue and performs no collection."
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "metadata_only",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command emits fixed installed metadata and makes no network request or local evidence read."
        ]
      }
    },
    {
      "id": "manual",
      "summary": "Print the generated manual page",
      "description": "Print a generated roff manual page for local installation.",
      "group": "utilities",
      "common": false,
      "usage": "whoisleuth manual",
      "example": "whoisleuth manual | man -l -",
      "boundary": "Generation is offline and derives from the same command catalogue as focused help.",
      "collection": {
        "mode": "offline",
        "scope": "Builds documentation from the embedded command catalogue."
      },
      "inputs": [],
      "importantOptions": [],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [],
      "inputLimits": [
        "Builds documentation from the embedded command catalogue."
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "metadata_only",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command emits fixed installed metadata and makes no network request or local evidence read."
        ]
      }
    },
    {
      "id": "manifest",
      "summary": "Build an evidence manifest offline",
      "description": "Record an ordered, path-free manifest for up to 129 local files. Use --package --output evidence.zip for a ZIP, add --passphrase-file to encrypt the ordinary package, or use --folder ./evidence for a new unencrypted folder. Add --bagit to ZIP or folder output for BagIt 1.0 with SHA-512 checksums.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth manifest \u003cartefacts...> [--package|--json] --workflow \u003cvalue> [--configuration-digest \u003cvalue>] [--bagit] [--passphrase-file \u003cfile>] [--folder \u003cfile>] [--quiet] [--no-color]",
      "example": "whoisleuth manifest lookup.json comparison.json --workflow \"domain review\" --json",
      "boundary": "Ordinary output contains metadata only. ZIP and folder output include unchanged selected bytes and are private until reviewed for sharing. Folders must be new; existing destinations are never replaced and a failed write may leave explicit partial output. BagIt output is unencrypted; its checksums do not authenticate evidence. Filenames ending in .json are parsed as JSON; other files are opaque and never executed. Original paths are omitted. No network request is made.",
      "collection": {
        "mode": "offline",
        "scope": "Reads 1 to 129 local files, at most 64 MiB each and 71,303,424 bytes combined; retains no source paths."
      },
      "inputs": [
        {
          "name": "artefacts",
          "valueKind": "file",
          "minimum": 1,
          "maximum": 129,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--workflow",
        "--configuration-digest",
        "--package",
        "--bagit",
        "--passphrase-file",
        "--folder",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[13], SHARED_COMMAND_OPTIONS[14], SHARED_COMMAND_OPTIONS[15], SHARED_COMMAND_OPTIONS[16], SHARED_COMMAND_OPTIONS[17], SHARED_COMMAND_OPTIONS[18], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002einvestigation-manifest"
      ],
      "inputLimits": [
        "Reads 1 to 129 local files, at most 64 MiB each and 71,303,424 bytes combined; retains no source paths.",
        "artefacts: 1-129 file values"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "map-observations",
      "summary": "Apply a declarative observation map offline",
      "description": "Apply one bounded declarative field-mapping profile to local source observations.",
      "group": "respond",
      "common": false,
      "usage": "whoisleuth map-observations [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth map-observations mapping.json --json",
      "boundary": "Profiles select allowlisted dotted fields only. They execute no scripts, make no requests, and emit the browser-compatible external-findings contract.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one mapping document capped at 4 MiB and executes no scripts or requests."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002eexternal-observation-mapping"
      ],
      "inputLimits": [
        "Reads one mapping document capped at 4 MiB and executes no scripts or requests.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "oam-export",
      "summary": "Project external findings to Open Asset Model",
      "description": "Project browser-compatible external findings into a bounded Open Asset Model bridge document.",
      "group": "respond",
      "common": false,
      "usage": "whoisleuth oam-export [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth oam-export external-findings.json --json",
      "boundary": "The projection is offline, preserves source completeness without inventing confidence, and covers only bounded FQDN, IP address, certificate, and related edge vocabulary.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one browser-compatible external-findings document and projects bounded graph records locally."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002eopen-asset-model-bridge"
      ],
      "inputLimits": [
        "Reads one browser-compatible external-findings document and projects bounded graph records locally.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "lookup",
      "summary": "Collect one domain, IP, or ASN",
      "description": "Collect registration evidence for one domain, IP, or ASN.",
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth lookup [\u003ctarget>] [--json|--junit|--markdown|--html] [--fast|--deep] [--summary|--verbose] [--no-attribution] [--exact-url] [--observer \u003cvalue>] [--vantage \u003cvalue>] [--plan] [--browse] [--save-lookup \u003cfile>] [--strict-exit] [--fail-on \u003cpolicy[,policy...]>] [--events] [--quiet] [--no-color]",
      "example": "whoisleuth lookup example.test --deep --browse",
      "boundary": "Fast is the default. An ICANN-recognised public domain, reserved documentation domain, IP, or ASN may occupy command position as shorthand; it delegates to this same parser and URL-like input requires the explicit lookup command. Deep mode adds bounded WHOIS, DNS, HTTP, TLS, technology, posture, and network context where applicable. --deep --exact-url explicitly sends the input URL path and query to the website, without its fragment; ordinary URL input sends only the hostname. --plan remains offline and omits the selected URL. Retained paths and page-derived text require review before sharing. A full Deep homepage observation can derive fixed publication and delivery/cache summaries from the same response without retaining raw metadata values or making another request. --browse opens before collection, shows aggregate Fast progress or independently settled planned Deep sources, and then navigates allowlisted retained fields in the completed document. Press ? for help and / to search rendered panel text only. Closing during collection cancels without a partial document. --save-lookup writes the exact completed private JSON only after a normal browser close; it can contain normalised evidence omitted from panels and refuses an existing path.",
      "collection": {
        "mode": "network",
        "scope": "Accepts one target. Fast is the default; deep collection must be selected explicitly."
      },
      "inputs": [
        {
          "name": "target",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": [
            "--browse"
          ]
        }
      ],
      "importantOptions": [
        "--json",
        "--junit",
        "--markdown",
        "--html",
        "--no-attribution",
        "--fast",
        "--deep",
        "--exact-url",
        "--observer",
        "--vantage",
        "--plan",
        "--summary",
        "--verbose",
        "--browse",
        "--save-lookup",
        "--strict-exit",
        "--fail-on",
        "--events",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[19], SHARED_COMMAND_OPTIONS[20], SHARED_COMMAND_OPTIONS[21], SHARED_COMMAND_OPTIONS[22], SHARED_COMMAND_OPTIONS[23], SHARED_COMMAND_OPTIONS[24], SHARED_COMMAND_OPTIONS[25], SHARED_COMMAND_OPTIONS[26], SHARED_COMMAND_OPTIONS[27], SHARED_COMMAND_OPTIONS[28], SHARED_COMMAND_OPTIONS[29], SHARED_COMMAND_OPTIONS[30], SHARED_COMMAND_OPTIONS[31], SHARED_COMMAND_OPTIONS[32], SHARED_COMMAND_OPTIONS[33], SHARED_COMMAND_OPTIONS[34], SHARED_COMMAND_OPTIONS[35], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "conditional_network",
      "disclosureClass": "conditional_bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": true,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.lookup",
        "whoisleuth\u002ecli.lookup-plan"
      ],
      "inputLimits": [
        "Accepts one target. Fast is the default; deep collection must be selected explicitly.",
        "target: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        },
        {
          "option": "--junit",
          "format": "JUnit XML"
        },
        {
          "option": "--markdown",
          "format": "Markdown"
        },
        {
          "option": "--html",
          "format": "HTML"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Source-qualified Lookup",
        "Lookup request plan"
      ],
      "capability": {
        "familyId": "lookup",
        "networkMode": "conditional_bounded_passive",
        "dataSent": [
          "normalised_target",
          "registry_query",
          "whois_query",
          "dns_question",
          "homepage_request",
          "tls_handshake",
          "public_ip_address"
        ],
        "recipients": [
          "registry_service",
          "dns_resolver",
          "target_public_service"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "Only the source families eligible for the selected command and mode receive the bounded target representation.",
          "The plan variant is request-free; collection retains the selected command and mode's evidence and persistence contract."
        ]
      }
    },
    {
      "id": "bulk",
      "summary": "Run bounded multi-target collection",
      "description": "Triage newline-delimited domains, IPs, or ASNs with bounded concurrency.",
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth bulk [\u003csource>] [--json|--jsonl|--junit|--csv|--csv-with-metadata|--domains|--queries] [--registered-only|--inconclusive-only|--errors-only] [--fast|--deep] [--concurrency \u003cinteger>] [--checkpoint \u003cfile>] [--resume] [--events] [--plan] [--fail-on \u003cpolicy[,policy...]>] [--quiet] [--no-color]",
      "example": "cat domains.txt | whoisleuth bulk --jsonl",
      "boundary": "Fast and deep jobs use separate concurrency ceilings. Filters affect output only; collection failures and inconclusive authority states remain explicit in JSON, JSONL, and CSV. --csv-with-metadata adds source versions, separate observation and report times, collection origin and diagnostic states; --csv retains the compact columns.",
      "collection": {
        "mode": "network",
        "scope": "Accepts at most 500 fast or 50 deep targets, with concurrency capped at 8 fast or 3 deep."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--jsonl",
        "--junit",
        "--csv",
        "--csv-with-metadata",
        "--domains",
        "--queries",
        "--registered-only",
        "--inconclusive-only",
        "--errors-only",
        "--fast",
        "--deep",
        "--concurrency",
        "--checkpoint",
        "--resume",
        "--events",
        "--plan",
        "--fail-on",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[36], SHARED_COMMAND_OPTIONS[19], SHARED_COMMAND_OPTIONS[37], SHARED_COMMAND_OPTIONS[38], SHARED_COMMAND_OPTIONS[39], SHARED_COMMAND_OPTIONS[40], SHARED_COMMAND_OPTIONS[41], SHARED_COMMAND_OPTIONS[42], SHARED_COMMAND_OPTIONS[43], SHARED_COMMAND_OPTIONS[23], SHARED_COMMAND_OPTIONS[24], SHARED_COMMAND_OPTIONS[44], SHARED_COMMAND_OPTIONS[45], SHARED_COMMAND_OPTIONS[46], SHARED_COMMAND_OPTIONS[35], SHARED_COMMAND_OPTIONS[28], SHARED_COMMAND_OPTIONS[34], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "conditional_network",
      "disclosureClass": "conditional_bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": true,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.bulk",
        "whoisleuth\u002ecli.bulk.item",
        "whoisleuth\u002ecli.bulk-checkpoint"
      ],
      "inputLimits": [
        "Accepts at most 500 fast or 50 deep targets, with concurrency capped at 8 fast or 3 deep.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        },
        {
          "option": "--jsonl",
          "format": "JSON Lines"
        },
        {
          "option": "--junit",
          "format": "JUnit XML"
        },
        {
          "option": "--csv",
          "format": "CSV"
        },
        {
          "option": "--csv-with-metadata",
          "format": "CSV with evidence metadata"
        },
        {
          "option": "--domains",
          "format": "domain list"
        },
        {
          "option": "--queries",
          "format": "query list"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Bulk result",
        "Bulk checkpoint"
      ],
      "capability": {
        "familyId": "lookup",
        "networkMode": "conditional_bounded_passive",
        "dataSent": [
          "normalised_target",
          "registry_query",
          "whois_query",
          "dns_question",
          "homepage_request",
          "tls_handshake"
        ],
        "recipients": [
          "registry_service",
          "dns_resolver",
          "target_public_service"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "Only the source families eligible for the selected command and mode receive the bounded target representation.",
          "The plan variant is request-free; collection retains the selected command and mode's evidence and persistence contract."
        ]
      }
    },
    {
      "id": "ct-search",
      "summary": "Search certificate observations",
      "description": "Search certificate-transparency observations for one bounded keyword.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth ct-search [\u003ckeyword>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth ct-search \"example brand\" --json",
      "boundary": "Certificate observations do not prove website activity, registration ownership, or malicious intent.",
      "collection": {
        "mode": "network",
        "scope": "Accepts one bounded search keyword and queries the fixed certificate-transparency source."
      },
      "inputs": [
        {
          "name": "keyword",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "always_network",
      "disclosureClass": "bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.ct-search"
      ],
      "inputLimits": [
        "Accepts one bounded search keyword and queries the fixed certificate-transparency source.",
        "keyword: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "certificate_transparency",
        "networkMode": "bounded_passive",
        "dataSent": [
          "certificate_search_term"
        ],
        "recipients": [
          "certificate_transparency_service"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The bounded search term is sent to the fixed Certificate Transparency search service."
        ]
      }
    },
    {
      "id": "ct-intake",
      "summary": "Normalise certificate observations offline",
      "description": "Normalise source-qualified local certificate events into browser-compatible findings.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth ct-intake [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth ct-intake certificate-events.json --json",
      "boundary": "The command is offline, caps output at 100 findings, and treats every event as a review lead rather than proof of serving or control.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one source-qualified event batch capped at 4 MiB and makes no request."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ect-event-batch",
        "whoisleuth\u002eexternal-findings"
      ],
      "inputLimits": [
        "Reads one source-qualified event batch capped at 4 MiB and makes no request.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "discover",
      "summary": "Generate lookalike candidates offline",
      "description": "Generate bounded lookalike-domain candidates from a brand or registrable domain, including multi-part public suffixes.",
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth discover [\u003csubject>] [--json|--jsonl|--domains] [--preset \u003ccommon|impersonation|all>|--families \u003cvalue>] [--tlds \u003cvalue>] [--keyboard \u003cqwerty|azerty|qwertz|all>] [--dictionary \u003cfile>] [--snapshot \u003cfile>] [--quiet] [--no-color]",
      "example": "whoisleuth discover example.test --preset common --jsonl",
      "boundary": "Generation and optional local snapshot comparison are offline. Candidates are leads only and are not resolved, registered, or classified as malicious.",
      "collection": {
        "mode": "offline",
        "scope": "Generates a bounded candidate set from local rules, dictionaries, and optional saved snapshots."
      },
      "inputs": [
        {
          "name": "subject",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--tlds",
        "--preset",
        "--families",
        "--keyboard",
        "--dictionary",
        "--snapshot",
        "--json",
        "--jsonl",
        "--domains",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[47], SHARED_COMMAND_OPTIONS[48], SHARED_COMMAND_OPTIONS[49], SHARED_COMMAND_OPTIONS[50], SHARED_COMMAND_OPTIONS[51], SHARED_COMMAND_OPTIONS[52], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[36], SHARED_COMMAND_OPTIONS[39], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.discover",
        "whoisleuth\u002ecli.discover.item",
        "whoisleuth\u002ecli.discovery-snapshot"
      ],
      "inputLimits": [
        "Generates a bounded candidate set from local rules, dictionaries, and optional saved snapshots.",
        "subject: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        },
        {
          "option": "--jsonl",
          "format": "JSON Lines"
        },
        {
          "option": "--domains",
          "format": "domain list"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Candidate set",
        "Discovery snapshot"
      ],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "discover-scan",
      "summary": "Collect a supervised candidate review queue",
      "description": "Generate a bounded candidate set, collect a selected subset, and produce a supervised review queue.",
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth discover-scan [\u003csubject>] [--json|--jsonl|--csv|--csv-with-metadata|--domains] [--preset \u003ccommon|impersonation|all>|--families \u003cvalue>] [--fast|--deep] [--registered-only|--inconclusive-only|--acquisition-only|--suppressed-only] [--tlds \u003cvalue>] [--keyboard \u003cqwerty|azerty|qwertz|all>] [--dictionary \u003cfile>] [--scan-limit \u003cinteger>] [--chunk-size \u003cinteger>] [--concurrency \u003cinteger>] [--resolver \u003cvalue>] [--allowlist \u003cfile>] [--checkpoint \u003cfile>] [--resume] [--observation-snapshot \u003cfile>] [--events] [--plan] [--fail-on \u003cpolicy[,policy...]>] [--quiet] [--no-color]",
      "example": "whoisleuth discover-scan example.test --scan-limit 50 --checkpoint scan.json --json",
      "boundary": "This command performs network collection. Fast compact lookup is the default; deep mode is capped at 50 candidates. Allowlisting changes review priority only and shared infrastructure remains a lead, not attribution. --csv-with-metadata adds source versions, separate observation and report times, collection origin and diagnostic states; --csv retains the compact columns.",
      "collection": {
        "mode": "network",
        "scope": "Scans at most 500 fast or 50 deep candidates, with concurrency capped at 8 fast or 3 deep."
      },
      "inputs": [
        {
          "name": "subject",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--tlds",
        "--preset",
        "--families",
        "--keyboard",
        "--dictionary",
        "--fast",
        "--deep",
        "--scan-limit",
        "--chunk-size",
        "--concurrency",
        "--resolver",
        "--allowlist",
        "--checkpoint",
        "--resume",
        "--observation-snapshot",
        "--registered-only",
        "--inconclusive-only",
        "--acquisition-only",
        "--suppressed-only",
        "--events",
        "--plan",
        "--fail-on",
        "--json",
        "--jsonl",
        "--csv",
        "--csv-with-metadata",
        "--domains",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[47], SHARED_COMMAND_OPTIONS[48], SHARED_COMMAND_OPTIONS[49], SHARED_COMMAND_OPTIONS[50], SHARED_COMMAND_OPTIONS[51], SHARED_COMMAND_OPTIONS[23], SHARED_COMMAND_OPTIONS[24], SHARED_COMMAND_OPTIONS[53], SHARED_COMMAND_OPTIONS[54], SHARED_COMMAND_OPTIONS[44], SHARED_COMMAND_OPTIONS[55], SHARED_COMMAND_OPTIONS[56], SHARED_COMMAND_OPTIONS[45], SHARED_COMMAND_OPTIONS[46], SHARED_COMMAND_OPTIONS[57], SHARED_COMMAND_OPTIONS[41], SHARED_COMMAND_OPTIONS[42], SHARED_COMMAND_OPTIONS[58], SHARED_COMMAND_OPTIONS[59], SHARED_COMMAND_OPTIONS[35], SHARED_COMMAND_OPTIONS[28], SHARED_COMMAND_OPTIONS[34], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[36], SHARED_COMMAND_OPTIONS[37], SHARED_COMMAND_OPTIONS[38], SHARED_COMMAND_OPTIONS[39], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "conditional_network",
      "disclosureClass": "conditional_bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": true,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.discovery-scan",
        "whoisleuth\u002ecli.discovery-scan.item",
        "whoisleuth\u002ecli.discovery-observation-snapshot"
      ],
      "inputLimits": [
        "Scans at most 500 fast or 50 deep candidates, with concurrency capped at 8 fast or 3 deep.",
        "subject: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        },
        {
          "option": "--jsonl",
          "format": "JSON Lines"
        },
        {
          "option": "--csv",
          "format": "CSV"
        },
        {
          "option": "--csv-with-metadata",
          "format": "CSV with evidence metadata"
        },
        {
          "option": "--domains",
          "format": "domain list"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Reviewed candidate queue",
        "Observation snapshot"
      ],
      "capability": {
        "familyId": "lookup",
        "networkMode": "conditional_bounded_passive",
        "dataSent": [
          "normalised_target",
          "registry_query",
          "whois_query",
          "dns_question",
          "homepage_request",
          "tls_handshake"
        ],
        "recipients": [
          "registry_service",
          "dns_resolver",
          "target_public_service"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "Only the source families eligible for the selected command and mode receive the bounded target representation.",
          "The plan variant is request-free; collection retains the selected command and mode's evidence and persistence contract."
        ]
      }
    },
    {
      "id": "posture",
      "summary": "Review DNS and mail posture",
      "description": "Review bounded DNS mail, delegation, and domain-control posture.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth posture [\u003cdomain>] [--json|--sarif] [--selectors \u003cvalue>] [--retired-selectors \u003cvalue>] [--mail-profile \u003cstandard|defensive-no-mail|parked>] [--include-inherited-dns] [--owned-domain] [--quiet] [--no-color]",
      "example": "whoisleuth posture example.test --mail-profile standard --json",
      "boundary": "Missing or failed DNS observations remain inconclusive. --include-inherited-dns explicitly adds a bounded DMARC tree walk and direct parent-delegation sample; records retain their queried owner and source. No message is sent and receiver enforcement is not inferred.",
      "collection": {
        "mode": "network",
        "scope": "Accepts one domain and performs bounded RDAP, DNS, and conditional MTA-STS HTTPS requests. --include-inherited-dns separately adds ancestor DMARC questions and direct DNS/TCP to sampled parent servers."
      },
      "inputs": [
        {
          "name": "domain",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--selectors",
        "--retired-selectors",
        "--mail-profile",
        "--include-inherited-dns",
        "--json",
        "--sarif",
        "--owned-domain",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[60], SHARED_COMMAND_OPTIONS[61], SHARED_COMMAND_OPTIONS[62], SHARED_COMMAND_OPTIONS[63], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[64], SHARED_COMMAND_OPTIONS[65], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "always_network",
      "disclosureClass": "bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.posture"
      ],
      "inputLimits": [
        "Accepts one domain and performs bounded RDAP, DNS, and conditional MTA-STS HTTPS requests. --include-inherited-dns separately adds ancestor DMARC questions and direct DNS/TCP to sampled parent servers.",
        "domain: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        },
        {
          "option": "--sarif",
          "format": "SARIF"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "domain_posture",
        "networkMode": "bounded_passive",
        "dataSent": [
          "normalised_target",
          "registry_query",
          "dns_question",
          "mta_sts_policy_request"
        ],
        "recipients": [
          "registry_service",
          "dns_resolver",
          "target_public_service"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The posture review performs bounded RDAP, DNS and MTA-STS publication checks without changing configuration."
        ]
      }
    },
    {
      "id": "http",
      "summary": "Inspect one homepage request",
      "description": "Inspect one homepage request, redirects, and bounded response metadata.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth http [\u003cdomain>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth http example.test --json",
      "boundary": "Requests use the shared public-address and redirect guards. Fixed content-coding and cache-policy metadata describes only the selected response, excludes raw header values, and does not prove caching, transfer savings, performance, privacy, or safety. This is not a rendered browser or vulnerability scan.",
      "collection": {
        "mode": "network",
        "scope": "Accepts one domain and follows only the bounded SSRF-guarded homepage redirect workflow."
      },
      "inputs": [
        {
          "name": "domain",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "always_network",
      "disclosureClass": "bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.http"
      ],
      "inputLimits": [
        "Accepts one domain and follows only the bounded SSRF-guarded homepage redirect workflow.",
        "domain: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "website_probe",
        "networkMode": "bounded_passive",
        "dataSent": [
          "normalised_target",
          "dns_question",
          "homepage_request"
        ],
        "recipients": [
          "dns_resolver",
          "target_public_service"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The target public service receives one bounded SSRF-guarded homepage workflow."
        ]
      }
    },
    {
      "id": "tls",
      "summary": "Inspect one TLS connection",
      "description": "Inspect one hostname certificate through a bounded TLS connection.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth tls [\u003chostname>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth tls example.test --json",
      "boundary": "One observed connection is point-in-time evidence and does not establish every address, edge, or historical certificate.",
      "collection": {
        "mode": "network",
        "scope": "Accepts one public hostname and opens one bounded certificate connection."
      },
      "inputs": [
        {
          "name": "hostname",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "always_network",
      "disclosureClass": "bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.tls"
      ],
      "inputLimits": [
        "Accepts one public hostname and opens one bounded certificate connection.",
        "hostname: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "tls_intelligence",
        "networkMode": "bounded_passive",
        "dataSent": [
          "normalised_target",
          "dns_question",
          "tls_handshake"
        ],
        "recipients": [
          "dns_resolver",
          "target_public_service"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The selected public endpoint receives one bounded certificate connection."
        ]
      }
    },
    {
      "id": "dnssec-validate",
      "summary": "Validate an authorised DNSSEC chain",
      "description": "Cryptographically validate one authorised DNSSEC chain from a supplied trust anchor through one selected public resolver.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth dnssec-validate \u003cdomain> --resolver \u003cvalue> --trust-anchor \u003cfile> --owned-or-authorized [--json] [--quiet] [--no-color]",
      "example": "whoisleuth dnssec-validate example.test --resolver \"$PUBLIC_RESOLVER_IP\" --trust-anchor anchor.json --owned-or-authorized --json",
      "boundary": "This isolated action is never invoked by Lookup, Bulk, monitoring, or recipes. It caps DNS queries, aliases, delegations, bytes, and duration; transport and validation failures remain separate, and secure is not a general safety verdict.",
      "collection": {
        "mode": "network",
        "scope": "Accepts one authorised domain, one public resolver IP, and one local trust-anchor file; DNS-over-TCP validation is capped at 32 queries and 15 seconds."
      },
      "inputs": [
        {
          "name": "domain",
          "valueKind": "text",
          "minimum": 1,
          "maximum": 1,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--resolver",
        "--trust-anchor",
        "--owned-or-authorized",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[55], SHARED_COMMAND_OPTIONS[66], SHARED_COMMAND_OPTIONS[67], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "always_network",
      "disclosureClass": "bounded_authorised_active",
      "explicitAuthorisationRequired": true,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ednssec-chain-validation",
        "whoisleuth\u002ednssec-trust-anchor"
      ],
      "inputLimits": [
        "Accepts one authorised domain, one public resolver IP, and one local trust-anchor file; DNS-over-TCP validation is capped at 32 queries and 15 seconds.",
        "domain: 1-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "dnssec_validation",
        "networkMode": "bounded_authorised_active",
        "dataSent": [
          "normalised_target",
          "dns_question"
        ],
        "recipients": [
          "selected_public_resolver"
        ],
        "authorisation": "owned_or_authorised_acknowledgement",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The selected resolver receives the bounded questions only after the owned-or-authorised acknowledgement.",
          "The local trust anchor is read from the selected file and is never transmitted."
        ]
      }
    },
    {
      "id": "mail-transport",
      "summary": "Review selected authorised SMTP transports",
      "description": "Review selected authorised MX endpoints, DNSSEC-qualified TLSA evidence, SMTP capabilities, and optional STARTTLS certificates.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth mail-transport [\u003csource>] --resolver \u003cvalue> --trust-anchor \u003cfile> --owned-or-authorized --active-probe [--json] [--quiet] [--no-color]",
      "example": "whoisleuth mail-transport selected-mx.json --resolver \"$PUBLIC_RESOLVER_IP\" --trust-anchor anchor.json --owned-or-authorized --active-probe --json",
      "boundary": "This isolated action probes at most three selected MX hosts sequentially, reports selection, public revalidation, connection, and address authentication separately, sends only EHLO and optional STARTTLS, never retries, and performs no authentication, relay, recipient, mailbox, catch-all, or message test. If a DANE-TA TLSA usage 2 association is published, active collection retains only the leaf certificate and leaves that comparison partial without certificate-path construction and trust-anchor path validation. SMTP relay PKIX-TA usage 0 and PKIX-EE usage 1 records remain unsupported and cannot complete SMTP DANE assurance; a separate usage 3 match remains eligible.",
      "collection": {
        "mode": "network",
        "scope": "Accepts at most three selected authorised MX hosts, uses one public resolver, and performs sequential bounded SMTP connections with no retries."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--resolver",
        "--trust-anchor",
        "--owned-or-authorized",
        "--active-probe",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[55], SHARED_COMMAND_OPTIONS[66], SHARED_COMMAND_OPTIONS[67], SHARED_COMMAND_OPTIONS[68], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "always_network",
      "disclosureClass": "bounded_authorised_active",
      "explicitAuthorisationRequired": true,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002email-transport.input",
        "whoisleuth\u002ecli.mail-transport-review"
      ],
      "inputLimits": [
        "Accepts at most three selected authorised MX hosts, uses one public resolver, and performs sequential bounded SMTP connections with no retries.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "mail_transport_review",
        "networkMode": "bounded_authorised_active",
        "dataSent": [
          "normalised_target",
          "dns_question",
          "mail_transport_commands",
          "tls_handshake"
        ],
        "recipients": [
          "selected_public_resolver",
          "selected_mail_endpoint"
        ],
        "authorisation": "owned_or_authorised_acknowledgement",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command requires both owned-or-authorised and active-probe acknowledgements.",
          "It never sends mail, authenticates, tests relay, enumerates recipients or retries automatically."
        ]
      }
    },
    {
      "id": "registry-support",
      "summary": "Explain local registry coverage",
      "description": "Explain the local registry capability profile for one domain or suffix.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth registry-support [\u003cdomain-or-suffix>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth registry-support example.test --json",
      "boundary": "This command is offline. Catalogue coverage does not test live reachability or decide registration or availability.",
      "collection": {
        "mode": "offline",
        "scope": "Reads the embedded registry capability catalogue for one domain or suffix."
      },
      "inputs": [
        {
          "name": "domain-or-suffix",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.registry-support",
        "whoisleuth\u002eregistry-standards-coverage"
      ],
      "inputLimits": [
        "Reads the embedded registry capability catalogue for one domain or suffix.",
        "domain-or-suffix: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "registry-doctor",
      "summary": "Diagnose saved registry collection",
      "description": "Compare a saved Lookup registry result with the reviewed local capability profile.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth registry-doctor [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth registry-doctor lookup.json --json",
      "boundary": "The command is offline. It distinguishes expected access constraints from collection results and does not contact a live registry.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one saved Lookup and the embedded registry capability catalogue."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.registry-doctor"
      ],
      "inputLimits": [
        "Reads one saved Lookup and the embedded registry capability catalogue.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "registry-cohort",
      "summary": "Build target-free registry quality timelines",
      "description": "Build privacy-safe suffix and capability-profile timelines from saved observations or retained cohort reports.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth registry-cohort [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth registry-cohort saved-lookups.jsonl --json",
      "boundary": "This command is offline and omits domains, queries, and raw evidence. Input families cannot be mixed, and retained samples are never assumed independent.",
      "collection": {
        "mode": "offline",
        "scope": "Reads at most 500 saved Lookups or retained cohort reports from one unmixed family and emits bounded target-free timelines."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.registry-cohort"
      ],
      "inputLimits": [
        "Reads at most 500 saved Lookups or retained cohort reports from one unmixed family and emits bounded target-free timelines.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "registry-scaffold",
      "summary": "Create a sanitised registry fixture scaffold",
      "description": "Create a bounded synthetic WHOIS fixture scaffold for one existing capability profile.",
      "group": "utilities",
      "common": false,
      "usage": "whoisleuth registry-scaffold --profile \u003cvalue> --suffix \u003cvalue> --scenario \u003cregistered|not_found|inconclusive>",
      "example": "whoisleuth registry-scaffold --profile example-profile --suffix test --scenario registered",
      "boundary": "The output is a sanitised template only. Its command-owned --profile selects fixture capability, --config is rejected, and contributors must not paste live responses or personal registration data into fixtures.",
      "collection": {
        "mode": "offline",
        "scope": "Reads the embedded registry capability catalogue and prints one synthetic fixture template."
      },
      "inputs": [],
      "importantOptions": [
        "--profile",
        "--suffix",
        "--scenario"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[69], SHARED_COMMAND_OPTIONS[70], SHARED_COMMAND_OPTIONS[71]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [],
      "inputLimits": [
        "Reads the embedded registry capability catalogue and prints one synthetic fixture template."
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "risk-calibrate",
      "summary": "Replay reviewed Risk labels offline",
      "description": "Replay reviewed labels against the current explainable Risk model.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth risk-calibrate [\u003csource>] [--json|--summary-json] [--quiet] [--no-color]",
      "example": "whoisleuth risk-calibrate calibration.json --summary-json",
      "boundary": "Calibration is offline and diagnostic. The summary form omits record identifiers, domains, and evidence; neither form trains, tunes, or changes the scoring model automatically.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one bounded reviewed-label dataset and changes no model or evidence."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--summary-json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[72], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002erisk-calibration-dataset",
        "whoisleuth\u002ecli.risk-calibration"
      ],
      "inputLimits": [
        "Reads one bounded reviewed-label dataset and changes no model or evidence.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        },
        {
          "option": "--summary-json",
          "format": "summary JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "lookalike-calibrate",
      "summary": "Summarise reviewed lookalike yield offline",
      "description": "Summarise reviewed candidate dispositions by mutation family without retaining domains.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth lookalike-calibrate [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth lookalike-calibrate reviewed-candidates.json --json",
      "boundary": "Calibration is offline and diagnostic. It omits candidate identifiers, domains, notes, and evidence and never tunes generation or filtering automatically.",
      "collection": {
        "mode": "offline",
        "scope": "Reads at most 5,000 reviewed candidate labels from one dataset capped at 2 MiB."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002elookalike-calibration-input",
        "whoisleuth\u002elookalike-calibration"
      ],
      "inputLimits": [
        "Reads at most 5,000 reviewed candidate labels from one dataset capped at 2 MiB.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "verify-artifact",
      "summary": "Validate saved evidence offline",
      "description": "Validate a supported archive, ordinary Case export, claim passport, packet, manifest, saved Lookup or Lookup-evidence export without printing evidence contents. Use --package for an evidence ZIP or encrypted package, with --passphrase-file to unlock it; use --folder ./evidence for an unencrypted evidence folder. Add --bagit with --package or --folder to verify BagIt 1.0.",
      "group": "assure",
      "common": true,
      "usage": "whoisleuth verify-artifact [\u003csource>] [--passphrase-file \u003cfile>] [--manifest \u003cfile>] [--manifest-entry \u003cmanifest-entry>] [--package] [--bagit] [--folder \u003cfile>] [--json] [--strict-exit] [--quiet] [--no-color]",
      "example": "whoisleuth verify-artifact report.json --manifest manifest.json --manifest-entry artifact-2 --json --strict-exit",
      "boundary": "Verification is offline and redacted. ZIP and folder entries are reported separately without importing them. Case exports are checked without repairing content; ordinary package review also counts original references with matching bytes. Ordinary folders allow only the declared layout; BagIt allows bounded nested payloads and checks SHA-256/SHA-512 manifests without interpreting payloads. Symbolic links are refused. BagIt fetch.txt is never fetched; missing files, mismatches and unsupported algorithms remain explicit. Package digests describe bytes, not filesystem metadata or authenticity. In scripts, use --strict-exit: incomplete verification returns 4. Default exit 0 means the report was produced, not that its checks passed.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected bounded artefact, ZIP or explicit evidence folder and, when explicitly supplied, one manifest whose selected entry is compared by exact bytes and canonical identity."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": [
            "--package"
          ]
        }
      ],
      "importantOptions": [
        "--passphrase-file",
        "--manifest",
        "--manifest-entry",
        "--package",
        "--bagit",
        "--folder",
        "--json",
        "--strict-exit",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[17], SHARED_COMMAND_OPTIONS[73], SHARED_COMMAND_OPTIONS[74], SHARED_COMMAND_OPTIONS[75], SHARED_COMMAND_OPTIONS[76], SHARED_COMMAND_OPTIONS[77], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[33], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002eoffline-artifact-verification"
      ],
      "inputLimits": [
        "Reads one selected bounded artefact, ZIP or explicit evidence folder and, when explicitly supplied, one manifest whose selected entry is compared by exact bytes and canonical identity.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Offline verification report"
      ],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "interchange-report",
      "summary": "Report portable artefact fidelity offline",
      "description": "Report what one recognised portable artefact preserves, excludes, and supports across browser and CLI workflows.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth interchange-report [\u003csource>] [--passphrase-file \u003cfile>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth interchange-report workspace.json --json",
      "boundary": "The report is offline and metadata-only. It does not echo targets, contacts, notes, passphrases, evidence values, or an unrecognised schema string.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected bounded portable artefact and emits fixed compatibility metadata only."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--passphrase-file",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[17], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002einterchange-fidelity-report"
      ],
      "inputLimits": [
        "Reads one selected bounded portable artefact and emits fixed compatibility metadata only.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial",
          "unsupported",
          "unavailable"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "inspect-archive",
      "summary": "Inspect an archive locally",
      "description": "Summarise or search one current version-9 workspace archive, with exact version-5 and version-6 and version-7 and version-8 support and redacted output by default.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth inspect-archive [\u003csource>] [--passphrase-file \u003cfile>] [--search \u003cvalue>] [--require-match] [--reveal] [--expect-content-digest \u003cvalue>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth inspect-archive workspace.json --search example.test --json",
      "boundary": "Exact values require --reveal. New content comparisons use the reported sorted-json-v2:sha256 identity with --expect-content-digest; bare sha256 hashes retain their legacy locale-sensitive meaning. Retired and future archives are rejected. The archive is read locally and is never uploaded.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected bounded workspace archive v9, retains exact v5 and v6 and v7 and v8 compatibility, and redacts output by default."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--passphrase-file",
        "--search",
        "--require-match",
        "--reveal",
        "--expect-content-digest",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[17], SHARED_COMMAND_OPTIONS[78], SHARED_COMMAND_OPTIONS[79], SHARED_COMMAND_OPTIONS[80], SHARED_COMMAND_OPTIONS[81], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002eworkspace-archive-inspection"
      ],
      "inputLimits": [
        "Reads one selected bounded workspace archive v9, retains exact v5 and v6 and v7 and v8 compatibility, and redacts output by default.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial",
          "unavailable"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "sign-artifact",
      "summary": "Sign a reviewed artefact locally",
      "description": "Sign one reviewed response packet or supported manifest with a local private key.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth sign-artifact [\u003csource>] --private-key-file \u003cfile>",
      "example": "whoisleuth sign-artifact packet.json --private-key-file analyst-private.pem",
      "boundary": "The command never creates, stores, or transmits keys. Key custody and signer identity remain the operator's responsibility.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected artefact and one local private key without transmitting either."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--private-key-file"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[82]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002esigned-evidence-package"
      ],
      "inputLimits": [
        "Reads one selected artefact and one local private key without transmitting either.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "verify-signature",
      "summary": "Verify a signed evidence package",
      "description": "Verify one signed package and report embedded-artefact assurance separately. --trust-store-file also checks an explicit local fingerprint policy and emits a signer-trust report; unknown, retired, revoked or future-reviewed entries exit 4.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth verify-signature [\u003csource>] [--public-key-file \u003cfile>] [--trust-store-file \u003cfile>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth verify-signature packet.signed.json --trust-store-file trust.json --json",
      "boundary": "A valid signature proves package consistency for the embedded key, not identity, authority or evidence accuracy. With --trust-store-file, unknown, retired, revoked or future-reviewed entries exit 4 even if --public-key-file matches. Replacement fingerprints need their own trusted entry; no signing date overrides current revocation.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected signed package, optional local public key and explicit fingerprint trust file. No automatic trust discovery or network requests."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--public-key-file",
        "--trust-store-file",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[83], SHARED_COMMAND_OPTIONS[84], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002eevidence-signature-verification",
        "whoisleuth\u002eevidence-signer-trust-store",
        "whoisleuth\u002eevidence-signer-trust-report"
      ],
      "inputLimits": [
        "Reads one selected signed package, optional local public key and explicit fingerprint trust file. No automatic trust discovery or network requests.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial",
          "unavailable"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "source-report",
      "summary": "Build a target-free source report",
      "description": "Create a target-free reliability summary from a saved lookup.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth source-report [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth source-report lookup.json --json",
      "boundary": "The report retains source states and timings but excludes targets, queries, endpoints, and raw evidence.",
      "collection": {
        "mode": "offline",
        "scope": "Reads bounded saved evidence and emits target-free source reliability data."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002esource-reliability-report"
      ],
      "inputLimits": [
        "Reads bounded saved evidence and emits target-free source reliability data.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "compare",
      "summary": "Compare registry publications in one lookup",
      "description": "Compare separately attributed registry publications in a saved lookup.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth compare [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth compare lookup.json --json",
      "boundary": "Comparison is offline. Differences are review context and do not by themselves prove which publication is current.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one saved Lookup and compares its separately attributed registry publications."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.compare"
      ],
      "inputLimits": [
        "Reads one saved Lookup and compares its separately attributed registry publications.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "page-compare",
      "summary": "Compare saved static page evidence",
      "description": "Compare static page identity, favicon, technology, and TLS evidence in two saved deep lookups.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth page-compare \u003csources...> [--json] [--quiet] [--no-color]",
      "example": "whoisleuth page-compare official.json candidate.json --json",
      "boundary": "Comparison is offline and component-based. It executes no page code and produces no aggregate similarity or maliciousness score.",
      "collection": {
        "mode": "offline",
        "scope": "Reads two saved Lookup documents and executes no page code."
      },
      "inputs": [
        {
          "name": "sources",
          "valueKind": "file",
          "minimum": 2,
          "maximum": 2,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.page-compare"
      ],
      "inputLimits": [
        "Reads two saved Lookup documents and executes no page code.",
        "sources: 2-2 file values"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "mail-review",
      "summary": "Review saved passive mail evidence",
      "description": "Review passive MX, null MX, SPF, DMARC, and shared mail-provider evidence from saved Bulk results.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth mail-review [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth mail-review candidates.json --json",
      "boundary": "Review is offline and sends no SMTP traffic. Missing or partial DNS evidence remains inconclusive.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one saved Bulk result and sends no DNS or SMTP traffic."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.mail-review"
      ],
      "inputLimits": [
        "Reads one saved Bulk result and sends no DNS or SMTP traffic.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "mail-headers",
      "summary": "Review message headers offline",
      "description": "Review identity, reported authentication, domain alignment, and Received routing from selected message headers.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth mail-headers [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth mail-headers message.eml --json",
      "boundary": "Review is offline. It makes no DNS, SMTP, HTTP, registry, or provider request, and does not retain address local parts, display names, subjects, message bodies, attachments, or raw header values. Reported authentication is not independently validated.",
      "collection": {
        "mode": "offline",
        "scope": "Parses only the bounded header block from one selected message or standard input."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.mail-header-review"
      ],
      "inputLimits": [
        "Parses only the bounded header block from one selected message or standard input.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "intake",
      "summary": "Review suspicious messages and QR links offline",
      "description": "Extract and review links, message identities, authorisation parameters and QR destinations from a selected file or pasted text.",
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth intake \u003ctext|email|calendar|qr> [\u003csource>] [--json] [--reported-action \u003creported-action>] [--strict-exit] [--quiet] [--no-color]",
      "example": "whoisleuth intake email message.eml --json",
      "boundary": "Offline only: no link, attachment, command or QR payload is opened or executed. Email and calendar files may contain private data; output excludes original bodies, subjects, address local parts, URL paths, queries and fragments. Authentication headers are reported claims. QR input is a selected still PNG; non-URL and undecodable content is not interpreted as an absent threat. Use --strict-exit to return 4 when review bounds or unreviewed attachments make the report partial.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected text, MIME email, calendar or PNG file. No collection or automatic Case write."
      },
      "inputs": [
        {
          "name": "kind",
          "valueKind": "enum",
          "minimum": 1,
          "maximum": 1,
          "values": [
            "text",
            "email",
            "calendar",
            "qr"
          ],
          "inputSource": "argv",
          "requiredWhenOptions": []
        },
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--reported-action",
        "--strict-exit",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[85], SHARED_COMMAND_OPTIONS[33], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002emessage-intake"
      ],
      "inputLimits": [
        "Reads one selected text, MIME email, calendar or PNG file. No collection or automatic Case write.",
        "kind: 1-1 enum value",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "review-evidence",
      "summary": "Review supplied evidence offline",
      "description": "Review versioned protocol evidence, incident sequences, domain history, platform objects, storefronts or connector configuration offline.",
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth review-evidence [\u003csource>] [--mmdb \u003cfile>] [--json] [--strict-exit] [--quiet] [--no-color]",
      "example": "whoisleuth review-evidence domain-change.json --json --strict-exit",
      "boundary": "The command reads only the supplied document. It performs no DNS, RDAP, BGP, GeoIP-provider, TLS, HTTP, certificate-authority, or SMTP request.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one bounded versioned evidence or request-planning document and performs no collection."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--mmdb",
        "--json",
        "--strict-exit",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[86], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[33], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002econtext-review",
        "whoisleuth\u002edomain-history.input",
        "whoisleuth\u002eplatform-continuity.input",
        "whoisleuth\u002estorefront-review.input",
        "whoisleuth\u002econnector-review.input",
        "whoisleuth\u002eincident-sequence.input",
        "whoisleuth\u002ecli.offline-evidence-review",
        "whoisleuth\u002erdap-search-input",
        "whoisleuth\u002ednssec-evidence-input",
        "whoisleuth\u002etlsa-evidence-input",
        "whoisleuth\u002erpki-route-input",
        "whoisleuth\u002elocal-geoip-query",
        "whoisleuth\u002eencrypted-dns-plan-input"
      ],
      "inputLimits": [
        "Reads one bounded versioned evidence or request-planning document and performs no collection.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial",
          "blocked"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "brief",
      "summary": "Build a decision brief from a saved lookup",
      "description": "Turn one saved Lookup into a compact decision brief with facts, unknowns, contradictions, and next actions.",
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth brief [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth brief lookup.json --json",
      "boundary": "The command is offline, excludes raw upstream payloads, and does not create an analyst assertion or claim that the saved observation is current.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one bounded saved Lookup and emits a compact source-attributed decision brief."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.lookup-brief"
      ],
      "inputLimits": [
        "Reads one bounded saved Lookup and emits a compact source-attributed decision brief.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "case",
      "summary": "Review and update ordinary local Case files",
      "description": "Show or open a local Case, append a note or evidence pin, record an assessment, or retain an offline recheck. Use --input for pin, assessment and recheck JSON; --text or --note-file for a note. Mutations require --output and always write the complete current Case export.",
      "group": "respond",
      "common": true,
      "usage": "whoisleuth case \u003cshow|open|note|pin|assess|recheck> [\u003csource>] [--text \u003cvalue>|--note-file \u003cfile>] [--case-id \u003cvalue>] [--domain \u003cvalue>] [--title \u003cvalue>] [--new-incident] [--input \u003cfile>] [--expect-file-digest \u003cvalue>] [--json] [--no-color]",
      "example": "whoisleuth case open --domain example.test --output cases.json\n  whoisleuth case show cases.json\n  whoisleuth case note cases.json --text \"Review the retained observation\" --output cases.json --force",
      "boundary": "No database, browser launch, request or external report is created. Select --case-id when a file contains multiple Cases. Existing files require --force; --expect-file-digest sha256:\u003cdigest> additionally checks the exact file reviewed earlier. Source and output leases reject concurrent changes. Interrupted .workflow.lock files require deliberate inspection. Recheck records supplied observations; it does not collect them. Not reproduced requires an existing saved question, a complete observation and comparable conditions. Working exports include private analyst content and file references, not attached file bytes.",
      "collection": {
        "mode": "offline",
        "scope": "Reads exact Case schemas 15 or 16. Input is bounded to 16 MiB including formatting; the complete canonical Case store must fit 4 MiB without pruning. Writes current schema 16."
      },
      "inputs": [
        {
          "name": "operation",
          "valueKind": "enum",
          "minimum": 1,
          "maximum": 1,
          "values": [
            "show",
            "open",
            "note",
            "pin",
            "assess",
            "recheck"
          ],
          "inputSource": "argv",
          "requiredWhenOptions": []
        },
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--case-id",
        "--domain",
        "--title",
        "--new-incident",
        "--text",
        "--note-file",
        "--input",
        "--expect-file-digest",
        "--json",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[87], SHARED_COMMAND_OPTIONS[88], SHARED_COMMAND_OPTIONS[89], SHARED_COMMAND_OPTIONS[90], SHARED_COMMAND_OPTIONS[91], SHARED_COMMAND_OPTIONS[92], SHARED_COMMAND_OPTIONS[93], SHARED_COMMAND_OPTIONS[94], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecase-export"
      ],
      "inputLimits": [
        "Reads exact Case schemas 15 or 16. Input is bounded to 16 MiB including formatting; the complete canonical Case store must fit 4 MiB without pruning. Writes current schema 16.",
        "operation: 1-1 enum value",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Case export"
      ],
      "capability": {
        "familyId": "analyst_cases",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "case-pack",
      "summary": "Build a reviewed case package",
      "description": "Package browser-created Case records from schemas 15 or 16 as a reviewed, audience-specific Case-pack v2 with current schema 16.",
      "group": "respond",
      "common": true,
      "usage": "whoisleuth case-pack [\u003csource>] --audience \u003cinternal|trusted|public> --reviewed [--json] [--quiet] [--no-color]",
      "example": "whoisleuth case-pack cases.json --audience trusted --reviewed --json",
      "boundary": "The command is an offline handoff from the browser Case workflow: it creates a new package, never creates or mutates a durable Case, never mutates the source archive, and requires an explicit review acknowledgement.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one bounded Case export from schemas 15 or 16 and writes a separate audience-specific Case-pack v2."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--audience",
        "--reviewed",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[95], SHARED_COMMAND_OPTIONS[96], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.case-pack",
        "whoisleuth\u002ecase-report"
      ],
      "inputLimits": [
        "Reads one bounded Case export from schemas 15 or 16 and writes a separate audience-specific Case-pack v2.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Reviewed Case-pack v2"
      ],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "domain-control",
      "summary": "Build or review a domain control manifest",
      "description": "Build an integrity-protected desired-state manifest or compare one with supplied observations.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth domain-control [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth domain-control domain-control-input.json --json",
      "boundary": "The command is offline and changes no registrar, DNS, mail, or certificate configuration. Only complete, recent source observations can establish drift or expected absence.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one bounded desired-state or review document and performs no collection or configuration change."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.domain-control-review-input",
        "whoisleuth\u002ecli.domain-control-review"
      ],
      "inputLimits": [
        "Reads one bounded desired-state or review document and performs no collection or configuration change.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "monitor-once",
      "summary": "Run one bounded domain control review",
      "description": "Collect one bounded owned-domain review and compare it with an optional prior checkpoint.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth monitor-once [\u003csource>] [--json|--junit] [--previous \u003cfile>] [--limit \u003cinteger>] [--concurrency \u003cinteger>] [--fail-on \u003cpolicy[,policy...]>] [--quiet] [--no-color]",
      "example": "whoisleuth monitor-once manifest.json --previous previous.json --json --output next.json",
      "boundary": "This is an operator-scheduled one-shot collection, not a daemon. It caps targets and concurrency, retains normalised observations, and never changes domain configuration.",
      "collection": {
        "mode": "network",
        "scope": "Runs deep collection for at most 20 manifest domains with concurrency capped at 3."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--previous",
        "--limit",
        "--concurrency",
        "--fail-on",
        "--json",
        "--junit",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[97], SHARED_COMMAND_OPTIONS[98], SHARED_COMMAND_OPTIONS[99], SHARED_COMMAND_OPTIONS[100], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[19], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "always_network",
      "disclosureClass": "bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.domain-control-monitor",
        "whoisleuth\u002edomain-control-flight-recorder.input"
      ],
      "inputLimits": [
        "Runs deep collection for at most 20 manifest domains with concurrency capped at 3.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        },
        {
          "option": "--junit",
          "format": "JUnit XML"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "lookup",
        "networkMode": "bounded_passive",
        "dataSent": [
          "normalised_target",
          "registry_query",
          "whois_query",
          "dns_question",
          "public_ip_address",
          "homepage_request",
          "tls_handshake"
        ],
        "recipients": [
          "registry_service",
          "dns_resolver",
          "target_public_service"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The one-shot monitor reads selected local control state and performs only the bounded scheduled review collection.",
          "Its checkpoint and review evidence do not calculate Risk or Opportunity scores."
        ]
      }
    },
    {
      "id": "assurance",
      "summary": "Review domain change, recovery, or retirement plans",
      "description": "Review a versioned domain change, recovery-dependency, or retirement plan.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth assurance [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth assurance domain-assurance.json --json",
      "boundary": "The command is offline and treats every provider label, readiness state, and evidence reference as analyst-authored input. It changes no configuration.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one versioned plan capped at 2 MiB and makes no request or configuration change."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002edomain-assurance.input",
        "whoisleuth\u002edomain-assurance"
      ],
      "inputLimits": [
        "Reads one versioned plan capped at 2 MiB and makes no request or configuration change.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "change-packet",
      "summary": "Build a reviewed change packet offline",
      "description": "Assemble pre-change, post-change, and planning evidence into one integrity-protected packet.",
      "group": "respond",
      "common": false,
      "usage": "whoisleuth change-packet [\u003csource>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth change-packet change-review.json --json",
      "boundary": "Assembly is offline. Readiness reflects only the supplied bounded evidence and does not authorise or perform a domain change.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one versioned packet input capped at 6 MiB and makes no request or configuration change."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002edomain-change-packet.input",
        "whoisleuth\u002edomain-change-packet"
      ],
      "inputLimits": [
        "Reads one versioned packet input capped at 6 MiB and makes no request or configuration change.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial",
          "blocked"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "sharing-review",
      "summary": "Lint an artefact before deliberate sharing",
      "description": "Lint one reviewed artefact against local integrity, marking, recipient, personal-data, and redaction controls.",
      "group": "respond",
      "common": false,
      "usage": "whoisleuth sharing-review [\u003csource>] --marking \u003cclear|green|amber|amber-strict|red> --recipient-scope \u003cpublic|community|organization|named-recipients> --purpose \u003cvalue> [--human-reviewed] [--personal-data-reviewed] [--redactions-confirmed] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth sharing-review packet.json --marking amber --recipient-scope organization --purpose \"Reviewed incident handoff\" --human-reviewed --personal-data-reviewed --redactions-confirmed --json",
      "boundary": "The command is offline and emits only bounded schema/version metadata, no content values, and no raw evidence. Its result is a review aid, not legal advice or recipient authorisation.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one bounded artefact, emits only schema/version metadata and no content values, and performs no transmission."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--marking",
        "--recipient-scope",
        "--purpose",
        "--human-reviewed",
        "--personal-data-reviewed",
        "--redactions-confirmed",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[101], SHARED_COMMAND_OPTIONS[102], SHARED_COMMAND_OPTIONS[103], SHARED_COMMAND_OPTIONS[104], SHARED_COMMAND_OPTIONS[105], SHARED_COMMAND_OPTIONS[106], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.sharing-review"
      ],
      "inputLimits": [
        "Reads one bounded artefact, emits only schema/version metadata and no content values, and performs no transmission.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete",
          "partial",
          "blocked"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "workflow-plan",
      "summary": "Plan a fixed investigation recipe",
      "description": "Build a fixed domain-investigation plan from existing bounded CLI commands.",
      "group": "assure",
      "common": true,
      "usage": "whoisleuth workflow-plan [\u003cdomain-triage|lookalike-review|owned-domain-review|historical-comparison|campaign-review|certificate-anomaly|registry-disagreement|evidence-handoff|planned-domain-change|post-change-verification>] [\u003csubject>] [--list|--explain \u003cexplain>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth workflow-plan domain-triage example.test --json",
      "boundary": "Planning is offline and plan-only. It does not execute commands, expand placeholders, read files, make requests, or submit evidence.",
      "collection": {
        "mode": "offline",
        "scope": "Builds a fixed typed recipe and executes none of its network or file steps."
      },
      "inputs": [
        {
          "name": "recipe",
          "valueKind": "enum",
          "minimum": 0,
          "maximum": 1,
          "values": [
            "domain-triage",
            "lookalike-review",
            "owned-domain-review",
            "historical-comparison",
            "campaign-review",
            "certificate-anomaly",
            "registry-disagreement",
            "evidence-handoff",
            "planned-domain-change",
            "post-change-verification"
          ],
          "inputSource": "argv",
          "requiredWhenOptions": []
        },
        {
          "name": "subject",
          "valueKind": "text",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--list",
        "--explain",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[107], SHARED_COMMAND_OPTIONS[108], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": true,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.investigation-plan",
        "whoisleuth\u002ecli.workflow-recipe-catalogue"
      ],
      "inputLimits": [
        "Builds a fixed typed recipe and executes none of its network or file steps.",
        "recipe: 0-1 enum value",
        "subject: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Plan-only workflow document"
      ],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "workflow-run",
      "summary": "Execute approved fixed-recipe steps",
      "description": "Execute approved steps from a fixed investigation recipe and emit a resumable checkpoint.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth workflow-run \u003cdomain-triage|lookalike-review|owned-domain-review|historical-comparison|campaign-review|certificate-anomaly|registry-disagreement|evidence-handoff|planned-domain-change|post-change-verification> \u003csubject> [--select \u003cvalue>] [--use-artifact \u003cvalue>] [--confirm-review \u003cvalue>] [--approve-network] [--resume \u003cfile>] [--interactive] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth workflow-run domain-triage example.test --approve-network --json --output run.json",
      "boundary": "Only installed recipe commands can run. Network steps require explicit approval for each invocation. New runs connect compatible earlier outputs using the recipe defaults. Use --use-artifact \u003cstep-id>:\u003cinput-number>=\u003cearlier-step-id> to override a connection; input numbers start at 1. Repeat --select for remaining placeholders in order, or supply every input for a step to replace its connections with files. Values stay literal and cannot start with a hyphen or invoke a shell. Optional --interactive prompts on terminal stderr for missing inputs; a blank answer pauses. It grants neither network approval nor human-review confirmation. A step declaring human review still requires --confirm-review \u003cstep-id> for that invocation. Checkpoints do not grant later approvals. Resumes preserve recorded connections. Content digests identify retained output, not authenticity or freshness. Partial collections pause for review and are not recollected on resume; failed validation or export steps remain retryable. Diagnostics go to stderr. File output holds exclusive adjacent locks and refuses concurrently changed state files.",
      "collection": {
        "mode": "network",
        "scope": "Runs only fixed-recipe steps; network collection requires --approve-network and unresolved analyst selections pause."
      },
      "inputs": [
        {
          "name": "recipe",
          "valueKind": "enum",
          "minimum": 1,
          "maximum": 1,
          "values": [
            "domain-triage",
            "lookalike-review",
            "owned-domain-review",
            "historical-comparison",
            "campaign-review",
            "certificate-anomaly",
            "registry-disagreement",
            "evidence-handoff",
            "planned-domain-change",
            "post-change-verification"
          ],
          "inputSource": "argv",
          "requiredWhenOptions": []
        },
        {
          "name": "subject",
          "valueKind": "text",
          "minimum": 1,
          "maximum": 1,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--select",
        "--use-artifact",
        "--confirm-review",
        "--approve-network",
        "--resume",
        "--interactive",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[109], SHARED_COMMAND_OPTIONS[110], SHARED_COMMAND_OPTIONS[111], SHARED_COMMAND_OPTIONS[112], SHARED_COMMAND_OPTIONS[113], SHARED_COMMAND_OPTIONS[114], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "conditional_network",
      "disclosureClass": "bounded_authorised_active",
      "explicitAuthorisationRequired": true,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.investigation-run"
      ],
      "inputLimits": [
        "Runs only fixed-recipe steps; network collection requires --approve-network and unresolved analyst selections pause.",
        "recipe: 1-1 enum value",
        "subject: 1-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Resumable workflow state"
      ],
      "capability": {
        "familyId": "workflow_execution",
        "networkMode": "conditional_bounded_passive",
        "dataSent": [
          "normalised_target",
          "registry_query",
          "whois_query",
          "dns_question",
          "public_ip_address",
          "homepage_request",
          "tls_handshake",
          "mta_sts_policy_request",
          "certificate_search_term"
        ],
        "recipients": [
          "registry_service",
          "dns_resolver",
          "target_public_service",
          "certificate_transparency_service"
        ],
        "authorisation": "explicit_network_approval",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial",
          "blocked"
        ],
        "documentStates": [
          "complete",
          "partial",
          "awaiting_network_approval",
          "awaiting_analyst_selection",
          "awaiting_review_confirmation",
          "step_failed"
        ],
        "privacyLimitations": [
          "Only fixed installed recipe steps can run, and every network invocation requires explicit approval."
        ]
      }
    },
    {
      "id": "diff",
      "summary": "Compare two compatible retained artefacts",
      "description": "Compare an earlier and later artefact from the same retained Lookup, Bulk-session, or domain-portfolio family.",
      "group": "assure",
      "common": true,
      "usage": "whoisleuth diff \u003csources...> [--left-session \u003cvalue>] [--right-session \u003cvalue>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth diff earlier.json later.json --json",
      "boundary": "Comparison is offline: the left input is earlier and the right input is later. Inputs must belong to the same supported family. Saved Lookups can describe the same or different domains; same-domain comparisons preserve observation times and collection uncertainty. For a multi-session Bulk export, --left-session selects a session from the left file and --right-session selects one from the right; missing, unavailable, equal, and different evidence remain separate states.",
      "collection": {
        "mode": "offline",
        "scope": "Reads two compatible retained artefacts capped at 8 MiB each and retains no source paths."
      },
      "inputs": [
        {
          "name": "sources",
          "valueKind": "file",
          "minimum": 2,
          "maximum": 2,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--left-session",
        "--right-session",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[115], SHARED_COMMAND_OPTIONS[116], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.lookup-diff"
      ],
      "inputLimits": [
        "Reads two compatible retained artefacts capped at 8 MiB each and retains no source paths.",
        "sources: 2-2 file values"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Retained-evidence comparison"
      ],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "reconcile",
      "summary": "Reconcile independently labelled observations",
      "description": "Reconcile bounded values across independently labelled observations of one domain.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth reconcile \u003csources...> [--json] [--quiet] [--no-color]",
      "example": "whoisleuth reconcile office.json mobile.json external.json --json",
      "boundary": "The command is offline, accepts 2 to 5 saved observations for one domain, and never treats labels as proof of network independence or majority agreement as truth.",
      "collection": {
        "mode": "offline",
        "scope": "Reads 2 to 5 saved observations for one domain, capped at 32 MiB in total."
      },
      "inputs": [
        {
          "name": "sources",
          "valueKind": "file",
          "minimum": 2,
          "maximum": 5,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.lookup-reconciliation"
      ],
      "inputLimits": [
        "Reads 2 to 5 saved observations for one domain, capped at 32 MiB in total.",
        "sources: 2-5 file values"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "timeline",
      "summary": "Build same-domain history from saved lookups",
      "description": "Build an ordered same-domain history from saved Lookup observations.",
      "group": "assure",
      "common": false,
      "usage": "whoisleuth timeline \u003csources...> [--json] [--quiet] [--no-color]",
      "example": "whoisleuth timeline first.json second.json latest.json --json",
      "boundary": "The command is offline, accepts 2 to 20 bounded inputs for one domain, retains no filenames or raw registry payloads, and does not treat changed collection conditions as a domain change.",
      "collection": {
        "mode": "offline",
        "scope": "Reads 2 to 20 saved observations for one domain, capped at 32 MiB in total."
      },
      "inputs": [
        {
          "name": "sources",
          "valueKind": "file",
          "minimum": 2,
          "maximum": 20,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--json",
        "--quiet",
        "--no-color"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[7], SHARED_COMMAND_OPTIONS[8], SHARED_COMMAND_OPTIONS[9]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.lookup-timeline"
      ],
      "inputLimits": [
        "Reads 2 to 20 saved observations for one domain, capped at 32 MiB in total.",
        "sources: 2-20 file values"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--json",
          "format": "JSON"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Bounded retained-observation timeline"
      ],
      "capability": {
        "familyId": "offline_review",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "local_output",
        "outcomes": [
          "complete",
          "partial"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    },
    {
      "id": "export",
      "summary": "Convert a lookup to an evidence report",
      "description": "Convert one saved lookup into a versioned evidence report.",
      "group": "respond",
      "common": true,
      "usage": "whoisleuth export [\u003csource>] [--markdown|--html] [--compact] [--no-attribution]",
      "example": "whoisleuth export lookup.json --markdown",
      "boundary": "Saved Lookup versions 1 and 2 are capped at 8 MiB and scanned for duplicate keys, the prototype-sensitive __proto__ key, and bounded nesting, key, value, and per-container counts before parsing. Current schema-29 exports preserve evidence-source attribution and limitations; published v2 schemas 27, 28 and exact v1 schema 26 remain readable, while other historical and unreleased shapes are unsupported. Markdown and HTML include a presentation-only generator footer unless --no-attribution is selected; JSON retains bounded generator provenance. Compact output intentionally omits raw registry payloads.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one saved Lookup and writes one bounded report."
      },
      "inputs": [
        {
          "name": "source",
          "valueKind": "file",
          "minimum": 0,
          "maximum": 1,
          "values": [],
          "inputSource": "argv_or_stdin",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--markdown",
        "--html",
        "--compact",
        "--no-attribution"
      ],
      "options": [SHARED_COMMAND_OPTIONS[0], SHARED_COMMAND_OPTIONS[1], SHARED_COMMAND_OPTIONS[2], SHARED_COMMAND_OPTIONS[3], SHARED_COMMAND_OPTIONS[4], SHARED_COMMAND_OPTIONS[5], SHARED_COMMAND_OPTIONS[20], SHARED_COMMAND_OPTIONS[21], SHARED_COMMAND_OPTIONS[117], SHARED_COMMAND_OPTIONS[22]],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002elookup-evidence"
      ],
      "inputLimits": [
        "Reads one saved Lookup and writes one bounded report.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "presentationOptions": [
        {
          "option": "--markdown",
          "format": "Markdown"
        },
        {
          "option": "--html",
          "format": "HTML"
        }
      ],
      "fileOutput": true,
      "primaryEvidenceArtefacts": [
        "Portable evidence report"
      ],
      "capability": {
        "familyId": "portable_evidence",
        "networkMode": "none",
        "dataSent": [
          "none"
        ],
        "recipients": [
          "none"
        ],
        "authorisation": "explicit_action",
        "retention": "local_output_deliberate",
        "export": "deliberate_bounded",
        "outcomes": [
          "complete"
        ],
        "documentStates": [],
        "privacyLimitations": [
          "The command reads only selected bounded local input and makes no network request.",
          "Output remains under the operator's local retention and deletion control."
        ]
      }
    }
  ],
  "workflows": {
    "recipes": [
      {
        "id": "domain-triage",
        "label": "New domain triage",
        "objective": "Collect and preserve separately attributed registration, DNS, HTTP, TLS, page, and network-context evidence.",
        "subjectRequirement": "domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "network",
          "offline"
        ],
        "approvals": [
          "network_disclosure",
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "collect",
            "label": "Collect a Deep lookup",
            "command": "lookup",
            "exampleArguments": [
              "example.test",
              "--deep",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.lookup",
            "completion": "Review source health and limitations before using missing fields."
          },
          {
            "id": "export",
            "label": "Create a portable evidence report",
            "command": "export",
            "exampleArguments": [
              "\u003csaved-lookup.json>"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002elookup-evidence",
            "completion": "Reuse the collected Lookup by default, or select a different reviewed Lookup file."
          },
          {
            "id": "verify",
            "label": "Verify the exported artefact",
            "command": "verify-artifact",
            "exampleArguments": [
              "\u003cevidence.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002eoffline-artifact-verification",
            "completion": "Keep verification distinct from a claim that the observations are correct or current."
          }
        ],
        "limitations": [
          "Collection remains analyst-triggered and source limitations remain explicit.",
          "Disposition, reviewed response actions, monitoring, and closure continue in the saved Case workspace; this CLI recipe does not submit reports."
        ]
      },
      {
        "id": "lookalike-review",
        "label": "Lookalike candidate review",
        "objective": "Generate a bounded candidate queue, collect only the selected scope, and retain a reviewed candidate lookup.",
        "subjectRequirement": "brand_or_domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "offline",
          "network"
        ],
        "approvals": [
          "none",
          "network_disclosure",
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "generate",
            "label": "Generate candidates offline",
            "command": "discover",
            "exampleArguments": [
              "Example Organisation",
              "--preset",
              "all",
              "--json"
            ],
            "mode": "offline",
            "approval": "none",
            "produces": "whoisleuth\u002ecli.discover",
            "completion": "Review mutation families and suppressions before collection."
          },
          {
            "id": "scan",
            "label": "Collect a bounded candidate queue",
            "command": "discover-scan",
            "exampleArguments": [
              "Example Organisation",
              "--fast",
              "--scan-limit",
              "50",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.discovery-scan",
            "completion": "Fast collection is a triage boundary; partial or inconclusive authority evidence remains explicit."
          },
          {
            "id": "inspect",
            "label": "Deep-review one selected candidate",
            "command": "lookup",
            "exampleArguments": [
              "\u003cselected-domain>",
              "--deep",
              "--json"
            ],
            "mode": "network",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.lookup",
            "completion": "Select a candidate deliberately; generation does not prove registration, control, intent, or maliciousness."
          }
        ],
        "limitations": [
          "Candidate generation does not establish registration, control, intent, or maliciousness.",
          "Official-reference collection and page comparison require analyst-selected saved evidence; use page-compare after retaining the reference and candidate observations."
        ]
      },
      {
        "id": "owned-domain-review",
        "label": "Owned domain posture review",
        "objective": "Review current passive posture and compare supplied observations with an analyst-authored control manifest.",
        "subjectRequirement": "domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "network",
          "offline"
        ],
        "approvals": [
          "network_disclosure",
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "posture",
            "label": "Collect bounded DNS posture",
            "command": "posture",
            "exampleArguments": [
              "example.test",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.posture",
            "completion": "Review mail profile and delegation evidence before interpreting missing records."
          },
          {
            "id": "lookup",
            "label": "Collect supporting Deep evidence",
            "command": "lookup",
            "exampleArguments": [
              "example.test",
              "--deep",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.lookup",
            "completion": "Retain separately attributed registration, DNS, TLS, and page observations."
          },
          {
            "id": "manifest",
            "label": "Review the domain control manifest",
            "command": "domain-control",
            "exampleArguments": [
              "\u003creview-input.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002edomain-control-review",
            "completion": "Only complete supplied observations may produce drift."
          }
        ],
        "limitations": [
          "Use only for a domain the analyst owns or is authorised to review."
        ]
      },
      {
        "id": "historical-comparison",
        "label": "Historical observation comparison",
        "objective": "Collect a current observation and compare it with analyst-selected saved observations without merging source states.",
        "subjectRequirement": "domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "network",
          "offline"
        ],
        "approvals": [
          "network_disclosure",
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "current",
            "label": "Collect the current lookup",
            "command": "lookup",
            "exampleArguments": [
              "example.test",
              "--deep",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.lookup",
            "completion": "A current request does not refresh or validate older provider-reported history."
          },
          {
            "id": "diff",
            "label": "Compare two selected observations",
            "command": "diff",
            "exampleArguments": [
              "\u003cprevious.json>",
              "\u003ccurrent.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.lookup-diff",
            "completion": "Equal, different, conflicting, and unavailable evidence remain separate."
          },
          {
            "id": "timeline",
            "label": "Build a bounded local timeline",
            "command": "timeline",
            "exampleArguments": [
              "\u003coldest.json>",
              "\u003cnewer.json>",
              "\u003ccurrent.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.lookup-timeline",
            "completion": "Choose two to twenty same-domain files in chronological scope."
          }
        ],
        "limitations": [
          "A later observation does not retroactively refresh retained evidence."
        ]
      },
      {
        "id": "campaign-review",
        "label": "Campaign candidate review",
        "objective": "Prepare a bounded candidate set, collect a deliberately selected queue, and review retained evidence without asserting campaign attribution.",
        "subjectRequirement": "brand_or_domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "offline",
          "network"
        ],
        "approvals": [
          "none",
          "network_disclosure",
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "prepare",
            "label": "Prepare candidates offline",
            "command": "discover",
            "exampleArguments": [
              "Example Organisation",
              "--preset",
              "all",
              "--json"
            ],
            "mode": "offline",
            "approval": "none",
            "produces": "whoisleuth\u002ecli.discover",
            "completion": "Review mutation families and bounded omissions before selecting a collection scope."
          },
          {
            "id": "collect",
            "label": "Collect the selected candidate queue",
            "command": "discover-scan",
            "exampleArguments": [
              "Example Organisation",
              "--fast",
              "--scan-limit",
              "50",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.discovery-scan",
            "completion": "Treat partial and inconclusive authority results as explicit outcomes."
          },
          {
            "id": "review",
            "label": "Prepare a selected candidate brief",
            "command": "brief",
            "exampleArguments": [
              "\u003csaved-lookup.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.lookup-brief",
            "completion": "Select a saved candidate Lookup; keep any campaign grouping analyst-authored."
          }
        ],
        "limitations": [
          "Grouping candidates is analyst triage and does not prove common ownership, control, infrastructure, or intent."
        ]
      },
      {
        "id": "certificate-anomaly",
        "label": "Certificate anomaly review",
        "objective": "Review bounded certificate observations alongside current source-qualified domain evidence without treating issuance as proof of control or intent.",
        "subjectRequirement": "domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "network",
          "offline"
        ],
        "approvals": [
          "network_disclosure",
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "search",
            "label": "Collect bounded certificate observations",
            "command": "ct-search",
            "exampleArguments": [
              "example.test",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.ct-search",
            "completion": "Review source availability, truncation, and observation timing."
          },
          {
            "id": "intake",
            "label": "Normalise the selected observations",
            "command": "ct-intake",
            "exampleArguments": [
              "\u003ccertificate-events.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002eexternal-findings",
            "completion": "Select a certificate-event batch; a certificate-search report is not interchangeable with that input."
          },
          {
            "id": "corroborate",
            "label": "Collect supporting domain evidence",
            "command": "lookup",
            "exampleArguments": [
              "example.test",
              "--deep",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.lookup",
            "completion": "Compare evidence families without collapsing certificate and registration identities."
          }
        ],
        "limitations": [
          "Certificate observations are separately attributed and do not establish current service control."
        ]
      },
      {
        "id": "registry-disagreement",
        "label": "Registry disagreement review",
        "objective": "Collect separately attributed registration evidence and review conflicting publications without selecting an arbitrary source as truth.",
        "subjectRequirement": "domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "network",
          "offline"
        ],
        "approvals": [
          "network_disclosure",
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "collect",
            "label": "Collect source-qualified registration evidence",
            "command": "lookup",
            "exampleArguments": [
              "example.test",
              "--deep",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.lookup",
            "completion": "Retain RDAP, registrar RDAP, WHOIS, and authority states separately."
          },
          {
            "id": "compare",
            "label": "Compare registry publications offline",
            "command": "compare",
            "exampleArguments": [
              "\u003csaved-lookup.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.compare",
            "completion": "Do not convert conflicting or unavailable publications into equivalence."
          },
          {
            "id": "report",
            "label": "Prepare a target-free source report",
            "command": "source-report",
            "exampleArguments": [
              "\u003csaved-lookup.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002esource-reliability-report",
            "completion": "The report describes source behaviour, not ownership, safety, or legal status."
          }
        ],
        "limitations": [
          "Only authority-aware registration evidence may decide availability; disagreement remains explicit."
        ]
      },
      {
        "id": "evidence-handoff",
        "label": "Reviewed evidence handoff",
        "objective": "Verify, minimise, and package analyst-selected evidence for a deliberate handoff without transmitting or submitting it.",
        "subjectRequirement": "review_label",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "offline"
        ],
        "approvals": [
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "verify",
            "label": "Verify the selected artefact",
            "command": "verify-artifact",
            "exampleArguments": [
              "\u003cevidence.json>",
              "--json",
              "--strict-exit"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002eoffline-artifact-verification",
            "completion": "Verification checks structure and integrity, not the truth or currency of observations."
          },
          {
            "id": "package",
            "label": "Build a reviewed public Case-pack",
            "command": "case-pack",
            "exampleArguments": [
              "\u003ccases.json>",
              "--audience",
              "public",
              "--reviewed",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.case-pack",
            "completion": "Review minimisation and audience projection before retaining the separate package."
          },
          {
            "id": "lint",
            "label": "Review deliberate-sharing metadata",
            "command": "sharing-review",
            "exampleArguments": [
              "\u003cpackage.json>",
              "--marking",
              "clear",
              "--recipient-scope",
              "public",
              "--purpose",
              "reviewed evidence handoff",
              "--human-reviewed",
              "--personal-data-reviewed",
              "--redactions-confirmed",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.sharing-review",
            "completion": "A clear lint result does not send, upload, publish, or authorise the artefact."
          }
        ],
        "limitations": [
          "The recipe prepares local material only; sharing remains a separate deliberate action."
        ]
      },
      {
        "id": "planned-domain-change",
        "label": "Planned domain change",
        "objective": "Review an analyst-authored desired state and prepare bounded change material without changing DNS, registry, mail, or hosted configuration.",
        "subjectRequirement": "domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "offline"
        ],
        "approvals": [
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "control",
            "label": "Review the desired-state manifest",
            "command": "domain-control",
            "exampleArguments": [
              "\u003creview-input.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002edomain-control-review",
            "completion": "Only supplied complete observations may produce drift."
          },
          {
            "id": "assure",
            "label": "Review change and recovery assumptions",
            "command": "assurance",
            "exampleArguments": [
              "\u003cassurance-input.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002edomain-assurance",
            "completion": "Record uncertainty, rollback dependencies, and unavailable evidence explicitly."
          },
          {
            "id": "package",
            "label": "Build a reviewed change packet",
            "command": "change-packet",
            "exampleArguments": [
              "\u003cchange-packet-input.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002edomain-change-packet",
            "completion": "The packet is local reviewed material and performs no submission or enforcement."
          }
        ],
        "limitations": [
          "Planning and packaging never apply, submit, schedule, or enforce a change."
        ]
      },
      {
        "id": "post-change-verification",
        "label": "Post-change verification",
        "objective": "Perform one explicit later observation and compare it with analyst-selected retained evidence after an authorised change.",
        "subjectRequirement": "domain",
        "runnableByWorkflowRun": true,
        "networkModes": [
          "network",
          "offline"
        ],
        "approvals": [
          "network_disclosure",
          "analyst_selection"
        ],
        "steps": [
          {
            "id": "recheck",
            "label": "Run one bounded retained-manifest review",
            "command": "monitor-once",
            "exampleArguments": [
              "\u003cmanifest.json>",
              "--limit",
              "1",
              "--json"
            ],
            "mode": "network",
            "approval": "network_disclosure",
            "produces": "whoisleuth\u002ecli.domain-control-monitor",
            "completion": "One later observation may remain partial, unavailable, stale, or conflicting."
          },
          {
            "id": "compare",
            "label": "Compare selected before and after evidence",
            "command": "diff",
            "exampleArguments": [
              "\u003cbefore.json>",
              "\u003cafter.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.lookup-diff",
            "completion": "Materiality is derived from compatible retained evidence and does not infer intent."
          },
          {
            "id": "record",
            "label": "Record reviewed completion material",
            "command": "change-packet",
            "exampleArguments": [
              "\u003cpost-change-input.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002edomain-change-packet",
            "completion": "Recording reviewed material does not submit it or start automatic monitoring."
          }
        ],
        "limitations": [
          "This is a one-time recheck, not monitoring setup or proof that every resolver or service has converged."
        ]
      }
    ],
    "limitations": [
      "Catalogue and explanation modes are fixed metadata. They make no request, read no evidence file, and execute no step.",
      "workflow-run remains limited to recipes explicitly marked runnable by the installed registry."
    ]
  },
  "limitations": [
    "This browser catalogue is fixed generated metadata. Searching, filtering, or opening a command makes no request and reads no local evidence.",
    "Collection and runtime availability are evaluated only after a deliberate installed CLI invocation."
  ]
} as const;
