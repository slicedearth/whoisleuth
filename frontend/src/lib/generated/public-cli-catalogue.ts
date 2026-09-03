// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_CLI_CATALOGUE = {
  "commandCount": 47,
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
      "outputFormats": [
        "terminal"
      ],
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "utilities",
      "common": true,
      "usage": "whoisleuth commands [--common] [--group \u003cgroup>] [--mode \u003coffline|network>] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "outputFormats": [
        "terminal"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth manifest \u003cartefact.json> [...] --workflow \u003clabel> [--configuration-digest \u003csha256:digest>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth manifest lookup.json comparison.json --workflow \"domain review\" --json",
      "boundary": "The command records hashes and bounded schema metadata only. It omits source paths and artefact contents and performs no network collection.",
      "collection": {
        "mode": "offline",
        "scope": "Reads 1 to 16 local JSON artefacts capped at 32 MiB in total and retains no source paths."
      },
      "inputs": [
        {
          "name": "artefacts",
          "valueKind": "file",
          "minimum": 1,
          "maximum": 16,
          "values": [],
          "inputSource": "argv",
          "requiredWhenOptions": []
        }
      ],
      "importantOptions": [
        "--workflow",
        "--configuration-digest",
        "--json",
        "--quiet",
        "--no-color"
      ],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002einvestigation-manifest"
      ],
      "inputLimits": [
        "Reads 1 to 16 local JSON artefacts capped at 32 MiB in total and retains no source paths.",
        "artefacts: 1-16 file values"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "respond",
      "common": false,
      "usage": "whoisleuth map-observations [mapping.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "respond",
      "common": false,
      "usage": "whoisleuth oam-export [external-findings.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth lookup [domain|IP|ASN] [--json|--junit|--markdown|--html] [--no-attribution] [--fast|--deep] [--observer \u003clabel>] [--vantage \u003clabel>] [--plan] [--summary|--verbose|--browse [--save-lookup \u003cfile>]] [--palette \u003cauto|light|dark>] [--strict-exit] [--fail-on \u003cpolicies>] [--events] [--quiet] [--no-color]",
      "example": "whoisleuth lookup example.test --deep --browse",
      "boundary": "Fast is the default. An ICANN-recognised public domain, reserved documentation domain, IP, or ASN may occupy command position as shorthand; it delegates to this same parser and URL-like input requires the explicit lookup command. Deep mode adds bounded WHOIS, DNS, HTTP, TLS, technology, posture, and network context where applicable. A full Deep homepage observation can derive fixed publication and delivery/cache summaries from the same response without retaining raw metadata values or making another request. --browse opens before collection, shows aggregate Fast progress or independently settled planned Deep sources, and then navigates allowlisted retained fields in the completed document. Press ? for help and / to search rendered panel text only. Closing during collection cancels without a partial document. --save-lookup writes the exact completed private JSON only after a normal browser close; it can contain normalised evidence omitted from panels and refuses an existing path.",
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
      "outputFormats": [
        "terminal",
        "JSON",
        "JUnit XML",
        "Markdown",
        "HTML"
      ],
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
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth bulk [file] [--json|--jsonl|--junit|--csv|--domains|--queries] [--registered-only|--inconclusive-only|--errors-only] [--fast|--deep] [--concurrency \u003c1-8>] [--checkpoint \u003cfile> [--resume]] [--events] [--plan] [--fail-on \u003cpolicies>] [--quiet] [--no-color]",
      "example": "cat domains.txt | whoisleuth bulk --jsonl",
      "boundary": "Fast and deep jobs use separate concurrency ceilings. Filters affect output only; collection failures and inconclusive authority states remain explicit in JSON, JSONL, and CSV.",
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
      "outputFormats": [
        "terminal",
        "JSON",
        "JSON Lines",
        "JUnit XML",
        "CSV",
        "domain list",
        "query list"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth ct-search [keyword] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth ct-intake [events.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth discover [brand|domain] [--tlds \u003clist>] [--preset \u003cname>|--families \u003cids>] [--keyboard \u003clayout>] [--dictionary \u003cfile>] [--snapshot \u003cfile>] [--json|--jsonl|--domains] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON",
        "JSON Lines",
        "domain list"
      ],
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
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth discover-scan [brand|domain] [--tlds \u003clist>] [--preset \u003cname>|--families \u003cids>] [--keyboard \u003clayout>] [--dictionary \u003cfile>] [--fast|--deep] [--scan-limit \u003cn>] [--chunk-size \u003cn>] [--concurrency \u003cn>] [--resolver \u003cIPs>] [--allowlist \u003cfile>] [--checkpoint \u003cfile> [--resume]] [--observation-snapshot \u003cfile>] [--registered-only|--inconclusive-only|--acquisition-only|--suppressed-only] [--events] [--json|--jsonl|--csv|--domains] [--plan] [--fail-on \u003cpolicies>] [--quiet] [--no-color]",
      "example": "whoisleuth discover-scan example.test --scan-limit 50 --checkpoint scan.json --json",
      "boundary": "This command performs network collection. Fast compact lookup is the default; deep mode is capped at 50 candidates. Allowlisting changes review priority only and shared infrastructure remains a lead, not attribution.",
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
        "--domains",
        "--quiet",
        "--no-color"
      ],
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
      "outputFormats": [
        "terminal",
        "JSON",
        "JSON Lines",
        "CSV",
        "domain list"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth posture [domain] [--selectors \u003clist>] [--retired-selectors \u003clist>] [--mail-profile \u003cprofile>] [--json|--sarif --owned-domain] [--quiet] [--no-color]",
      "example": "whoisleuth posture example.test --mail-profile standard --json",
      "boundary": "Missing or failed DNS observations remain inconclusive and are not reported as absent controls.",
      "collection": {
        "mode": "network",
        "scope": "Accepts one domain and performs bounded RDAP, DNS, and conditional MTA-STS HTTPS requests."
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
        "--json",
        "--sarif",
        "--owned-domain",
        "--quiet",
        "--no-color"
      ],
      "networkEffect": "always_network",
      "disclosureClass": "bounded_passive",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.posture"
      ],
      "inputLimits": [
        "Accepts one domain and performs bounded RDAP, DNS, and conditional MTA-STS HTTPS requests.",
        "domain: 0-1 text value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "outputFormats": [
        "terminal",
        "JSON",
        "SARIF"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth http [domain] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth tls [hostname] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth dnssec-validate \u003cdomain> --resolver \u003cpublic-IP> --trust-anchor \u003canchor.json> --owned-or-authorized [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth mail-transport [input.json] --resolver \u003cpublic-IP> --trust-anchor \u003canchor.json> --owned-or-authorized --active-probe [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth registry-support [domain|suffix] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth registry-doctor [lookup.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth registry-cohort [lookups-or-reports.json|jsonl] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "utilities",
      "common": false,
      "usage": "whoisleuth registry-scaffold --profile \u003cid> --suffix \u003csuffix> --scenario \u003cregistered|not_found|inconclusive>",
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
      "outputFormats": [
        "terminal"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth risk-calibrate [dataset.json] [--json|--summary-json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON",
        "summary JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth lookalike-calibrate [dataset.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": true,
      "usage": "whoisleuth verify-artifact [artifact.json] [--passphrase-file \u003cfile>] [--manifest \u003cmanifest.json> --manifest-entry \u003cartifact-N>] [--json] [--strict-exit] [--quiet] [--no-color]",
      "example": "whoisleuth verify-artifact report.json --manifest manifest.json --manifest-entry artifact-2 --json --strict-exit",
      "boundary": "Verification is offline and redacted. Encrypted archives require an explicitly supplied passphrase file; --strict-exit returns 4 when only an envelope or legacy projection integrity was verified.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected bounded artefact and, when explicitly supplied, one manifest whose selected entry is compared by exact bytes and canonical identity."
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
        "--manifest",
        "--manifest-entry",
        "--json",
        "--strict-exit",
        "--quiet",
        "--no-color"
      ],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002eoffline-artifact-verification"
      ],
      "inputLimits": [
        "Reads one selected bounded artefact and, when explicitly supplied, one manifest whose selected entry is compared by exact bytes and canonical identity.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth interchange-report [artifact.json] [--passphrase-file \u003cfile>] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth inspect-archive [archive.json] [--passphrase-file \u003cfile>] [--search \u003cvalue>] [--require-match] [--reveal] [--expect-content-digest \u003csha256:digest>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth inspect-archive workspace.json --search example.test --json",
      "boundary": "Exact matches require --reveal. Retired and future archive versions are rejected without changing data. The archive is read locally and is never uploaded.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected bounded workspace archive v7, retains exact v5 and v6 compatibility, and redacts output by default."
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
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002eworkspace-archive-inspection"
      ],
      "inputLimits": [
        "Reads one selected bounded workspace archive v7, retains exact v5 and v6 compatibility, and redacts output by default.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth sign-artifact [artifact.json] --private-key-file \u003cfile>",
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
      "outputFormats": [
        "terminal"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth verify-signature [package.json] [--public-key-file \u003cfile>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth verify-signature packet.signed.json --json",
      "boundary": "A valid signature proves package consistency for the embedded key. It does not upgrade failed or unsupported embedded-artefact assurance or establish the holder's real-world identity or authority.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one selected signed package and optional local public key."
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
        "--json",
        "--quiet",
        "--no-color"
      ],
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002eevidence-signature-verification"
      ],
      "inputLimits": [
        "Reads one selected signed package and optional local public key.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth source-report [lookup.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth compare [lookup.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth page-compare \u003cleft.json> \u003cright.json> [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth mail-review [bulk.json|bulk.jsonl] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": true,
      "usage": "whoisleuth review-evidence [evidence.json] [--mmdb \u003cdatabase-file>] [--json] [--strict-exit] [--quiet] [--no-color]",
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
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": true,
      "supportedSchemaIdentifiers": [
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "investigate",
      "common": false,
      "usage": "whoisleuth brief [lookup.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "id": "case-pack",
      "summary": "Build a reviewed case package",
      "group": "respond",
      "common": true,
      "usage": "whoisleuth case-pack [cases.json] --audience \u003cinternal|trusted|public> --reviewed [--json] [--quiet] [--no-color]",
      "example": "whoisleuth case-pack cases.json --audience trusted --reviewed --json",
      "boundary": "The command is an offline handoff from the browser Case workflow: it creates a new package, never creates or mutates a durable Case, never mutates the source archive, and requires an explicit review acknowledgement.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one bounded Case-schema-14 browser export and writes a separate audience-specific Case-pack v2."
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
        "Reads one bounded Case-schema-14 browser export and writes a separate audience-specific Case-pack v2.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth domain-control [manifest-input.json|review-input.json] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth domain-control domain-control-input.json --json",
      "boundary": "The command is offline and changes no registrar, DNS, mail, or certificate configuration. Only complete supplied observations can produce drift.",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth monitor-once [manifest.json] [--previous \u003csnapshot.json>] [--limit \u003c1-20>] [--concurrency \u003c1-3>] [--fail-on \u003cpolicies>] [--json|--junit] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON",
        "JUnit XML"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth assurance [assurance-input.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "respond",
      "common": false,
      "usage": "whoisleuth change-packet [change-packet-input.json] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "respond",
      "common": false,
      "usage": "whoisleuth sharing-review [artifact.json] --marking \u003clevel> --recipient-scope \u003cscope> --purpose \u003ctext> [--human-reviewed] [--personal-data-reviewed] [--redactions-confirmed] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth sharing-review packet.json --marking amber --recipient-scope organization --purpose \"Reviewed incident handoff\" --human-reviewed --personal-data-reviewed --redactions-confirmed --json",
      "boundary": "The command is offline and emits only bounded schema/version metadata, no content values, and no raw evidence. Its result is a review aid, not legal advice or recipient authorisation.",
      "collection": {
        "mode": "offline",
        "scope": "Reads one artefact capped at 15 MiB, emits only bounded schema/version metadata and no content values, and performs no transmission."
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
      "networkEffect": "offline",
      "disclosureClass": "none",
      "explicitAuthorisationRequired": false,
      "planSupport": false,
      "failurePolicySupport": false,
      "supportedSchemaIdentifiers": [
        "whoisleuth\u002ecli.sharing-review"
      ],
      "inputLimits": [
        "Reads one artefact capped at 15 MiB, emits only bounded schema/version metadata and no content values, and performs no transmission.",
        "source: 0-1 file value"
      ],
      "outputLimits": [
        "Output is bounded by the command-owned formatter and document contract.",
        "Selected file output is atomic and replacement requires --force."
      ],
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": true,
      "usage": "whoisleuth workflow-plan \u003crecipe> \u003cdomain|brand> | --list | --explain \u003crecipe> [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth workflow-run \u003crecipe> \u003cdomain|brand> [--select \u003cstep-id>=\u003cpath-or-value>]... [--approve-network] [--resume \u003cstate.json>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth workflow-run domain-triage example.test --resume run.json --select export=saved-lookup.json --json --output run-next.json",
      "boundary": "Only installed recipe commands can run. Network steps require explicit approval for each invocation. Repeat --select in placeholder order for one step; each bounded value replaces one exact placeholder and cannot start with a hyphen, become an option, or invoke a shell.",
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
            "historical-comparison"
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
        "--approve-network",
        "--resume",
        "--json",
        "--quiet",
        "--no-color"
      ],
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
          "mta_sts_policy_request"
        ],
        "recipients": [
          "registry_service",
          "dns_resolver",
          "target_public_service"
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
          "awaiting_network_approval",
          "awaiting_analyst_selection",
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
      "group": "assure",
      "common": true,
      "usage": "whoisleuth diff \u003cleft.json> \u003cright.json> [--left-session \u003cid> --right-session \u003cid>] [--json] [--quiet] [--no-color]",
      "example": "whoisleuth diff earlier.json later.json --json",
      "boundary": "Comparison is offline: the left input is earlier and the right input is later. Inputs must belong to the same supported family. For a multi-session Bulk export, --left-session selects a session from the left file and --right-session selects one from the right; missing, unavailable, equal, and different evidence remain separate states.",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth reconcile \u003cobservation.json> \u003cobservation.json> [...] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "assure",
      "common": false,
      "usage": "whoisleuth timeline \u003cobservation.json> \u003cobservation.json> [...] [--json] [--quiet] [--no-color]",
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
      "outputFormats": [
        "terminal",
        "JSON"
      ],
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
      "group": "respond",
      "common": true,
      "usage": "whoisleuth export [lookup.json] [--markdown|--html|--compact] [--no-attribution]",
      "example": "whoisleuth export lookup.json --markdown",
      "boundary": "Saved Lookup versions 1 and 2 are capped at 8 MiB and scanned for duplicate keys, the prototype-sensitive __proto__ key, and bounded nesting, key, value, and per-container counts before parsing. Current schema-28 exports preserve evidence-source attribution and limitations; published v2 schema 27 and exact v1 schema 26 remain readable, while other historical and unreleased shapes are unsupported. Markdown and HTML include a presentation-only generator footer unless --no-attribution is selected; JSON retains bounded generator provenance. Compact output intentionally omits raw registry payloads.",
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
      "outputFormats": [
        "terminal",
        "Markdown",
        "HTML",
        "JSON"
      ],
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
            "completion": "Select the reviewed lookup file; the plan never guesses a path."
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
          "Disposition, reviewed response actions, monitoring, and closure continue in the browser-local Case workspace; this CLI recipe does not submit reports."
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
        "runnableByWorkflowRun": false,
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
            "label": "Review selected retained evidence",
            "command": "review-evidence",
            "exampleArguments": [
              "\u003cselected-evidence.json>",
              "--json"
            ],
            "mode": "offline",
            "approval": "analyst_selection",
            "produces": "whoisleuth\u002ecli.offline-evidence-review",
            "completion": "Keep source observations separate and record any campaign grouping as analyst-authored."
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
        "runnableByWorkflowRun": false,
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
            "produces": "whoisleuth\u002ect-event-batch",
            "completion": "Only selected saved observations enter the offline intake."
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
        "runnableByWorkflowRun": false,
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
        "runnableByWorkflowRun": false,
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
              "--json"
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
        "runnableByWorkflowRun": false,
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
        "runnableByWorkflowRun": false,
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
            "produces": "whoisleuth\u002edomain-control-review",
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
