# WHOISleuth CLI

WHOISleuth's command-line interface runs the same bounded WHOIS, RDAP, DNS,
HTTP, TLS, certificate-transparency, domain-posture, and lookalike analysis
used by the self-hosted application. Network commands run directly from the
operator's machine. Offline evidence commands do not contact the hosted site.

The scoped package is still private while its exact archive, installed command
surface, account controls, and release provenance are reviewed. The public npm
registry is therefore not an approved installation source yet.

From a repository checkout:

```bash
node bin/whoisleuth.mts --help
node bin/whoisleuth.mts lookup example.test
node bin/whoisleuth.mts lookup example.test --deep --summary
node bin/whoisleuth.mts lookup example.test --deep --markdown --output lookup.md
node bin/whoisleuth.mts bulk domains.txt --deep --checkpoint bulk-checkpoint.json
node bin/whoisleuth.mts diff first-lookup.json second-lookup.json --json
node bin/whoisleuth.mts registry-support example.test --json
node bin/whoisleuth.mts doctor
node bin/whoisleuth.mts completion zsh
node bin/whoisleuth.mts manual | man -l -
npm run cli:package:check
```

Fast lookup is the default. Deep collection must be requested explicitly and
can disclose the target to additional authoritative or first-party network
sources. Missing, partial, rate-limited, and unsupported sources remain
explicit and are never interpreted as evidence of safety or absence.

Interactive output uses restrained semantic colour, width-aware wrapping, and
stderr-only progress for slower collection. Redirected and machine-readable
output stays free of ANSI and progress text. Lookup also provides `--summary`
and `--verbose` terminal views without changing what is collected. `doctor` is
offline unless `--network` is explicitly supplied, and completion scripts are
printed without modifying shell configuration. Commands can use atomic private
`--output` files, Lookup can emit strict automation exits and target-free
versioned progress events, and Bulk can resume an exact validated compact
checkpoint. A checkpoint write failure preserves completed output and returns
the partial-result exit code. Ctrl-C suppresses partial final output and
returns exit code 130; a second interrupt performs best-effort temporary-file
cleanup before exiting immediately.

See `docs/cli.md` in the package for the complete command, privacy, output, and
evidence-contract reference.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
