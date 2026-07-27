import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import fc from 'fast-check';

import {
  MAX_INLINE_SCRIPT_CHARS,
  MAX_INLINE_SCRIPT_TOTAL_CHARS,
  MAX_LIBRARY_FINDINGS,
  MAX_LIBRARY_HTML_CHARS,
  MAX_SCRIPT_ELEMENTS,
  analyzeBrowserLibraries,
} from '../lib/browser-library-profile.mts';

const OBSERVED_AT = '2026-07-27T00:00:00.000Z';

describe('bounded browser-library profile', () => {
  test('identifies a version from an already-observed script URL without retaining the URL', () => {
    const profile = analyzeBrowserLibraries({
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
    assert.doesNotMatch(JSON.stringify(profile), /cdn\.example|private-marker|jquery\.min\.js/);
  });

  test('identifies filename and inline signatures from static script elements only', () => {
    const profile = analyzeBrowserLibraries({
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
  });

  test('keeps an unmatched page neutral rather than claiming no libraries exist', () => {
    const profile = analyzeBrowserLibraries({
      html: '<script src="/assets/application.js"></script>',
      observedAt: OBSERVED_AT,
    });

    assert.equal(profile.status, 'success');
    assert.deepEqual(profile.findings, []);
    assert.match(profile.limitations.join(' '), /unmatched scripts are not evidence/i);
  });

  test('does not interpret JSON-LD metadata as executable library evidence', () => {
    const profile = analyzeBrowserLibraries({
      html: '<script type="application/ld+json">{"name":"jQuery v1.12.4"}</script>',
      observedAt: OBSERVED_AT,
    });

    assert.deepEqual(profile.findings, []);
    assert.equal(profile.diagnostics.inlineScriptsExamined, 0);
  });

  test('counts every advisory match while retaining bounded advisory details', () => {
    const profile = analyzeBrowserLibraries({
      html: '<script>version="15.0.0";document.getElementById("__NEXT_DATA__").textContent</script>',
      observedAt: OBSERVED_AT,
    });
    const finding = profile.findings.find(({ id }) => id === 'nextjs');

    assert.ok(finding);
    assert.equal(finding.advisoryCount, 25);
    assert.ok(finding.advisoryIdentifiers.length <= 16);
    assert.ok(finding.weaknessClasses.length <= 12);
    assert.equal(profile.status, 'success');
  });

  test('marks truncated source and every evaluation boundary as partial', () => {
    const tooManyScripts = Array.from(
      { length: MAX_SCRIPT_ELEMENTS + 2 },
      (_, index) => `<script src="/assets/library-${index}.js"></script>`,
    ).join('');
    const oversizedInline = `<script>${'x'.repeat(MAX_INLINE_SCRIPT_CHARS + 1)}</script>`;
    const oversizedHtml = `<main>${'x'.repeat(MAX_LIBRARY_HTML_CHARS + 1)}</main>`;

    for (const html of [tooManyScripts, oversizedInline, oversizedHtml]) {
      const profile = analyzeBrowserLibraries({ html, observedAt: OBSERVED_AT, sourceTruncated: true });
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

  test('never throws or echoes arbitrary bounded HTML', () => {
    fc.assert(fc.property(
      fc.string({ maxLength: 2_000 }),
      (value) => {
        const marker = `PRIVATE-${value}`;
        const profile = analyzeBrowserLibraries({
          html: `<script>${marker}</script>`,
          observedAt: OBSERVED_AT,
        });
        assert.ok(profile.findings.length <= MAX_LIBRARY_FINDINGS);
        assert.doesNotMatch(JSON.stringify(profile), /PRIVATE-/);
      },
    ), { numRuns: 400, seed: 5952 });
  });
});
