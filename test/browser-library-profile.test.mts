import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import fc from 'fast-check';

import {
  MAX_INLINE_LIBRARY_SCAN_CHARS,
  MAX_INLINE_LIBRARY_SCAN_TOTAL_CHARS,
  MAX_INLINE_SCRIPT_CHARS,
  MAX_INLINE_SCRIPT_TOTAL_CHARS,
  MAX_LIBRARY_FINDINGS,
  MAX_LIBRARY_HTML_CHARS,
  MAX_SCRIPT_ELEMENTS,
  analyzeBrowserLibraries,
} from '../lib/browser-library-profile.mts';
import { CISA_KEV_CATALOG } from '../lib/generated/cisa-kev-catalog.mts';
import { sanitizeLookupChildProfiles } from '../lib/lookup-child-profile-contract.mts';
import { analyzeWebsiteTechnology } from '../lib/website-technology.mts';
import { fastCheckParameters } from './helpers/fast-check-config.mts';

const OBSERVED_AT = '2026-07-27T00:00:00.000Z';

describe('bounded browser-library profile', () => {
  test('cancellation propagates before, during and after matching without poisoning later work', async () => {
    for (const html of ['', '<script>/*! jQuery v3.7.1 */</script>']) {
      const before = new AbortController(); before.abort();
      await assert.rejects(analyzeBrowserLibraries({ html, signal: before.signal }), { name: 'AbortError' });
      const during = new AbortController();
      const pending = analyzeBrowserLibraries({ html, signal: during.signal });
      during.abort();
      await assert.rejects(pending, { name: 'AbortError' });
    }
    const profile = await analyzeBrowserLibraries({ html: '<script>/*! jQuery v3.7.1 */</script>', observedAt: OBSERVED_AT });
    assert.equal(profile.status, 'success');
    assert.deepEqual(profile.findings.map(({ id, apparentVersion }) => ({ id, apparentVersion })), [{ id: 'jquery', apparentVersion: '3.7.1' }]);
  });

  test('qualifies malformed catalogue identifiers without discarding advisory matches or breaking retained readers', async () => {
    const profile = await analyzeBrowserLibraries({ html: '<script>/* dwr-1.1.3.jar */</script>', observedAt: OBSERVED_AT });
    const finding = profile.findings.find((entry) => entry.id === 'DWR');
    assert.ok(finding);
    assert.equal(finding.advisoryCount, 2);
    assert.equal(finding.highestSeverity, 'high');
    assert.deepEqual(finding.advisoryIdentifiers, ['CVE-2014-5325', 'CVE-2014-5326']);
    assert.equal(profile.status, 'partial');
    assert.equal(profile.complete, false);
    assert.match(profile.limitations.join(' '), /1 supplied CVE identifier entry was omitted/u);
    const read = async (library: typeof profile) => {
      const input: Parameters<typeof sanitizeLookupChildProfiles>[0] = JSON.parse(JSON.stringify({
        availability: { technologyProfile: { ...(await analyzeWebsiteTechnology({ observedAt: OBSERVED_AT })), browserLibraryProfile: library } },
      }));
      return { input, output: sanitizeLookupChildProfiles(input) };
    };
    const current = await read(profile);
    assert.equal(current.output, current.input);
    assert.equal(profile.knownExploitedCatalog.releasedAt, new Date(CISA_KEV_CATALOG.releasedAt).toISOString());
    const retained = structuredClone(profile);
    const retainedFinding = requiredValue(retained.findings[0]);
    retainedFinding.advisoryIdentifiers = ['CVE-2007-01-09'];
    retained.knownExploitedCatalog.releasedAt = CISA_KEV_CATALOG.releasedAt;
    const legacy = await read(retained);
    assert.equal(legacy.output, legacy.input);
    retained.knownExploitedCatalog.releasedAt = '2026-09-04';
    const invalidDate = await read(retained);
    assert.notEqual(invalidDate.output, invalidDate.input);
    retained.knownExploitedCatalog.releasedAt = CISA_KEV_CATALOG.releasedAt;
    retainedFinding.advisoryCount = 1;
    retainedFinding.advisoryIdentifiers = ['CVE-2026-1234', 'GHSA-2345-CFGH-JMPQ'];
    const aliases = await read(retained);
    assert.equal(aliases.output, aliases.input);
    retainedFinding.advisoryCount = 0;
    const unbacked = await read(retained);
    assert.notEqual(unbacked.output, unbacked.input);
    retainedFinding.advisoryCount = 1;
    retained.profileVersion += 1;
    const future = await read(retained);
    assert.notEqual(future.output, future.input);
  });
  test('identifies a version from an already-observed script URL without retaining the URL', async () => {
    const profile = await analyzeBrowserLibraries({
      html: '<script src="https://cdn.example/library/1.12.4/jquery.min.js?token=private-marker"></script>',
      observedAt: OBSERVED_AT,
    });

    assert.equal(profile.status, 'success');
    assert.equal(profile.complete, true);
    assert.equal(profile.catalog.version, 'retire.js-5.4.3');
    assert.deepEqual(profile.findings.map(({ id, apparentVersion, detectionMethods }) => ({
      id,
      apparentVersion,
      detectionMethods,
    })), [{
      id: 'jquery',
      apparentVersion: '1.12.4',
      detectionMethods: ['script URL'],
    }]);
    assert.ok(requiredValue(profile.findings[0]).advisoryCount > 0);
    assert.ok(requiredValue(profile.findings[0]).advisoryIdentifiers.includes('CVE-2020-11022'));
    assert.deepEqual(requiredValue(profile.findings[0]).knownExploitedIdentifiers, ['CVE-2020-11023']);
    assert.equal(requiredValue(profile.findings[0]).knownExploitedCount, 1);
    assert.equal(profile.knownExploitedCatalog.version, CISA_KEV_CATALOG.catalogVersion);
    assert.doesNotMatch(JSON.stringify(profile), /cdn\.example|private-marker|jquery\.min\.js/);
  });

  test('identifies filename and inline signatures from static script elements only', async () => {
    const profile = await analyzeBrowserLibraries({
      html: `
        <script src="/assets/angular-1.7.0.min.js?cache=private"></script>
        <script>/*! jQuery v3.7.1 | fixture */</script>
        <div data-copy="<script src='/assets/jquery-1.0.js'></script>"></div>
      `,
      observedAt: OBSERVED_AT,
    });

    assert.deepEqual(profile.findings.map(({ id, apparentVersion, detectionMethods }) => ({
      id,
      apparentVersion,
      detectionMethods,
    })), [
      { id: 'angularjs', apparentVersion: '1.7.0', detectionMethods: ['script filename'] },
      { id: 'jquery', apparentVersion: '3.7.1', detectionMethods: ['inline signature'] },
    ]);
    assert.equal(requiredValue(profile.findings[1]).advisoryCount, 0);
    assert.equal(requiredValue(profile.findings[1]).knownExploitedCount, 0);
  });

  test('keeps an unmatched page neutral rather than claiming no libraries exist', async () => {
    const profile = await analyzeBrowserLibraries({
      html: '<script src="/assets/application.js"></script>',
      observedAt: OBSERVED_AT,
    });

    assert.equal(profile.status, 'success');
    assert.deepEqual(profile.findings, []);
    assert.match(profile.limitations.join(' '), /unmatched scripts are not evidence/i);
  });

  test('does not interpret JSON-LD metadata as executable library evidence', async () => {
    const profile = await analyzeBrowserLibraries({
      html: '<script type="application/ld+json">{"name":"jQuery v1.12.4"}</script>',
      observedAt: OBSERVED_AT,
    });

    assert.deepEqual(profile.findings, []);
    assert.equal(profile.diagnostics.inlineScriptsExamined, 0);
  });

  test('counts every advisory match while retaining bounded advisory details', async () => {
    const profile = await analyzeBrowserLibraries({
      html: '<script>version="15.0.0";document.getElementById("__NEXT_DATA__").textContent</script>',
      observedAt: OBSERVED_AT,
    });
    const finding = profile.findings.find(({ id }) => id === 'nextjs');

    assert.ok(finding);
    assert.equal(finding.advisoryCount, 32);
    assert.ok(finding.advisoryIdentifiers.length <= 16);
    assert.ok(finding.weaknessClasses.length <= 12);
    assert.equal(profile.status, 'success');
  });

  test('retains advisory evidence beyond the former component truncation boundary', async () => {
    const profile = await analyzeBrowserLibraries({
      html: '<script>version="16.1.6";document.getElementById("__NEXT_DATA__").textContent</script>',
      observedAt: OBSERVED_AT,
    });
    const finding = profile.findings.find(({ id }) => id === 'nextjs');

    assert.ok(finding);
    assert.ok(finding.advisoryIdentifiers.includes('CVE-2026-27980'));
    assert.ok(finding.advisoryIdentifiers.includes('CVE-2026-29057'));
    assert.equal(profile.status, 'success');
  });

  test('marks truncated source and every evaluation boundary as partial', async () => {
    const tooManyScripts = Array.from(
      { length: MAX_SCRIPT_ELEMENTS + 2 },
      (_, index) => `<script src="/assets/library-${index}.js"></script>`,
    ).join('');
    const oversizedInline = `<script>${'x'.repeat(MAX_INLINE_SCRIPT_CHARS + 1)}</script>`;
    const oversizedHtml = `<main>${'x'.repeat(MAX_LIBRARY_HTML_CHARS + 1)}</main>`;

    for (const html of [tooManyScripts, oversizedInline, oversizedHtml]) {
      const profile = await analyzeBrowserLibraries({ html, observedAt: OBSERVED_AT, sourceTruncated: true });
      assert.equal(profile.status, 'partial');
      assert.equal(profile.complete, false);
      assert.equal(profile.truncated, true);
      assert.ok(profile.findings.length <= MAX_LIBRARY_FINDINGS);
      const inlineCharactersExamined = profile.diagnostics.inlineCharactersExamined;
      const scriptsExamined = profile.diagnostics.scriptsExamined;
      assert.equal(typeof inlineCharactersExamined, 'number');
      assert.equal(typeof scriptsExamined, 'number');
      if (typeof inlineCharactersExamined === 'number') {
        assert.ok(inlineCharactersExamined <= MAX_INLINE_SCRIPT_TOTAL_CHARS);
      }
      if (typeof scriptsExamined === 'number') {
        assert.ok(scriptsExamined <= MAX_SCRIPT_ELEMENTS);
      }
    }
  });

  test('bounds adversarial inline-signature work while retaining full-content hash coverage', async () => {
    const profile = await analyzeBrowserLibraries({
      html: `<script>${'/'.repeat(MAX_INLINE_SCRIPT_CHARS)}</script>`,
      observedAt: OBSERVED_AT,
    });

    assert.equal(profile.status, 'partial');
    assert.equal(profile.complete, false);
    assert.equal(
      profile.diagnostics.inlineSignatureCharactersExamined,
      MAX_INLINE_LIBRARY_SCAN_CHARS,
    );
    assert.ok(
      Number(profile.diagnostics.inlineSignatureCharactersExamined)
        <= MAX_INLINE_LIBRARY_SCAN_TOTAL_CHARS,
    );
    assert.match(profile.limitations.join(' '), /deterministic .* cumulative sample/i);
  });

  test('shares the inline-signature ceiling across scripts without losing head and tail evidence', async () => {
    const filler = 'x'.repeat(MAX_INLINE_LIBRARY_SCAN_CHARS - 64);
    const profile = await analyzeBrowserLibraries({
      html: Array.from(
        { length: 6 },
        (_, index) => `<script>/*! jQuery v3.7.${index} */${filler}/*! jQuery v3.6.${index} */</script>`,
      ).join(''),
      observedAt: OBSERVED_AT,
    });

    assert.equal(profile.status, 'partial');
    assert.equal(
      profile.diagnostics.inlineSignatureCharactersExamined,
      MAX_INLINE_LIBRARY_SCAN_TOTAL_CHARS,
    );
    assert.ok(profile.findings.some(({ id }) => id === 'jquery'));
  });

  test('never throws or echoes arbitrary bounded HTML', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ maxLength: 2_000 }),
      async (value) => {
        const marker = `PRIVATE-${value}`;
        const profile = await analyzeBrowserLibraries({
          html: `<script>${marker}</script>`,
          observedAt: OBSERVED_AT,
        });
        assert.ok(profile.findings.length <= MAX_LIBRARY_FINDINGS);
        assert.doesNotMatch(JSON.stringify(profile), /PRIVATE-/);
      },
    ), fastCheckParameters(400, 5_952));
  });
});
