import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePrivateFile } from '../cli/output-file.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { MAX_KEV_SOURCE_BYTES, parseKevSource } from '../lib/cisa-kev-source.mts';
import { prepareRetainedSourceData } from '../lib/retained-source-data.mts';
import { MAX_SSLBL_SOURCE_BYTES, buildSslblSnapshotData, parseSslblCertificateCsv } from '../lib/sslbl-source.mts';
import { parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { MAX_SNAPSHOT_BYTES } from '../packages/contracts/common-infrastructure.mts';
import { encodeRetainedSourceEdition, isRetainedSourceId } from '../packages/evidence/retained-source-edition.mts';
import { admitInfrastructureEdition } from '../packages/relationships/infrastructure-edition.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { buildCommonInfrastructureSnapshot } from './common-infrastructure-snapshot.mts';
import {
  MAX_IANA_SOURCE_BYTES, MAX_ICANN_SOURCE_BYTES,
  buildRegistrarStandingSnapshot, parseIcannComplianceNotices, parseIanaRegistrarCsv,
} from './registrar-standing-catalogue.mts';

const USAGE = [
  'npm run sources:prepare -- sslbl <new output.json> <certificate CSV>',
  'npm run sources:prepare -- kev <new output.json> <catalogue JSON>',
  'npm run sources:prepare -- registrar <new output.json> <IANA CSV> <ICANN HTML> <observed-at ISO timestamp>',
  'npm run sources:prepare -- infrastructure <new output.json> <reviewed snapshot JSON>',
  'npm run sources:prepare -- infrastructure <new output.json> --upstream <reviewed full commit SHA>',
].join('\n');
const read = (path: string, maximumBytes: number) => readBoundedRegularTextFile(path, { minimumBytes: 1, maximumBytes, label: 'Source input' });

export async function prepareSourceEdition(args: readonly string[], now = new Date()) {
  const [source, output, input, second, observedAt] = args;
  if (!isRetainedSourceId(source) || !output || !input) throw new TypeError(USAGE);
  const generatedAt = now.toISOString();
  let projection: unknown;
  if (source === 'registrar' && args.length === 5 && second && observedAt) {
    const ianaObservedAt = normalizeExplicitIsoTimestamp(observedAt);
    if (ianaObservedAt === null) throw new TypeError('Provide the actual source observation time with an explicit timezone.');
    const catalogueYear = new Date(ianaObservedAt).getUTCFullYear();
    const [csv, html] = await Promise.all([read(input, MAX_IANA_SOURCE_BYTES), read(second, MAX_ICANN_SOURCE_BYTES)]);
    projection = buildRegistrarStandingSnapshot({
      registrarRows: parseIanaRegistrarCsv(csv),
      notices: parseIcannComplianceNotices(html, catalogueYear),
    }, { generatedAt, ianaObservedAt, catalogueYear });
  } else if (source === 'sslbl' && args.length === 3) {
    projection = buildSslblSnapshotData(parseSslblCertificateCsv(await read(input, MAX_SSLBL_SOURCE_BYTES)), generatedAt);
  } else if (source === 'kev' && args.length === 3) {
    projection = parseKevSource(await read(input, MAX_KEV_SOURCE_BYTES));
  } else if (source === 'infrastructure' && input === '--upstream' && args.length === 4 && second) {
    projection = await buildCommonInfrastructureSnapshot(second, { now: () => now });
  } else if (source === 'infrastructure' && args.length === 3) {
    projection = parseBoundedJsonObject(await read(input, MAX_SNAPSHOT_BYTES), {
      maximumBytes: MAX_SNAPSHOT_BYTES, label: 'Infrastructure snapshot',
    });
  } else {
    throw new TypeError(USAGE);
  }
  const edition = source === 'infrastructure'
    ? await encodeRetainedSourceEdition(source, projection)
    : await prepareRetainedSourceData(source, projection, now);
  if (source === 'infrastructure' && !admitInfrastructureEdition(projection, now).current) {
    throw new TypeError('Infrastructure edition is outside its review window.');
  }
  await writePrivateFile(output, edition.text);
  return { source, digest: edition.digest, bytes: Buffer.byteLength(edition.text) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    console.log(JSON.stringify(await prepareSourceEdition(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Source edition preparation failed.');
    process.exitCode = 2;
  }
}
