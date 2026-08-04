#!/usr/bin/env node

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SERVICE_DEPENDENCY_SIGNATURES,
  SERVICE_DEPENDENCY_SIGNATURE_CATALOG_DIGEST_SHA256,
  SERVICE_DEPENDENCY_SIGNATURE_MAX_AGE_DAYS,
  type ServiceDependencySignature,
} from '../frontend/src/lib/analysis/service-dependency-review.ts';

export const SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA = 'whoisleuth.service-dependency-signature-audit';
export const SERVICE_DEPENDENCY_SIGNATURE_AUDIT_VERSION = 1;

type AuditFinding = Readonly<{
  id: string;
  state: 'current' | 'stale' | 'invalid';
  ageDays: number | null;
  issues: readonly string[];
}>;

type AuditOptions = Readonly<{
  signatures?: readonly ServiceDependencySignature[];
  expectedDigestSha256?: string;
  now?: () => Date;
}>;

type WritableLike = { write(value: string): unknown };

function canonical(signatures: readonly ServiceDependencySignature[]): string {
  return JSON.stringify(signatures.map((signature) => ({
    id: signature.id,
    label: signature.label,
    targetSuffixes: [...signature.targetSuffixes],
    evidenceTypes: [...(signature.evidenceTypes ?? [])],
    source: signature.source ?? null,
    license: signature.license ?? null,
    sourceDate: signature.sourceDate ?? null,
    reviewedAt: signature.reviewedAt ?? null,
    provenance: signature.provenance ?? null,
    deprovisionPageTitles: [...(signature.deprovisionPageTitles ?? [])],
  })));
}

export function calculateServiceDependencySignatureDigest(
  signatures: readonly ServiceDependencySignature[] = SERVICE_DEPENDENCY_SIGNATURES,
): string {
  return createHash('sha256').update(canonical(signatures), 'utf8').digest('hex');
}

export function auditServiceDependencySignatures(options: AuditOptions = {}) {
  const signatures = options.signatures ?? SERVICE_DEPENDENCY_SIGNATURES;
  const expectedDigestSha256 = options.expectedDigestSha256 ?? SERVICE_DEPENDENCY_SIGNATURE_CATALOG_DIGEST_SHA256;
  const calculatedDigestSha256 = calculateServiceDependencySignatureDigest(signatures);
  const now = (options.now ?? (() => new Date()))();
  const ids = new Set<string>();
  const suffixes = new Set<string>();
  const findings: AuditFinding[] = [];
  for (const signature of signatures) {
    const issues: string[] = [];
    const id = typeof signature.id === 'string' ? signature.id.trim() : '';
    if (!id || ids.has(id)) issues.push(!id ? 'Missing bounded identifier.' : 'Duplicate identifier.');
    if (id) ids.add(id);
    if (!signature.label?.trim()) issues.push('Missing label.');
    if (!signature.targetSuffixes.length) issues.push('Missing target suffix.');
    for (const suffix of signature.targetSuffixes) {
      const normalized = suffix.toLowerCase();
      if (suffixes.has(normalized)) issues.push(`Duplicate target suffix ${normalized}.`);
      suffixes.add(normalized);
    }
    if (!signature.evidenceTypes?.includes('dns_target_suffix')) issues.push('DNS target-suffix evidence type is not declared.');
    if (!signature.source?.trim()) issues.push('Source is not declared.');
    if (!signature.license?.trim()) issues.push('License treatment is not declared.');
    const sourceDate = typeof signature.sourceDate === 'string' && Number.isFinite(Date.parse(signature.sourceDate))
      ? Date.parse(signature.sourceDate)
      : Number.NaN;
    if (!Number.isFinite(sourceDate)) issues.push('Source date is invalid or missing.');
    const ageDays = Number.isFinite(sourceDate)
      ? Math.max(0, Math.floor((now.getTime() - sourceDate) / 86_400_000))
      : null;
    findings.push(Object.freeze({
      id: id || 'invalid',
      state: issues.length ? 'invalid' : (ageDays ?? 0) > SERVICE_DEPENDENCY_SIGNATURE_MAX_AGE_DAYS ? 'stale' : 'current',
      ageDays,
      issues: Object.freeze(issues),
    }));
  }
  const invalid = findings.filter((finding) => finding.state === 'invalid').length;
  const stale = findings.filter((finding) => finding.state === 'stale').length;
  const digestMatches = /^[a-f0-9]{64}$/u.test(expectedDigestSha256)
    && calculatedDigestSha256 === expectedDigestSha256;
  return Object.freeze({
    schema: SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA,
    version: SERVICE_DEPENDENCY_SIGNATURE_AUDIT_VERSION,
    generatedAt: now.toISOString(),
    status: invalid || !digestMatches ? 'invalid' : stale ? 'stale' : 'current',
    signatureCount: signatures.length,
    targetSuffixCount: suffixes.size,
    maxAgeDays: SERVICE_DEPENDENCY_SIGNATURE_MAX_AGE_DAYS,
    expectedDigestSha256,
    calculatedDigestSha256,
    digestMatches,
    summary: Object.freeze({
      current: findings.filter((finding) => finding.state === 'current').length,
      stale,
      invalid,
    }),
    findings: Object.freeze(findings),
    limitations: Object.freeze([
      'The audit validates local signature metadata and freshness only. It does not contact a service, resolve a target, test an account, or assess claimability.',
      'A current signature identifies a reviewed routing pattern, not whether an observed dependency is assigned, abandoned, vulnerable, safe, or controlled.',
      'Provider behaviour changes require benign and ambiguous fixtures plus manual review before the digest is updated.',
    ]),
  });
}

function format(report: ReturnType<typeof auditServiceDependencySignatures>): string {
  const lines = [
    'WHOISleuth service-dependency signature audit',
    `Status: ${report.status}`,
    `Signatures: ${report.signatureCount}; target suffixes: ${report.targetSuffixCount}`,
    `Digest: ${report.digestMatches ? 'current' : 'mismatch'}`,
    `Freshness: ${report.summary.current} current, ${report.summary.stale} stale, ${report.summary.invalid} invalid`,
  ];
  for (const finding of report.findings.filter((item) => item.state !== 'current')) {
    lines.push(`${finding.state.toUpperCase()} ${finding.id}: ${finding.issues.join(' ') || `${finding.ageDays} days old.`}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main(
  args = process.argv.slice(2),
  options: Readonly<{ stdout?: WritableLike; stderr?: WritableLike; now?: () => Date }> = {},
): Promise<number> {
  try {
    const json = args.includes('--json');
    const printDigest = args.includes('--print-digest');
    if (args.some((argument) => !['--json', '--print-digest'].includes(argument)) || (json && printDigest)) {
      throw new TypeError('Use either --json or --print-digest.');
    }
    if (printDigest) {
      (options.stdout ?? process.stdout).write(`${calculateServiceDependencySignatureDigest()}\n`);
      return 0;
    }
    const report = auditServiceDependencySignatures(options.now ? { now: options.now } : {});
    (options.stdout ?? process.stdout).write(json ? `${JSON.stringify(report, null, 2)}\n` : format(report));
    return report.status === 'current' ? 0 : 1;
  } catch (cause) {
    (options.stderr ?? process.stderr).write(`${cause instanceof Error ? cause.message : 'Signature audit failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}

export { format, main };
