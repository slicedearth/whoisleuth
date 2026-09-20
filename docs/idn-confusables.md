# Unicode confusable maintenance

WHOISleuth uses one shared Unicode-confusable mapping for browser-side Lookup,
Bulk analysis, local Discover generation, and the CLI. It performs no runtime
request for Unicode data. The checked-in module records its source, limits,
version and provenance.

## Projection boundary

The current projection is generated from Unicode UTS #39 `confusables.txt`,
version 17.0.0. The generator requires the exact pinned SHA-256 digest before
it parses the file. It then:

- bounds source bytes, lines, line length, source and target code points;
- accepts only single-code-point source characters;
- requires each addition to produce a distinct IDNA A-label;
- accepts Latin, Cyrillic, Greek, Armenian, Coptic, Deseret, and Lisu sources;
- requires the source and ASCII letter to share the same UTS #39 skeleton;
- retains the previously reviewed compatibility characters first;
- caps skeleton mappings at 12 and generation mappings at 8 per ASCII letter;
  and
- caps the complete skeleton projection at 312 mappings.

The complete upstream table is not copied into the repository or production
bundle. The checked-in projection records its Unicode version, source URL,
SHA-256 digest, Unicode-3.0 licence, policy limits, and generation statistics.

## Calibration gate

Run the offline audit with:

```bash
npm run unicode:confusables
npm run unicode:confusables -- --json
```

The calibration uses reserved synthetic labels. It compares the compatibility
mapping with the current projection across mixed-script,
whole-label, same-script, and unrelated negative cases. It also measures
single-substitution and same-script whole-label candidate growth across
bounded neutral seed labels.

The report contains the current match, false-positive and candidate-growth
measurements. These describe the fixture corpus, not real-world accuracy,
maliciousness or prevalence. Mapping updates require corresponding labelled
coverage.

## Runtime generation boundary

Discover generates single-character substitutions and, for the Impersonation
and All presets, at most one same-script whole-label candidate per reviewed
non-Latin script. A whole-label candidate is emitted only when every ASCII
letter has one eligible replacement in that script. Digits and hyphens may be
preserved, at least two letters must be replaced, and the complete helper is
capped at six candidates.

This helper is not a formal UTS #39 whole-script classification. It uses
JavaScript `Script` properties rather than resolved `Script_Extensions`, so the
interface describes the result as a whole-label Unicode confusable. Generated
domains retain the existing Unicode-confusable provenance used by the Risk
model, and the additional label does not change score weights.

## Rebuild from the pinned source

Download the source deliberately outside the repository:

```bash
curl --fail --location \
  https://www.unicode.org/Public/17.0.0/security/confusables.txt \
  --output /tmp/confusables-17.0.0.txt
```

Check that it reproduces the committed projection:

```bash
npm run unicode:confusables -- \
  --source /tmp/confusables-17.0.0.txt
```

After reviewing a version or policy change, regenerate the bounded module:

```bash
npm run unicode:confusables -- \
  --source /tmp/confusables-17.0.0.txt \
  --write
```

Regeneration never changes the runtime mapping version automatically outside
the generated module. Review its diff, rerun calibration, update fixtures and
licensing notices, and treat any accepted mapping expansion as a compatible
minor application feature. If skeleton semantics change, retain the new
`mappingVersion` in exported analysis. Risk-model weights and stored score
comparisons require their own version change if they are modified.

## Interpretation

Confusability is font- and context-dependent. A skeleton match or mixed-script
label is an investigation lead only. It does not establish that a domain is
registered, controlled by the same party, active, unsafe, or malicious.
