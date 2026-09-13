# External evaluation examples

`rows.json` contains 128 minimised rows derived from the
[PhiUSIIL Phishing URL (Website) dataset](https://archive.ics.uci.edu/dataset/967/phiusiil+phishing+url+dataset)
by Arvind Prasad and Shalini Chandra (2024),
[doi:10.1016/j.cose.2023.103545](https://doi.org/10.1016/j.cose.2023.103545).
The source and this adapted data subset are available under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), without warranties.
No author or repository endorsement is implied. The surrounding code retains
the project licence.

## What the rows establish

The source's historical `label` is retained unchanged: `0` means phishing and
`1` means legitimate. `HasPasswordField` and `HasExternalFormSubmit` are retained
as booleans. They are source-provided page features, not independently rerun
collection. Two page-wide flags do not prove that the same form contains the
password field and submits externally.

Source URLs, hostnames, filenames, titles and other features are omitted.
`sourceRow` is the one-based data-row ordinal, excluding the CSV header.
`domainGroup` is a SHA-256 digest of the normalised registrable domain (or the
normalised hostname when no registrable domain is available). These references
permit comparison with the original public dataset; they are not an anonymity
guarantee. No source URL is visited during curation or evaluation.

The sample shows that the same form-feature combinations occur in both source
classes. It cannot establish current maliciousness, safety, authorisation,
registration, removal, extraction accuracy or population detection accuracy.
Collection times and campaign identities are unavailable. Similar templates or
campaigns may span different domain groups.

## Reproduce and evaluate

Use the Node runtime and locked dependencies described in
[Getting Started](../../docs/getting-started.md). Download the archive linked by
the source page separately. The curator accepts only the reviewed archive and
CSV SHA-256 identities recorded in `tools/risk-evaluation.mts` and `rows.json`.
It makes no requests and refuses to overwrite its output:

```sh
node tools/risk-evaluation.mts --curate /tmp/source.zip /tmp/evaluation-rows.json
cmp fixtures/risk-evaluation/rows.json /tmp/evaluation-rows.json
node tools/risk-evaluation.mts
node --test test/risk-evaluation.test.mts
```

The curator validates bounded CSV rows and ZIP contents, groups all subdomains
under the ICANN registrable domain, and assigns a group to development or
evaluation using the first SHA-256 byte (`<128` or `>=128`). It retains the row
with the lowest SHA-256 of `row:<ordinal>` per group, then the eight lowest
row hashes per split, label and form-feature combination. Selection does not
read WHOISleuth scores. Original population counts, discarded invalid URLs and
groups containing conflicting source labels remain explicit. A selected row's
label does not classify its entire group.

Development and evaluation groups do not overlap. This is a public, inspected
holdout split, not a blinded study. A rule change should use the development
examples first and report evaluation separately. Do not tune the split or
select examples after seeing a desired score.

The report uses the existing CLI calibration and browser-summary contracts.
It maps source labels to calibration classes only for that offline report,
uses reserved domain placeholders, and supplies only the password-field flag.
The other page flag cannot establish same-form linkage. Unknown registration
is left unknown, so the current model withholds all scores and its precision
and recall remain unmeasured. Labels are not injected as intelligence evidence.
The report's generation timestamp is not a source observation time.

This set supplements the [synthetic reviewed examples](../risk-reviewed-examples.mts)
and workflow tests. It does not replace independent incident review or an
actual first-use study with human participants.
