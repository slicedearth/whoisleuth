import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Byte, Encoder } from '@nuintun/qrcode';
import { encode } from 'fast-png';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { requireJsonRecord as record } from './maintainer-tool-helpers.mts';
import type { RunInstalledCli } from './installed-cli-check.mts';
import { CLI_INVESTIGATION_RUN_SCHEMA, CLI_INVESTIGATION_RUN_VERSION, MAX_INVESTIGATION_RUN_BYTES } from '../packages/contracts/investigation-run.mts';
import { checkInstalledDomainFeed } from './cli-domain-feed-package-check.mts';

/** Offline resumption, retained artefact reuse and independent review approval. */
export async function checkInstalledCliWorkflows(repositoryRoot: string, temporaryRoot: string, run: RunInstalledCli): Promise<void> {
  const workflowFixture = path.join(temporaryRoot, 'workflow.json');
  await writeFile(workflowFixture, await readBoundedRegularFileWithin(repositoryRoot, 'test/fixtures/cli-investigation-run-v2.json', {
    maximumBytes: MAX_INVESTIGATION_RUN_BYTES, minimumBytes: 1, label: 'Public workflow checkpoint fixture',
  }), { mode: 0o600, flag: 'wx' });
  const workflow = record(JSON.parse(await run([
    'workflow-run', 'domain-triage', 'example.test', '--resume', workflowFixture,
    '--use-artifact', 'export:1=collect', '--use-artifact', 'verify:1=export', '--json',
  ], 'offline workflow artefact reuse', 4)), 'Installed workflow');
  if (workflow.schema !== CLI_INVESTIGATION_RUN_SCHEMA || workflow.version !== CLI_INVESTIGATION_RUN_VERSION || workflow.state !== 'partial'
    || !Array.isArray(workflow.completedSteps) || workflow.completedSteps.length !== 3
    || record(workflow.completedSteps[1], 'Installed workflow export').command !== 'export'
    || record(workflow.completedSteps[2], 'Installed workflow verification').command !== 'verify-artifact') {
    throw new TypeError('Installed workflow did not retain and reuse the partial public observation offline.');
  }
  const handoffEvidence = path.join(temporaryRoot, 'handoff-evidence.json');
  const handoffCases = path.join(temporaryRoot, 'handoff-cases.json');
  const handoffCheckpoint = path.join(temporaryRoot, 'handoff-checkpoint.json');
  const publicCases = record(JSON.parse((await readBoundedRegularFileWithin(repositoryRoot,
    'test/fixtures/case-lifecycle/cli-case-pack-v2-case-v15.json', {
      maximumBytes: MAX_INVESTIGATION_RUN_BYTES, minimumBytes: 1, label: 'Public Case-pack fixture',
    })).toString('utf8')), 'Public Case-pack fixture');
  await writeFile(handoffEvidence, JSON.stringify(record(workflow.completedSteps[1], 'Retained export').result), { flag: 'wx', mode: 0o600 });
  await writeFile(handoffCases, JSON.stringify({ version: publicCases.version, exportedAt: publicCases.exportedAt, cases: publicCases.cases }), { flag: 'wx', mode: 0o600 });
  const handoff = record(JSON.parse(await run([
    'workflow-run', 'evidence-handoff', 'Example review', '--select', `verify=${handoffEvidence}`,
    '--select', `package=${handoffCases}`, '--confirm-review', 'package', '--json',
  ], 'offline handoff review boundary')), 'Installed handoff');
  if (handoff.state !== 'awaiting_review_confirmation' || record(handoff.currentStep, 'Handoff review step').id !== 'lint'
    || !Array.isArray(handoff.completedSteps) || handoff.completedSteps.length !== 2
    || JSON.stringify(handoff.artifactBindings) !== JSON.stringify([{ stepId: 'lint', input: 1, sourceStepId: 'package' }])) {
    throw new TypeError('Installed handoff did not pause before the separately declared sharing review.');
  }
  await writeFile(handoffCheckpoint, JSON.stringify(handoff), { flag: 'wx', mode: 0o600 });
  const resumedHandoff = record(JSON.parse(await run([
    'workflow-run', 'evidence-handoff', 'Example review', '--resume', handoffCheckpoint, '--json',
  ], 'offline handoff checkpoint approval isolation')), 'Resumed handoff');
  if (resumedHandoff.state !== 'awaiting_review_confirmation' || !Array.isArray(resumedHandoff.reviewsConfirmedForThisRun)
    || resumedHandoff.reviewsConfirmedForThisRun.length !== 0) throw new TypeError('A handoff checkpoint granted a review confirmation.');
  const reviewedHandoff = record(JSON.parse(await run([
    'workflow-run', 'evidence-handoff', 'Example review', '--resume', handoffCheckpoint, '--confirm-review', 'lint', '--json',
  ], 'offline handoff completion')), 'Reviewed handoff');
  if (reviewedHandoff.state !== 'complete' || !Array.isArray(reviewedHandoff.completedSteps)
    || reviewedHandoff.completedSteps.length !== 3 || reviewedHandoff.networkApprovedForThisRun !== false) {
    throw new TypeError('Installed handoff did not finish offline after the selected review confirmation.');
  }
  await checkInstalledIntakeAndContext(repositoryRoot, temporaryRoot, run);
  await checkInstalledLocalMmdb(repositoryRoot, temporaryRoot, run);
  await checkInstalledDomainFeed(temporaryRoot, run);
}

/** Exercise the compiled reader's self-module worker without a database download. */
export async function checkInstalledLocalMmdb(repositoryRoot: string, temporaryRoot: string, run: RunInstalledCli): Promise<void> {
  const fixturePath = 'fixtures/mmdb/maxmind-db-test-data/GeoIP2-City-Test.mmdb';
  const fixture = await readBoundedRegularFileWithin(repositoryRoot, fixturePath, {
    maximumBytes: MAX_INVESTIGATION_RUN_BYTES, minimumBytes: 1, label: 'Pinned synthetic local database fixture',
  });
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const expectedDigest = 'ed972738e4e03a3e56e12041a6af4d91592249d110f7e4a647e5f2fa0e639c09';
  if (fixture.length !== 22569 || digest(fixture) !== expectedDigest) throw new TypeError('Installed local database check requires the exact pinned fixture.');
  // This exact fixture encodes build_epoch as four unsigned payload bytes.
  // Zeroing only that payload preserves tree offsets and makes stale admission
  // independent of the fixture's original date or a narrow current-age window.
  const buildField = Buffer.from('4b6275696c645f65706f636804026983ccf9', 'hex');
  const offset = fixture.indexOf(buildField);
  if (offset < 0 || offset !== fixture.lastIndexOf(buildField)) throw new TypeError('Pinned local database build field is not unique.');
  const staleFixture = Buffer.from(fixture);
  staleFixture.fill(0, offset + buildField.length - 4, offset + buildField.length);
  const staleDigest = '51bc8f456f02d3b9a19e5276a0f2ccbb2a844f0e477e8a2715d3e50f49a23844';
  if (digest(staleFixture) !== staleDigest) throw new TypeError('Synthetic stale database changed beyond its build epoch.');
  const selected = path.join(temporaryRoot, 'selected-local-database.mmdb');
  const staleSelected = path.join(temporaryRoot, 'stale-local-database.mmdb');
  await writeFile(selected, fixture, { flag: 'wx', mode: 0o600 });
  await writeFile(staleSelected, staleFixture, { flag: 'wx', mode: 0o600 });
  const declared = { schema: 'whoisleuth.local-mmdb-query', address: '81.2.69.142',
    sourceLabel: 'Pinned synthetic test database', databaseVersion: 'Declared fixture edition', license: 'MIT' };
  const input = { ...declared, version: 2,
    freshnessPolicy: { maxAgeDays: 3_000_000, rationale: 'Accept this pinned synthetic fixture for installed-code verification only; not a policy for operational attribution' } };
  for (const kind of ['current', 'stale', 'historical'] as const) {
    const queryPath = path.join(temporaryRoot, `local-database-${kind}.json`);
    const freshnessPolicy = kind === 'stale' ? { maxAgeDays: 1, rationale: 'Deliberately stale synthetic fixture for refusal verification' } : input.freshnessPolicy;
    const query = kind === 'historical' ? { ...declared, version: 1 } : { ...input, freshnessPolicy };
    await writeFile(queryPath, JSON.stringify(query), { flag: 'wx', mode: 0o600 });
    const output = await run(['review-evidence', queryPath, '--mmdb', kind === 'stale' ? staleSelected : selected, '--json', '--strict-exit'],
      `offline ${kind} local database review`, kind === 'stale' ? 4 : 0);
    if ([repositoryRoot, temporaryRoot, fixturePath].some(value => output.includes(value) || output.includes(JSON.stringify(value).slice(1, -1)))) {
      throw new TypeError('Installed local database review leaked a source path.');
    }
    const document = record(JSON.parse(output), 'Installed local database review');
    const result = record(document.result, 'Installed local database result');
    if (document.schema !== 'whoisleuth.cli.offline-evidence-review' || document.version !== 1 || document.kind !== 'geoip'
      || result.address !== input.address || record(result.source, 'Database source').version !== input.databaseVersion) {
      throw new TypeError('Installed local database review changed its envelope or declared source.');
    }
    if (kind === 'historical') {
      if (Object.keys(result).sort().join(',') !== 'address,limitations,match,source,state' || result.state !== 'matched'
        || record(result.match, 'Historical database match').network !== '81.2.69.142/31') {
        throw new TypeError('Installed historical local database shape changed.');
      }
      continue;
    }
    const database = record(result.database, 'Database identity'), metadata = record(database.metadata, 'Intrinsic metadata');
    const binary = record(metadata.binaryFormat, 'Database binary format'), freshness = record(result.freshness, 'Database freshness');
    if (result.schema !== 'whoisleuth.local-mmdb-review' || result.version !== 1 || database.byteLength !== 22569
      || database.sha256 !== (kind === 'stale' ? staleDigest : expectedDigest) || metadata.databaseType !== 'GeoIP2-City'
      || metadata.builtAt !== (kind === 'stale' ? '1970-01-01T00:00:00.000Z' : '2026-02-04T22:49:29.000Z')
      || binary.major !== 2 || binary.minor !== 0 || metadata.ipVersion !== 6 || freshness.checkedAt !== document.generatedAt
      || record(freshness.policy, 'Freshness policy').maxAgeDays !== freshnessPolicy.maxAgeDays
      || record(freshness.policy, 'Freshness policy').rationale !== freshnessPolicy.rationale) {
      throw new TypeError('Installed current local database identity or metadata changed.');
    }
    if (kind === 'stale') {
      if (result.state !== 'unavailable' || result.reason !== 'stale_database' || result.completeness !== 'unavailable'
        || result.match !== null || freshness.state !== 'stale') throw new TypeError('Installed stale local database review supplied attribution.');
    } else {
      const match = record(result.match, 'Current database match');
      if (result.state !== 'matched' || result.reason !== 'matched' || result.completeness !== 'complete' || freshness.state !== 'current'
        || match.network !== '81.2.69.142/31' || match.countryCode !== 'GB' || match.city !== 'London') {
        throw new TypeError('Installed current local database review lost its known synthetic match.');
      }
    }
  }
}

async function checkInstalledIntakeAndContext(repositoryRoot: string, temporaryRoot: string, run: RunInstalledCli): Promise<void> {
  const emailFile = path.join(temporaryRoot, 'selected-message.eml');
  await writeFile(emailFile, 'From: private-local-part@sender.example\r\nContent-Type: text/html\r\n\r\n<a href="https://destination.example/private?token=excluded-value">https://sender.example</a>', { flag: 'wx', mode: 0o600 });
  const intake = record(JSON.parse(await run(['intake', 'email', emailFile, '--reported-action', 'entered_password', '--json'], 'offline message and identity intake')), 'Installed intake');
  const links = intake.links;
  if (intake.schema !== 'whoisleuth.message-intake' || !Array.isArray(links) || links.length !== 2
    || record(links[0], 'Intake link').displayedDestination !== 'different_host'
    || JSON.stringify(intake).includes('excluded-value') || JSON.stringify(intake).includes('private-local-part')
    || !JSON.stringify(intake.identityRecovery).includes('entered_password')) throw new TypeError('Installed message intake lost its extraction or minimisation contract.');
  const symbol = new Encoder().encode(new Byte('https://qr.example/private?token=excluded-qr-value'));
  const width = (symbol.size + 8) * 4, pixels = new Uint8Array(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor(x / 4) - 4, sy = Math.floor(y / 4) - 4;
    const colour = sx >= 0 && sy >= 0 && sx < symbol.size && sy < symbol.size && symbol.get(sx, sy) ? 0 : 255;
    pixels.set([colour, colour, colour, 255], (y * width + x) * 4);
  }
  const qrFile = path.join(temporaryRoot, 'selected-qr.png');
  await writeFile(qrFile, encode({ width, height: width, data: pixels, channels: 4 }), { flag: 'wx', mode: 0o600 });
  const qr = record(JSON.parse(await run(['intake', 'qr', qrFile, '--json'], 'offline PNG QR intake')), 'Installed QR intake');
  if (!Array.isArray(qr.links) || qr.links.length !== 1 || record(qr.links[0], 'QR link').origin !== 'https://qr.example'
    || JSON.stringify(qr).includes('excluded-qr-value')) throw new TypeError('Installed PNG QR intake did not decode and minimise the selected image.');

  const caseExport = record(JSON.parse((await readBoundedRegularFileWithin(repositoryRoot, 'test/fixtures/case-lifecycle/case-export-v16.json', {
    maximumBytes: MAX_INVESTIGATION_RUN_BYTES, minimumBytes: 1, label: 'Current editable Case fixture',
  })).toString('utf8')), 'Current Case export');
  if (!Array.isArray(caseExport.cases) || !caseExport.cases.length) throw new TypeError('The package history fixture needs one retained Case.');
  const date = '2026-09-22T00:00:00.000Z';
  const storefront = (hostname: string) => ({ hostname, observedAt: date, source: 'Selected fixture', brandNames: ['Example shop'], contactDomains: [], policyHashes: [], checkoutOrigins: [], paymentMethods: ['card'], assetHashes: [] });
  const contexts = [
    { kind: 'domain_history', schema: 'whoisleuth.domain-history.input', evidence: { caseExport, caseId: record(caseExport.cases[0], 'Selected Case').id, declarations: { expectedChanges: [], retiredDependencies: [] } } },
    { kind: 'platform_continuity', schema: 'whoisleuth.platform-continuity.input', evidence: [{ platformOrigin: 'https://platform.example', objectType: 'extension', objectId: 'extension-17', version: '1.0.0', observedAt: date, source: 'Selected manifest', report: 'acknowledged', providerOutcome: 'provider_reports_resolved', recheck: 'still_observed', recheckedAt: date }] },
    { kind: 'storefront', schema: 'whoisleuth.storefront-review.input', evidence: { official: storefront('official.example'), candidate: storefront('candidate.example'), authorisedComparator: true, resellerStatus: 'unknown', resellerSource: null } },
    { kind: 'connector', schema: 'whoisleuth.connector-review.input', evidence: { current: { servers: { selected: { url: 'https://connector.example/private?token=excluded-connector-value', headers: { Authorization: 'excluded-auth-value' } } } }, previous: null } },
    { kind: 'incident_sequence', schema: 'whoisleuth.incident-sequence.input', evidence: [{ id: 'stage-1', kind: 'credential_entry', basis: 'reported_action', description: 'The reporter described entering a password.', occurredAt: null, hostname: 'example.test', source: 'Selected interview', reference: 'interview-17', referenceSha256: null, completeness: 'unknown', limitations: [] }] },
  ];
  for (const context of contexts) {
    const selected = path.join(temporaryRoot, `${context.kind}.json`);
    await writeFile(selected, JSON.stringify({ schema: context.schema, version: 1, evidence: context.evidence }), { flag: 'wx', mode: 0o600 });
    const output = record(JSON.parse(await run(['review-evidence', selected, '--json'], `offline ${context.kind} review`)), 'Installed context review');
    const result = record(output.result, 'Context result');
    if (output.kind !== context.kind || result.kind !== context.kind || result.schema !== 'whoisleuth.context-review'
      || !Array.isArray(result.observations) || !['reviewed', 'partial'].includes(String(result.state))
      || /excluded-connector-value|excluded-auth-value/u.test(JSON.stringify(output))) throw new TypeError('Installed contextual review changed its evidence or privacy contract.');
    if (context.kind === 'incident_sequence') {
      if (record(result.observations[0], 'Incident observation').observedAt !== null) throw new TypeError('Installed incident review invented an event time.');
      await run(['review-evidence', selected, '--json', '--strict-exit'], 'offline partial incident exit', 4);
    }
  }
}
