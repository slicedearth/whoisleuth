import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildRegistrarStanding,
  registrarStandingCatalogueHealth,
} from '../lib/registrar-standing.mts';
import { REGISTRAR_STANDING_CATALOGUE } from '../lib/generated/registrar-standing-catalogue.mts';
import {
  IANA_REGISTRAR_SOURCE_URL,
  REGISTRAR_STANDING_MAX_AGE_DAYS,
  REGISTRAR_STANDING_MAX_FUTURE_SKEW_MS,
} from '../lib/registrar-standing-catalogue-contract.mts';
import {
  MAX_REGISTRAR_COMPLIANCE_ACTIONS,
  validRegistrarStanding,
} from '../lib/registrar-standing-contract.mts';
import {
  buildRegistrarStandingSnapshot,
  main,
  parseIanaRegistrarCsv,
  parseIcannComplianceNotices,
  renderRegistrarStandingCatalogue,
} from '../tools/registrar-standing-catalogue.mts';

const OBSERVED_AT = '2026-09-03T06:51:00.000Z';
const CSV = `"ID",Registrar Name,Status,RDAP Base URL\n`
  + `2,"Example, Registrar",Accredited,https://rdap.example.test/\n`
  + `4318,Example Provider,Accredited,\n`
  + `5000,Former Provider,Terminated,\n`;
const HTML = `<!doctype html><html><body>
  <div id="2026-Termination">
    <div class="compliance-notice" data-id="27-08-2026" id="notice-1367">
      <a href="/uploads/compliance_notice/attachment/1367/notice.pdf">ICANN Sends Notice of Termination to Registrar</a>
      (Example Provider (IANA#4318)) <span class="action"></span>
    </div>
  </div>
  <div id="2026-Suspension"><i class="no_result">No notices.</i></div>
  <div id="2026-Breach">
    <div class="compliance-notice" data-id="26-08-2026" id="notice-1365">
      <a href="/uploads/compliance_notice/attachment/1365/breach.pdf">ICANN Sends Notice of Breach to Registrar</a>
      (Example Provider (IANA #4318)) <span class="action"><strong>Escalated</strong> to <em>Termination</em></span>
    </div>
  </div>
  <div id="2026-Non-Renewal"><i class="no_result">No notices.</i></div>
</body></html>`;

function fixtureCatalogue() {
  return buildRegistrarStandingSnapshot({
    registrarRows: parseIanaRegistrarCsv(CSV),
    notices: parseIcannComplianceNotices(HTML, 2026),
  }, {
    generatedAt: OBSERVED_AT,
    ianaObservedAt: OBSERVED_AT,
    catalogueYear: 2026,
  });
}

function writer() {
  let output = '';
  return {
    stream: { write(value: string) { output += value; } },
    read: () => output,
  };
}

describe('registrar standing catalogue maintenance', () => {
  test('parses quoted IANA CSV and current-year ICANN sections into minimal records', () => {
    const rows = parseIanaRegistrarCsv(CSV);
    const notices = parseIcannComplianceNotices(HTML, 2026);
    assert.deepEqual(rows, [
      { id: 2, status: 'Accredited' },
      { id: 4318, status: 'Accredited' },
      { id: 5000, status: 'Terminated' },
    ]);
    assert.deepEqual(notices, [
      {
        noticeId: 'notice-1367',
        ianaId: 4318,
        type: 'termination',
        issuedOn: '2026-08-27',
        sourceUrl: 'https://www.icann.org/uploads/compliance_notice/attachment/1367/notice.pdf',
        indexOutcome: null,
      },
      {
        noticeId: 'notice-1365',
        ianaId: 4318,
        type: 'breach',
        issuedOn: '2026-08-26',
        sourceUrl: 'https://www.icann.org/uploads/compliance_notice/attachment/1365/breach.pdf',
        indexOutcome: 'Escalated to Termination',
      },
    ]);
  });

  test('rejects duplicate IDs, malformed rows, changed notice structure and off-origin links', () => {
    assert.throws(() => parseIanaRegistrarCsv(`${CSV}4318,Duplicate,Accredited,\n`), /repeated ID 4318/u);
    assert.throws(() => parseIanaRegistrarCsv(CSV.replace('Accredited', 'Unknown')), /unsupported status/u);
    assert.throws(() => parseIcannComplianceNotices(HTML.replace('id="2026-Breach"', 'id="changed"'), 2026), /2026-Breach/u);
    assert.throws(() => parseIcannComplianceNotices(
      HTML.replace('/uploads/compliance_notice/attachment/1367/notice.pdf', 'https://untrusted.example/notice.pdf'),
      2026,
    ), /unexpected source URL/u);
    assert.throws(() => parseIcannComplianceNotices(
      HTML.replace('/uploads/compliance_notice/attachment/1367/notice.pdf', 'https://www.icann.org:444/uploads/compliance_notice/attachment/1367/notice.pdf'),
      2026,
    ), /unexpected source URL/u);
    assert.throws(() => buildRegistrarStandingSnapshot({
      registrarRows: parseIanaRegistrarCsv(CSV),
      notices: parseIcannComplianceNotices(HTML, 2026),
    }, {
      generatedAt: '2026-09-03',
      ianaObservedAt: OBSERVED_AT,
      catalogueYear: 2026,
    }), /explicit timezone/u);
  });

  test('renders no registrar names or source HTML into the runtime catalogue', () => {
    const rendered = renderRegistrarStandingCatalogue(fixtureCatalogue());
    assert.match(rendered, /"encodedStatuses": "2:A,4318:A,5000:T"/u);
    assert.doesNotMatch(rendered, /Example Provider|Example, Registrar|<!doctype/iu);
    assert.match(rendered, /notice-1367/u);
  });

  test('writes an explicit reviewed update atomically beneath the selected repository root', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'whoisleuth-registrar-standing-'));
    try {
      await mkdir(path.join(repositoryRoot, 'lib', 'generated'), { recursive: true });
      const ianaSource = path.join(repositoryRoot, 'iana.csv');
      const icannSource = path.join(repositoryRoot, 'icann.html');
      await Promise.all([
        writeFile(ianaSource, CSV, 'utf8'),
        writeFile(icannSource, HTML, 'utf8'),
      ]);
      const output = writer();
      const errors = writer();
      const code = await main([
        '--write',
        '--iana-source', ianaSource,
        '--icann-source', icannSource,
        '--observed-at', OBSERVED_AT,
      ], { repositoryRoot, stdout: output.stream, stderr: errors.stream });
      assert.equal(code, 0, errors.read());
      const generatedDirectory = path.join(repositoryRoot, 'lib', 'generated');
      assert.deepEqual(await readdir(generatedDirectory), ['registrar-standing-catalogue.mts']);
      assert.equal(
        await readFile(path.join(generatedDirectory, 'registrar-standing-catalogue.mts'), 'utf8'),
        renderRegistrarStandingCatalogue(fixtureCatalogue()),
      );
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  test('rejects a future-dated maintainer update before writing output', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'whoisleuth-registrar-standing-future-'));
    try {
      const ianaSource = path.join(repositoryRoot, 'iana.csv');
      const icannSource = path.join(repositoryRoot, 'icann.html');
      await Promise.all([
        writeFile(ianaSource, CSV, 'utf8'),
        writeFile(icannSource, HTML, 'utf8'),
      ]);
      const errors = writer();
      const code = await main([
        '--write',
        '--iana-source', ianaSource,
        '--icann-source', icannSource,
        '--observed-at', new Date(Date.parse(OBSERVED_AT) + REGISTRAR_STANDING_MAX_FUTURE_SKEW_MS + 1).toISOString(),
      ], {
        repositoryRoot,
        now: () => new Date(OBSERVED_AT),
        stdout: writer().stream,
        stderr: errors.stream,
      });
      assert.equal(code, 2);
      assert.match(errors.read(), /too far in the future/iu);
      await assert.rejects(readdir(path.join(repositoryRoot, 'lib', 'generated')), /ENOENT/u);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  test('audits each official source once and reports normalized drift without writing', async () => {
    const requests: string[] = [];
    const output = writer();
    const errors = writer();
    const code = await main(['--json'], {
      snapshot: fixtureCatalogue(),
      now: () => new Date(OBSERVED_AT),
      fetchSource: async (url) => {
        requests.push(url);
        return new Response(url === IANA_REGISTRAR_SOURCE_URL ? CSV : HTML, { status: 200 });
      },
      stdout: output.stream,
      stderr: errors.stream,
    });
    assert.equal(code, 0, errors.read());
    assert.equal(requests.length, 2);
    const report = JSON.parse(output.read());
    assert.equal(report.status, 'current');
    assert.equal(report.networkRequests, 2);
    assert.ok(report.checks.every((check: { status: string }) => check.status === 'current'));
  });

  test('marks the annual ICANN catalogue rollover as drift even when the new year has no notices', async () => {
    const output = writer();
    const nextYearHtml = HTML.replaceAll('2026-', '2027-')
      .replace(/<div class="compliance-notice"[\s\S]*?<\/div>/gu, '<i class="no_result">No notices.</i>');
    const code = await main(['--json'], {
      snapshot: fixtureCatalogue(),
      now: () => new Date('2027-01-01T00:00:00.000Z'),
      fetchSource: async (url) => new Response(url === IANA_REGISTRAR_SOURCE_URL ? CSV : nextYearHtml, { status: 200 }),
      stdout: output.stream,
      stderr: writer().stream,
    });
    assert.equal(code, 1);
    const report = JSON.parse(output.read());
    const icann = report.checks.find((check: { id: string }) => check.id === 'icann_current_year_notices');
    assert.equal(icann.status, 'drift');
    assert.equal(icann.expectedYear, 2026);
    assert.equal(icann.observedYear, 2027);
    assert.equal(icann.observedItems, 0);
  });

  test('marks an unchanged retained catalogue as drift once its review age expires', async () => {
    const output = writer();
    const code = await main(['--json'], {
      snapshot: fixtureCatalogue(),
      now: () => new Date(Date.parse(OBSERVED_AT) + ((REGISTRAR_STANDING_MAX_AGE_DAYS + 1) * 86_400_000)),
      fetchSource: async (url) => new Response(url === IANA_REGISTRAR_SOURCE_URL ? CSV : HTML, { status: 200 }),
      stdout: output.stream,
      stderr: writer().stream,
    });
    assert.equal(code, 1);
    const report = JSON.parse(output.read());
    const freshness = report.checks.find((check: { id: string }) => check.id === 'catalogue_freshness');
    assert.equal(freshness.status, 'drift');
    assert.equal(freshness.ageDays, REGISTRAR_STANDING_MAX_AGE_DAYS + 1);
    assert.equal(freshness.maximumAgeDays, REGISTRAR_STANDING_MAX_AGE_DAYS);
  });

  test('rejects a retained catalogue whose declared digest is inconsistent', async () => {
    const malformed = structuredClone(fixtureCatalogue());
    (malformed as unknown as { iana: { normalizedSha256: string } }).iana.normalizedSha256 = '0'.repeat(64);
    const errors = writer();
    const code = await main(['--json'], {
      snapshot: malformed,
      now: () => new Date(OBSERVED_AT),
      fetchSource: async (url) => new Response(url === IANA_REGISTRAR_SOURCE_URL ? CSV : HTML, { status: 200 }),
      stdout: writer().stream,
      stderr: errors.stream,
    });
    assert.equal(code, 2);
    assert.match(errors.read(), /retained registrar standing catalogue failed/iu);
  });
});

describe('registrar standing interpretation', () => {
  test('keeps accreditation and compliance separate when an official termination notice is present', () => {
    const standing = buildRegistrarStanding({
      registrarIanaId: '04318',
      catalogue: fixtureCatalogue(),
      now: new Date('2026-09-03T12:00:00.000Z'),
    });
    assert.equal(standing.ianaId, '4318');
    assert.equal(standing.accreditation.state, 'accredited');
    assert.equal(standing.compliance.state, 'matching_actions');
    assert.equal(standing.assessment.state, 'notice_present');
    assert.equal(standing.assessment.label, 'Official termination notice found');
    assert.match(standing.limitations.join(' '), /not whether this domain is malicious/iu);
    assert.equal(validRegistrarStanding(standing), true);
  });

  test('does not infer a dated outcome or target maliciousness from the notice index', () => {
    const standing = buildRegistrarStanding({
      registrarIanaId: '4318',
      catalogue: fixtureCatalogue(),
      now: new Date('2026-09-12T00:00:00.000Z'),
    });
    assert.equal(standing.assessment.state, 'notice_present');
    assert.match(standing.assessment.detail, /records the registrar as accredited/iu);
    assert.match(standing.limitations.join(' '), /not whether this domain is malicious/iu);
  });

  test('makes a stale no-match inconclusive and preserves terminated catalogue state', () => {
    const staleNow = new Date(Date.parse(OBSERVED_AT) + ((REGISTRAR_STANDING_MAX_AGE_DAYS + 1) * 86_400_000));
    const noMatch = buildRegistrarStanding({ registrarIanaId: '2', catalogue: fixtureCatalogue(), now: staleNow });
    assert.equal(noMatch.accreditation.state, 'accredited');
    assert.equal(noMatch.accreditation.sourceHealth, 'stale');
    assert.equal(noMatch.compliance.state, 'stale');
    assert.equal(noMatch.assessment.state, 'unknown');

    const terminated = buildRegistrarStanding({ registrarIanaId: '5000', catalogue: fixtureCatalogue(), now: staleNow });
    assert.equal(terminated.accreditation.state, 'terminated');
    assert.equal(terminated.assessment.state, 'unknown');
  });

  test('reports catalogue freshness from the oldest official-source observation', () => {
    const sourceTimestamps = [
      REGISTRAR_STANDING_CATALOGUE.iana.observedAt,
      REGISTRAR_STANDING_CATALOGUE.icann.reviewedAt,
    ];
    const latestSourceTime = Math.max(...sourceTimestamps.map((value) => Date.parse(value)));
    const earliestSource = [...sourceTimestamps]
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
    const health = registrarStandingCatalogueHealth(new Date(latestSourceTime + (12 * 60 * 60 * 1_000)));
    assert.equal(health.state, 'current');
    assert.equal(health.sourceObservedAt, earliestSource);
    assert.equal(health.ageDays, 0);
    assert.equal(
      health.itemCount,
      REGISTRAR_STANDING_CATALOGUE.iana.rows + REGISTRAR_STANDING_CATALOGUE.icann.notices.length,
    );
  });

  test('fails closed for missing IDs, malformed catalogues, off-origin URLs and excess actions', () => {
    const missing = buildRegistrarStanding({ registrarIanaId: null, catalogue: fixtureCatalogue(), now: new Date(OBSERVED_AT) });
    assert.equal(missing.ianaId, null);
    assert.equal(missing.assessment.state, 'unknown');
    assert.equal(missing.compliance.state, 'not_applicable');

    const malformed = structuredClone(fixtureCatalogue()) as Record<string, unknown>;
    (malformed.iana as Record<string, unknown>).normalizedSha256 = '0'.repeat(64);
    const unavailable = buildRegistrarStanding({ registrarIanaId: '2', catalogue: malformed, now: new Date(OBSERVED_AT) });
    assert.equal(unavailable.accreditation.sourceHealth, 'unavailable');
    assert.equal(unavailable.assessment.state, 'unknown');

    const valid = buildRegistrarStanding({ registrarIanaId: '4318', catalogue: fixtureCatalogue(), now: new Date(OBSERVED_AT) });
    const offOrigin = structuredClone(valid) as unknown as { compliance: { actions: Array<{ sourceUrl: string }> } };
    offOrigin.compliance.actions[0]!.sourceUrl = 'https://untrusted.example/notice.pdf';
    assert.equal(validRegistrarStanding(offOrigin), false);
    const wrongNotice = structuredClone(valid) as unknown as { compliance: { actions: Array<{ sourceUrl: string }> } };
    wrongNotice.compliance.actions[0]!.sourceUrl = 'https://www.icann.org/uploads/compliance_notice/attachment/9999/notice.pdf';
    assert.equal(validRegistrarStanding(wrongNotice), false);
    const alternatePort = structuredClone(valid) as unknown as { compliance: { actions: Array<{ sourceUrl: string }> } };
    alternatePort.compliance.actions[0]!.sourceUrl = 'https://www.icann.org:444/uploads/compliance_notice/attachment/1367/notice.pdf';
    assert.equal(validRegistrarStanding(alternatePort), false);
    const excess = structuredClone(valid) as unknown as { compliance: { actions: Array<unknown> } };
    excess.compliance.actions = Array.from({ length: MAX_REGISTRAR_COMPLIANCE_ACTIONS + 1 }, () => excess.compliance.actions[0]);
    assert.equal(validRegistrarStanding(excess), false);

    const incoherent = structuredClone(valid) as unknown as {
      compliance: { state: string };
      limitations: string[];
    };
    incoherent.compliance.state = 'reviewed_no_match';
    assert.equal(validRegistrarStanding(incoherent), false);
    incoherent.compliance.state = 'matching_actions';
    incoherent.limitations.push(incoherent.limitations[0]!);
    assert.equal(validRegistrarStanding(incoherent), false);

    const wrongCounts = structuredClone(fixtureCatalogue()) as unknown as {
      iana: { counts: { Accredited: number } };
    };
    wrongCounts.iana.counts.Accredited += 1;
    assert.equal(buildRegistrarStanding({
      registrarIanaId: '4318',
      catalogue: wrongCounts,
      now: new Date(OBSERVED_AT),
    }).assessment.state, 'unknown');

    const outOfOrder = structuredClone(valid) as unknown as {
      compliance: { actions: Array<unknown> };
    };
    outOfOrder.compliance.actions.reverse();
    assert.equal(validRegistrarStanding(outOfOrder), false);

    const noAction = buildRegistrarStanding({
      registrarIanaId: '2',
      catalogue: fixtureCatalogue(),
      now: new Date(OBSERVED_AT),
    });
    const incoherentNextAction = structuredClone(noAction) as unknown as { nextActions: string[] };
    incoherentNextAction.nextActions.push('Take an unsupported action.');
    assert.equal(validRegistrarStanding(incoherentNextAction), false);

    const misleadingAssessment = structuredClone(valid) as unknown as {
      assessment: { label: string; detail: string };
    };
    misleadingAssessment.assessment.label = 'No concerns';
    misleadingAssessment.assessment.detail = 'This unrelated text does not follow from the retained sources.';
    assert.equal(validRegistrarStanding(misleadingAssessment), false);

    const futureAction = structuredClone(valid) as unknown as {
      compliance: { actions: Array<{ issuedOn: string }> };
    };
    futureAction.compliance.actions[0]!.issuedOn = '2026-12-31';
    assert.equal(validRegistrarStanding(futureAction), false);

    const futureCatalogue = structuredClone(fixtureCatalogue()) as unknown as {
      generatedAt: string;
      iana: { observedAt: string };
      icann: { reviewedAt: string };
    };
    const future = new Date(Date.parse(OBSERVED_AT) + REGISTRAR_STANDING_MAX_FUTURE_SKEW_MS + 1).toISOString();
    futureCatalogue.generatedAt = future;
    futureCatalogue.iana.observedAt = future;
    futureCatalogue.icann.reviewedAt = future;
    assert.equal(buildRegistrarStanding({
      registrarIanaId: '4318',
      catalogue: futureCatalogue,
      now: new Date(OBSERVED_AT),
    }).assessment.state, 'unknown');
  });
});
