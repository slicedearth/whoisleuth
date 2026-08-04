# Pinned OASIS STIX 2.1 JSON schemas

This directory contains the non-normative STIX 2.1 JSON schemas from
`oasis-open/cti-stix2-json-schemas` commit
`c4f8d589acf2bdb3783655c89e0ffb6e150006ae` (the `stix2.1` branch), retained
under the included BSD 3-Clause licence.

WHOISleuth uses the schemas only as an offline development and CI conformance
gate for its existing STIX exports. Runtime imports and exports do not load
these files, and schema success does not claim complete semantic or ecosystem
interoperability.
