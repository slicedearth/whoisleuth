// Generated from canonical runtime-neutral metadata. Do not edit by hand.
import type { CliCommandGrammar } from '../../../../packages/contracts/cli-grammar.mts';
const SHARED_OPTIONS = [
  {
    "option": "--help",
    "scope": "common",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": "help"
  },
  {
    "option": "--output",
    "scope": "common",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--force",
    "scope": "common",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--config",
    "scope": "common",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--profile",
    "scope": "common",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--palette",
    "scope": "common",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "auto",
      "light",
      "dark"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--network",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--json",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--quiet",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "idempotent",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--no-color",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "idempotent",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--common",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--group",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "investigate",
      "respond",
      "assure",
      "utilities"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--mode",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "offline",
      "network"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--workflow",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--configuration-digest",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--package",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--bagit",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--passphrase-file",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--folder",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--junit",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--markdown",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--html",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--no-attribution",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--fast",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--deep",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--exact-url",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--observer",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--vantage",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--plan",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--summary",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--verbose",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--browse",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--save-lookup",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--strict-exit",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--fail-on",
    "scope": "command",
    "arity": 1,
    "valueKind": "policy_list",
    "values": [
      "source-failure",
      "inconclusive",
      "danger"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--events",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--jsonl",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--csv",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--csv-with-metadata",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--domains",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--queries",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--registered-only",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--inconclusive-only",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--errors-only",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--concurrency",
    "scope": "command",
    "arity": 1,
    "valueKind": "integer",
    "values": [],
    "integerRanges": [
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
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--checkpoint",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--resume",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--tlds",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--preset",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "common",
      "impersonation",
      "all"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--families",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--keyboard",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "qwerty",
      "azerty",
      "qwertz",
      "all"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--dictionary",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--snapshot",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--scan-limit",
    "scope": "command",
    "arity": 1,
    "valueKind": "integer",
    "values": [],
    "integerRanges": [
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
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--chunk-size",
    "scope": "command",
    "arity": 1,
    "valueKind": "integer",
    "values": [],
    "integerRanges": [
      {
        "minimum": 1,
        "maximum": 100,
        "whenOptionPresent": null
      }
    ],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--resolver",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--allowlist",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--observation-snapshot",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--acquisition-only",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--suppressed-only",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--selectors",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--retired-selectors",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--mail-profile",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "standard",
      "defensive-no-mail",
      "parked"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--include-inherited-dns",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--sarif",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--owned-domain",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--trust-anchor",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--owned-or-authorized",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--active-probe",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--profile",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--suffix",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--scenario",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "registered",
      "not_found",
      "inconclusive"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--summary-json",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--manifest",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--manifest-entry",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
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
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--search",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--require-match",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--reveal",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--expect-content-digest",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--private-key-file",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--public-key-file",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--trust-store-file",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--trusted-auth-header",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "repeatable",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--reported-action",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "opened_link",
      "entered_password",
      "approved_signin",
      "granted_consent",
      "entered_device_code",
      "executed_command"
    ],
    "integerRanges": [],
    "occurrence": "repeatable",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--mmdb",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--case-id",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--domain",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--title",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--new-incident",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--text",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--note-file",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--input",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--expect-file-digest",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--audience",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "internal",
      "trusted",
      "public"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--reviewed",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--previous",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--limit",
    "scope": "command",
    "arity": 1,
    "valueKind": "integer",
    "values": [],
    "integerRanges": [
      {
        "minimum": 1,
        "maximum": 20,
        "whenOptionPresent": null
      }
    ],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--concurrency",
    "scope": "command",
    "arity": 1,
    "valueKind": "integer",
    "values": [],
    "integerRanges": [
      {
        "minimum": 1,
        "maximum": 3,
        "whenOptionPresent": null
      }
    ],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--fail-on",
    "scope": "command",
    "arity": 1,
    "valueKind": "policy_list",
    "values": [
      "source-failure",
      "inconclusive",
      "material-drift"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--marking",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "clear",
      "green",
      "amber",
      "amber-strict",
      "red"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--recipient-scope",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
    "values": [
      "public",
      "community",
      "organization",
      "named-recipients"
    ],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--purpose",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--human-reviewed",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "idempotent",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--personal-data-reviewed",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "idempotent",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--redactions-confirmed",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "idempotent",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--list",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--explain",
    "scope": "command",
    "arity": 1,
    "valueKind": "enum",
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
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--select",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "repeatable",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--use-artifact",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "repeatable",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--confirm-review",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "repeatable",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--approve-network",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--resume",
    "scope": "command",
    "arity": 1,
    "valueKind": "file",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--interactive",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--preview",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  },
  {
    "option": "--left-session",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--right-session",
    "scope": "command",
    "arity": 1,
    "valueKind": "text",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": true,
    "metaAction": null
  },
  {
    "option": "--compact",
    "scope": "command",
    "arity": 0,
    "valueKind": "flag",
    "values": [],
    "integerRanges": [],
    "occurrence": "once",
    "acceptsOptionLikeValue": false,
    "metaAction": null
  }
] as const;
export const PUBLIC_CLI_GRAMMAR = {
"completion": {
  "parserKey": "completion",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"doctor": {
  "parserKey": "doctor",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[6], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [],
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"commands": {
  "parserKey": "commands",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[10], SHARED_OPTIONS[11], SHARED_OPTIONS[12], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [],
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"manual": {
  "parserKey": "manual",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5]],
  "positionals": [],
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"manifest": {
  "parserKey": "manifest",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[13], SHARED_OPTIONS[14], SHARED_OPTIONS[15], SHARED_OPTIONS[16], SHARED_OPTIONS[17], SHARED_OPTIONS[18], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "required",
      "options": [
        "--workflow"
      ]
    },
    {
      "kind": "requires_any",
      "option": "--bagit",
      "requiredOptions": [
        "--package",
        "--folder"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--bagit",
      "excludedOptions": [
        "--passphrase-file"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--package",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--passphrase-file",
      "requiredOptions": [
        "--package"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--package",
        "--json"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--folder",
      "excludedOptions": [
        "--package",
        "--output",
        "--force"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"map-observations": {
  "parserKey": "map-observations",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"oam-export": {
  "parserKey": "oam-export",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"lookup": {
  "parserKey": "lookup",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[19], SHARED_OPTIONS[20], SHARED_OPTIONS[21], SHARED_OPTIONS[22], SHARED_OPTIONS[23], SHARED_OPTIONS[24], SHARED_OPTIONS[25], SHARED_OPTIONS[26], SHARED_OPTIONS[27], SHARED_OPTIONS[28], SHARED_OPTIONS[29], SHARED_OPTIONS[30], SHARED_OPTIONS[31], SHARED_OPTIONS[32], SHARED_OPTIONS[33], SHARED_OPTIONS[34], SHARED_OPTIONS[35], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json",
        "--junit",
        "--markdown",
        "--html"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--events",
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--browse",
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--json",
        "--junit",
        "--markdown",
        "--html"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--fast",
        "--deep"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--summary",
        "--verbose"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--save-lookup",
      "requiredOptions": [
        "--browse"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--exact-url",
      "requiredOptions": [
        "--deep"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--summary",
      "excludedOptions": [
        "--json",
        "--junit",
        "--markdown",
        "--html"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--verbose",
      "excludedOptions": [
        "--json",
        "--junit",
        "--markdown",
        "--html"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--browse",
      "excludedOptions": [
        "--json",
        "--junit",
        "--markdown",
        "--html",
        "--summary",
        "--verbose",
        "--events",
        "--plan",
        "--quiet"
      ]
    },
    {
      "kind": "requires_any",
      "option": "--no-attribution",
      "requiredOptions": [
        "--markdown",
        "--html"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--plan",
      "excludedOptions": [
        "--junit",
        "--markdown",
        "--html",
        "--summary",
        "--verbose",
        "--strict-exit",
        "--events",
        "--quiet",
        "--fail-on"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"bulk": {
  "parserKey": "bulk",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[36], SHARED_OPTIONS[19], SHARED_OPTIONS[37], SHARED_OPTIONS[38], SHARED_OPTIONS[39], SHARED_OPTIONS[40], SHARED_OPTIONS[41], SHARED_OPTIONS[42], SHARED_OPTIONS[43], SHARED_OPTIONS[23], SHARED_OPTIONS[24], SHARED_OPTIONS[44], SHARED_OPTIONS[45], SHARED_OPTIONS[46], SHARED_OPTIONS[35], SHARED_OPTIONS[28], SHARED_OPTIONS[34], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json",
        "--jsonl",
        "--junit",
        "--csv",
        "--csv-with-metadata",
        "--domains",
        "--queries"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--events",
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--json",
        "--jsonl",
        "--junit",
        "--csv",
        "--csv-with-metadata",
        "--domains",
        "--queries"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--registered-only",
        "--inconclusive-only",
        "--errors-only"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--fast",
        "--deep"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--resume",
      "requiredOptions": [
        "--checkpoint"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--plan",
      "excludedOptions": [
        "--jsonl",
        "--junit",
        "--csv",
        "--csv-with-metadata",
        "--domains",
        "--queries",
        "--events",
        "--checkpoint",
        "--resume",
        "--quiet",
        "--fail-on"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"ct-search": {
  "parserKey": "ct-search",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"ct-intake": {
  "parserKey": "ct-intake",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"discover": {
  "parserKey": "discover",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[47], SHARED_OPTIONS[48], SHARED_OPTIONS[49], SHARED_OPTIONS[50], SHARED_OPTIONS[51], SHARED_OPTIONS[52], SHARED_OPTIONS[7], SHARED_OPTIONS[36], SHARED_OPTIONS[39], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json",
        "--jsonl",
        "--domains"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--json",
        "--jsonl",
        "--domains"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--preset",
        "--families"
      ]
    },
    {
      "kind": "value_excludes",
      "option": "--preset",
      "value": "common",
      "excludedOptions": [
        "--dictionary"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"discover-scan": {
  "parserKey": "discover-scan",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[47], SHARED_OPTIONS[48], SHARED_OPTIONS[49], SHARED_OPTIONS[50], SHARED_OPTIONS[51], SHARED_OPTIONS[23], SHARED_OPTIONS[24], SHARED_OPTIONS[53], SHARED_OPTIONS[54], SHARED_OPTIONS[44], SHARED_OPTIONS[55], SHARED_OPTIONS[56], SHARED_OPTIONS[45], SHARED_OPTIONS[46], SHARED_OPTIONS[57], SHARED_OPTIONS[41], SHARED_OPTIONS[42], SHARED_OPTIONS[58], SHARED_OPTIONS[59], SHARED_OPTIONS[35], SHARED_OPTIONS[28], SHARED_OPTIONS[34], SHARED_OPTIONS[7], SHARED_OPTIONS[36], SHARED_OPTIONS[37], SHARED_OPTIONS[38], SHARED_OPTIONS[39], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json",
        "--jsonl",
        "--csv",
        "--csv-with-metadata",
        "--domains"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--events",
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--json",
        "--jsonl",
        "--csv",
        "--csv-with-metadata",
        "--domains"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--preset",
        "--families"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--fast",
        "--deep"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--registered-only",
        "--inconclusive-only",
        "--acquisition-only",
        "--suppressed-only"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--resume",
      "requiredOptions": [
        "--checkpoint"
      ]
    },
    {
      "kind": "value_excludes",
      "option": "--preset",
      "value": "common",
      "excludedOptions": [
        "--dictionary"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--plan",
      "excludedOptions": [
        "--jsonl",
        "--csv",
        "--csv-with-metadata",
        "--domains",
        "--events",
        "--checkpoint",
        "--resume",
        "--observation-snapshot",
        "--quiet",
        "--fail-on"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"posture": {
  "parserKey": "posture",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[60], SHARED_OPTIONS[61], SHARED_OPTIONS[62], SHARED_OPTIONS[63], SHARED_OPTIONS[7], SHARED_OPTIONS[64], SHARED_OPTIONS[65], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json",
        "--sarif"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--json",
        "--sarif"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--sarif",
      "requiredOptions": [
        "--owned-domain"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"http": {
  "parserKey": "http",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"tls": {
  "parserKey": "tls",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"dnssec-validate": {
  "parserKey": "dnssec-validate",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[55], SHARED_OPTIONS[66], SHARED_OPTIONS[67], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "required",
      "options": [
        "--resolver",
        "--trust-anchor",
        "--owned-or-authorized"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"mail-transport": {
  "parserKey": "mail-transport",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[55], SHARED_OPTIONS[66], SHARED_OPTIONS[67], SHARED_OPTIONS[68], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "required",
      "options": [
        "--resolver",
        "--trust-anchor",
        "--owned-or-authorized",
        "--active-probe"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"registry-support": {
  "parserKey": "registry-support",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"registry-doctor": {
  "parserKey": "registry-doctor",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"registry-cohort": {
  "parserKey": "registry-cohort",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"registry-scaffold": {
  "parserKey": "registry-scaffold",
  "bootstrapProfile": "command_owned",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[5], SHARED_OPTIONS[69], SHARED_OPTIONS[70], SHARED_OPTIONS[71]],
  "positionals": [],
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "required",
      "options": [
        "--profile",
        "--suffix",
        "--scenario"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"risk-calibrate": {
  "parserKey": "risk-calibrate",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[72], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json",
        "--summary-json"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--json",
        "--summary-json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"lookalike-calibrate": {
  "parserKey": "lookalike-calibrate",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"verify-artifact": {
  "parserKey": "verify-artifact",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[17], SHARED_OPTIONS[73], SHARED_OPTIONS[74], SHARED_OPTIONS[15], SHARED_OPTIONS[16], SHARED_OPTIONS[18], SHARED_OPTIONS[7], SHARED_OPTIONS[33], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "requires_any",
      "option": "--bagit",
      "requiredOptions": [
        "--package",
        "--folder"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--bagit",
      "excludedOptions": [
        "--passphrase-file",
        "--manifest",
        "--manifest-entry"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--manifest",
      "requiredOptions": [
        "--manifest-entry"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--manifest-entry",
      "requiredOptions": [
        "--manifest"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--package",
      "excludedOptions": [
        "--manifest",
        "--manifest-entry"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--folder",
      "excludedOptions": [
        "--package",
        "--manifest",
        "--manifest-entry",
        "--passphrase-file"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"interchange-report": {
  "parserKey": "interchange-report",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[17], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"inspect-archive": {
  "parserKey": "inspect-archive",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[17], SHARED_OPTIONS[75], SHARED_OPTIONS[76], SHARED_OPTIONS[77], SHARED_OPTIONS[78], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--reveal",
      "requiredOptions": [
        "--search"
      ]
    },
    {
      "kind": "requires_all",
      "option": "--require-match",
      "requiredOptions": [
        "--search"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"sign-artifact": {
  "parserKey": "sign-artifact",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[79]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "required",
      "options": [
        "--private-key-file"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"verify-signature": {
  "parserKey": "verify-signature",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[80], SHARED_OPTIONS[81], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"source-report": {
  "parserKey": "source-report",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"compare": {
  "parserKey": "compare",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"page-compare": {
  "parserKey": "page-compare",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"mail-review": {
  "parserKey": "mail-review",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"mail-headers": {
  "parserKey": "mail-headers",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[82], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"intake": {
  "parserKey": "intake",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[83], SHARED_OPTIONS[82], SHARED_OPTIONS[33], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
    {
      "name": "kind",
      "valueKind": "enum",
      "minimum": 1,
      "maximum": 1,
      "values": [
        "text",
        "email",
        "calendar",
        "qr",
        "pdf",
        "docx",
        "har",
        "identity"
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"review-evidence": {
  "parserKey": "review-evidence",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[84], SHARED_OPTIONS[7], SHARED_OPTIONS[33], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"brief": {
  "parserKey": "brief",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"case": {
  "parserKey": "case",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[85], SHARED_OPTIONS[86], SHARED_OPTIONS[87], SHARED_OPTIONS[88], SHARED_OPTIONS[89], SHARED_OPTIONS[90], SHARED_OPTIONS[91], SHARED_OPTIONS[92], SHARED_OPTIONS[7], SHARED_OPTIONS[9]],
  "positionals": [
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
        "link",
        "withdraw-link",
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--text",
        "--note-file"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"case-pack": {
  "parserKey": "case-pack",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[93], SHARED_OPTIONS[94], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "required",
      "options": [
        "--audience",
        "--reviewed"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"domain-control": {
  "parserKey": "domain-control",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"monitor-once": {
  "parserKey": "monitor-once",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[95], SHARED_OPTIONS[96], SHARED_OPTIONS[97], SHARED_OPTIONS[98], SHARED_OPTIONS[7], SHARED_OPTIONS[19], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json",
        "--junit"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--json",
        "--junit"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"assurance": {
  "parserKey": "assurance",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"change-packet": {
  "parserKey": "change-packet",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"sharing-review": {
  "parserKey": "sharing-review",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[99], SHARED_OPTIONS[100], SHARED_OPTIONS[101], SHARED_OPTIONS[102], SHARED_OPTIONS[103], SHARED_OPTIONS[104], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "required",
      "options": [
        "--marking",
        "--recipient-scope",
        "--purpose"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"workflow-plan": {
  "parserKey": "workflow-plan",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[105], SHARED_OPTIONS[106], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--list",
        "--explain"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"workflow-run": {
  "parserKey": "workflow-run",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[107], SHARED_OPTIONS[108], SHARED_OPTIONS[109], SHARED_OPTIONS[110], SHARED_OPTIONS[111], SHARED_OPTIONS[112], SHARED_OPTIONS[113], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--preview",
      "excludedOptions": [
        "--approve-network",
        "--confirm-review",
        "--interactive",
        "--output",
        "--force",
        "--quiet"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"diff": {
  "parserKey": "diff",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[114], SHARED_OPTIONS[115], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"reconcile": {
  "parserKey": "reconcile",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"timeline": {
  "parserKey": "timeline",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[7], SHARED_OPTIONS[8], SHARED_OPTIONS[9]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--quiet",
        "--output"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--quiet",
      "excludedOptions": [
        "--json"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
},
"export": {
  "parserKey": "export",
  "bootstrapProfile": "allowed",
  "options": [SHARED_OPTIONS[0], SHARED_OPTIONS[1], SHARED_OPTIONS[2], SHARED_OPTIONS[3], SHARED_OPTIONS[4], SHARED_OPTIONS[5], SHARED_OPTIONS[20], SHARED_OPTIONS[21], SHARED_OPTIONS[116], SHARED_OPTIONS[22]],
  "positionals": [
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
  "constraints": [
    {
      "kind": "requires_all",
      "option": "--force",
      "requiredOptions": [
        "--output"
      ]
    },
    {
      "kind": "mutually_exclusive",
      "options": [
        "--markdown",
        "--html"
      ]
    },
    {
      "kind": "excludes_all",
      "option": "--compact",
      "excludedOptions": [
        "--markdown",
        "--html"
      ]
    },
    {
      "kind": "requires_any",
      "option": "--no-attribution",
      "requiredOptions": [
        "--markdown",
        "--html"
      ]
    }
  ],
  "metaActions": [
    "help"
  ]
}
} as const satisfies Readonly<Record<string, CliCommandGrammar>>;
