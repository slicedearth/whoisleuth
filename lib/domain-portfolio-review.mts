import { domainToASCII } from 'node:url';

import { exactKeys } from './bounded-contract-normalizers.mts';

export const DOMAIN_PORTFOLIO_INPUT_SCHEMA = 'whoisleuth.domain-portfolio.input';
export const DOMAIN_PORTFOLIO_REVIEW_SCHEMA = 'whoisleuth.domain-portfolio.review';
export const DOMAIN_PORTFOLIO_REVIEW_VERSION = 1;
export const MAX_PORTFOLIO_ASSETS = 500;

type UnknownRecord = Record<string, unknown>;
type DependencyType = 'certificate' | 'dns' | 'mail' | 'recovery' | 'registrar';

const ROOT_KEYS = new Set(['schema', 'version', 'portfolioLabel', 'assets']);
const ASSET_KEYS = new Set([
  'domain', 'criticality', 'registrar', 'registrarAccount', 'expiresAt', 'autoRenew', 'dnsProviders', 'mailProviders',
  'certificateProviders', 'recoveryDomains', 'reviewedAt',
]);

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as UnknownRecord;
}

function text(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text.`);
  const normalised = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!normalised || normalised.length > maximum) throw new TypeError(`${label} must contain from 1 to ${maximum} characters.`);
  return normalised;
}

function optionalText(value: unknown, label: string, maximum = 160): string | null {
  if (value === null || value === undefined || value === '') return null;
  return text(value, label, maximum);
}

function timestamp(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === '')) return null;
  const parsed = Date.parse(text(value, label, 64));
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function domain(value: unknown, label: string): string {
  const normalised = text(value, label, 253).toLowerCase().replace(/\.$/u, '');
  const ascii = domainToASCII(normalised);
  if (!ascii || !ascii.includes('.') || ascii.length > 253 || ascii.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))) {
    throw new TypeError(`${label} must be a valid domain name.`);
  }
  return ascii;
}

function textList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 16) throw new TypeError(`${label} must contain no more than 16 labels.`);
  return [...new Set(value.map((item, index) => text(item, `${label}[${index}]`, 120)))].sort();
}

function domainList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 16) throw new TypeError(`${label} must contain no more than 16 domains.`);
  return [...new Set(value.map((item, index) => domain(item, `${label}[${index}]`)))].sort();
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be true, false, or null.`);
  return value;
}

export function reviewDomainPortfolio(inputRaw: unknown, generatedAtValue = new Date().toISOString()) {
  const input = record(inputRaw, 'Domain portfolio input');
  if (input.schema !== DOMAIN_PORTFOLIO_INPUT_SCHEMA || input.version !== 1) throw new TypeError(`Domain portfolio input must use ${DOMAIN_PORTFOLIO_INPUT_SCHEMA} version 1.`);
  exactKeys(input, ROOT_KEYS, 'Domain portfolio input');
  if (!Array.isArray(input.assets) || input.assets.length < 1 || input.assets.length > MAX_PORTFOLIO_ASSETS) {
    throw new TypeError(`Domain portfolio input must contain from 1 to ${MAX_PORTFOLIO_ASSETS} assets.`);
  }
  const portfolioLabel = text(input.portfolioLabel, 'portfolioLabel', 120);
  const assets = input.assets.map((raw, index) => {
    const item = record(raw, `assets[${index}]`);
    exactKeys(item, ASSET_KEYS, `assets[${index}]`);
    const criticality = item.criticality;
    if (criticality !== 'low' && criticality !== 'standard' && criticality !== 'high' && criticality !== 'critical') {
      throw new TypeError(`assets[${index}].criticality is unsupported.`);
    }
    return Object.freeze({
      domain: domain(item.domain, `assets[${index}].domain`),
      criticality,
      registrar: optionalText(item.registrar, `assets[${index}].registrar`, 120),
      registrarAccount: optionalText(item.registrarAccount, `assets[${index}].registrarAccount`, 120),
      expiresAt: timestamp(item.expiresAt, `assets[${index}].expiresAt`, true),
      autoRenew: nullableBoolean(item.autoRenew, `assets[${index}].autoRenew`),
      dnsProviders: Object.freeze(textList(item.dnsProviders ?? [], `assets[${index}].dnsProviders`)),
      mailProviders: Object.freeze(textList(item.mailProviders ?? [], `assets[${index}].mailProviders`)),
      certificateProviders: Object.freeze(textList(item.certificateProviders ?? [], `assets[${index}].certificateProviders`)),
      recoveryDomains: Object.freeze(domainList(item.recoveryDomains ?? [], `assets[${index}].recoveryDomains`)),
      reviewedAt: timestamp(item.reviewedAt, `assets[${index}].reviewedAt`),
    });
  }).sort((left, right) => left.domain.localeCompare(right.domain));
  if (new Set(assets.map((asset) => asset.domain)).size !== assets.length) throw new TypeError('Domain portfolio assets must use unique domains.');

  const dependencyRows: Array<{ type: DependencyType; provider: string; domain: string; critical: boolean }> = [];
  for (const asset of assets) {
    const critical = asset.criticality === 'critical' || asset.criticality === 'high';
    if (asset.registrar) dependencyRows.push({ type: 'registrar', provider: asset.registrar, domain: asset.domain, critical });
    for (const provider of asset.dnsProviders) dependencyRows.push({ type: 'dns', provider, domain: asset.domain, critical });
    for (const provider of asset.mailProviders) dependencyRows.push({ type: 'mail', provider, domain: asset.domain, critical });
    for (const provider of asset.certificateProviders) dependencyRows.push({ type: 'certificate', provider, domain: asset.domain, critical });
    for (const provider of asset.recoveryDomains) dependencyRows.push({ type: 'recovery', provider, domain: asset.domain, critical });
  }
  const grouped = new Map<string, typeof dependencyRows>();
  for (const row of dependencyRows) {
    const key = `${row.type}\u0000${row.provider.toLowerCase()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const simulations = [...grouped.values()].map((rows) => Object.freeze({
    dependencyType: rows[0]!.type,
    provider: rows[0]!.provider,
    affectedDomains: Object.freeze([...new Set(rows.map((row) => row.domain))].sort()),
    affectedCriticalDomains: Object.freeze([...new Set(rows.filter((row) => row.critical).map((row) => row.domain))].sort()),
    share: Math.round((new Set(rows.map((row) => row.domain)).size / assets.length) * 1000) / 10,
  })).sort((left, right) => (
    right.affectedDomains.length - left.affectedDomains.length
    || left.dependencyType.localeCompare(right.dependencyType)
    || left.provider.localeCompare(right.provider)
  ));
  const now = Date.parse(timestamp(generatedAtValue, 'generatedAt') as string);
  const renewalQueue = assets.flatMap((asset) => {
    const expiry = asset.expiresAt ? Date.parse(asset.expiresAt) : Number.NaN;
    const days = Number.isFinite(expiry) ? Math.ceil((expiry - now) / 86_400_000) : null;
    const reasons = [
      ...(days === null ? ['Expiry is unavailable.'] : days <= 90 ? [`Expiry is ${days < 0 ? `${Math.abs(days)} days overdue` : `due in ${days} days`}.`] : []),
      ...(asset.autoRenew === false ? ['Auto-renew is recorded as disabled.'] : asset.autoRenew === null ? ['Auto-renew state is unavailable.'] : []),
      ...(!asset.registrarAccount ? ['Registrar account label is unavailable.'] : []),
    ];
    return reasons.length ? [Object.freeze({ domain: asset.domain, criticality: asset.criticality, expiresAt: asset.expiresAt, daysUntilExpiry: days, reasons: Object.freeze(reasons) })] : [];
  }).sort((left, right) => (
    (left.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER) - (right.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER)
    || left.domain.localeCompare(right.domain)
  ));
  const owned = new Set(assets.map((asset) => asset.domain));
  const recoveryCycles = assets.flatMap((asset) => asset.recoveryDomains
    .filter((recoveryDomain) => owned.has(recoveryDomain))
    .map((recoveryDomain) => Object.freeze({
      protectedDomain: asset.domain,
      recoveryDomain,
      reciprocal: assets.find((candidate) => candidate.domain === recoveryDomain)?.recoveryDomains.includes(asset.domain) ?? false,
    })));
  const unknownCounts = Object.freeze({
    registrar: assets.filter((asset) => !asset.registrar).length,
    registrarAccount: assets.filter((asset) => !asset.registrarAccount).length,
    expiry: assets.filter((asset) => !asset.expiresAt).length,
    autoRenew: assets.filter((asset) => asset.autoRenew === null).length,
    dns: assets.filter((asset) => !asset.dnsProviders.length).length,
    mail: assets.filter((asset) => !asset.mailProviders.length).length,
    certificate: assets.filter((asset) => !asset.certificateProviders.length).length,
    recovery: assets.filter((asset) => !asset.recoveryDomains.length).length,
  });
  return Object.freeze({
    schema: DOMAIN_PORTFOLIO_REVIEW_SCHEMA,
    version: DOMAIN_PORTFOLIO_REVIEW_VERSION,
    generatedAt: new Date(now).toISOString(),
    portfolioLabel,
    assets: Object.freeze(assets),
    simulations: Object.freeze(simulations),
    renewalQueue: Object.freeze(renewalQueue),
    recoveryCycles: Object.freeze(recoveryCycles),
    unknownCounts,
    limitations: Object.freeze([
      'This local review uses analyst-supplied portfolio assertions and makes no registrar, DNS, mail, certificate, account, or recovery request.',
      'Provider and account labels are not proof of current configuration, ownership, control, availability, or contractual responsibility.',
      'Failure simulations show exact supplied dependency concentration only; they do not predict an outage or establish that providers share infrastructure.',
      'Do not include credentials, recovery codes, personal contact details, account identifiers, or other secrets in this input.',
    ]),
  });
}
