# MaxMind DB test fixture

`GeoIP2-City-Test.mmdb` is copied from the official MaxMind-DB repository at
commit `606235df5e5fff92864a5b1a7073bfba1199ba7b`.

- Source: `test-data/GeoIP2-City-Test.mmdb`
- SHA-256: `ed972738e4e03a3e56e12041a6af4d91592249d110f7e4a647e5f2fa0e639c09`
- Licence: MIT (the upstream repository also offers Apache-2.0)

The fixture is used only by offline tests. WHOISleuth does not bundle a
production geolocation database, download database updates, or perform hosted
address enrichment.
