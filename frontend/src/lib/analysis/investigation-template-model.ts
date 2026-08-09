import {
  INVESTIGATION_RECIPES,
  normalizeInvestigationGuideTemplateSnapshot,
  type InvestigationGuideTemplateSnapshot,
  type InvestigationRecipeId,
} from './investigation-guide.ts';

export const INVESTIGATION_TEMPLATE_SCHEMA = 'whoisleuth.investigation-templates';
export const INVESTIGATION_TEMPLATE_VERSION = 2;
export const INVESTIGATION_TEMPLATE_SUPPORTED_VERSIONS = [1, INVESTIGATION_TEMPLATE_VERSION] as const;
export const MAX_INVESTIGATION_TEMPLATES = 20;
export const MAX_INVESTIGATION_TEMPLATE_STORE_BYTES = 256 * 1024;
export const MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES = 384 * 1024;

export interface InvestigationTemplate extends InvestigationGuideTemplateSnapshot {
  createdAt: string;
  updatedAt: string;
}

type UnknownRecord = Record<string, unknown>;
const CONTROL_RE = /[\x00-\x1f\x7f]/u;
const LEGACY_RECIPE_IDS = new Set<InvestigationRecipeId>(['brand_sweep', 'infrastructure_pivot', 'new_domain_triage']);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function template(raw: unknown, sourceVersion: number = INVESTIGATION_TEMPLATE_VERSION): InvestigationTemplate | null {
  const value = record(raw);
  const snapshot = normalizeInvestigationGuideTemplateSnapshot(value);
  const createdAt = timestamp(value?.createdAt);
  const updatedAt = timestamp(value?.updatedAt);
  return snapshot && createdAt && updatedAt && (sourceVersion !== 1 || LEGACY_RECIPE_IDS.has(snapshot.recipeId))
    ? { ...snapshot, createdAt, updatedAt }
    : null;
}

export function normalizeInvestigationTemplate(raw: unknown): InvestigationTemplate | null {
  return template(raw);
}

export function normalizeInvestigationTemplateStore(raw: unknown) {
  const value = record(raw);
  if (value?.schema === INVESTIGATION_TEMPLATE_SCHEMA
    && Number(value.version) > INVESTIGATION_TEMPLATE_VERSION) {
    throw new Error('This investigation-template collection uses a newer schema and cannot be read safely.');
  }
  const sourceVersion = Array.isArray(raw) ? INVESTIGATION_TEMPLATE_VERSION : Number(value?.version) || INVESTIGATION_TEMPLATE_VERSION;
  const source = Array.isArray(raw) ? raw : Array.isArray(value?.templates) ? value.templates : [];
  const templates: InvestigationTemplate[] = [];
  const seen = new Set<string>();
  for (const candidate of source.slice(0, MAX_INVESTIGATION_TEMPLATES * 2)) {
    const normalized = template(candidate, sourceVersion);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    templates.push(normalized);
  }
  templates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    schema: INVESTIGATION_TEMPLATE_SCHEMA,
    version: INVESTIGATION_TEMPLATE_VERSION,
    templates: templates.slice(0, MAX_INVESTIGATION_TEMPLATES),
  };
}

export function investigationTemplateStoreVersion(raw: unknown): number {
  const value = record(raw);
  return Number.isSafeInteger(value?.version) ? Number(value?.version) : INVESTIGATION_TEMPLATE_VERSION;
}

export function serializeInvestigationTemplateStore(raw: unknown): string {
  const serialized = JSON.stringify(normalizeInvestigationTemplateStore(raw));
  if (byteLength(serialized) > MAX_INVESTIGATION_TEMPLATE_STORE_BYTES) {
    throw new Error('Investigation templates exceed the 256 KiB browser-local limit.');
  }
  return serialized;
}

export function createInvestigationTemplate(
  raw: unknown,
  options: {
    now?: string;
    makeId?: () => string;
  } = {},
): InvestigationTemplate {
  const value = record(raw);
  const now = timestamp(options.now ?? new Date().toISOString());
  const recipeId = value?.recipeId as InvestigationRecipeId;
  const recipe = INVESTIGATION_RECIPES.find((candidate) => candidate.id === recipeId);
  const id = typeof value?.id === 'string' && value.id
    ? value.id
    : (options.makeId ?? (() => crypto.randomUUID()))();
  const createdAt = timestamp(value?.createdAt) || now;
  const candidate = normalizeInvestigationTemplate({
    ...value,
    id,
    recipeId: recipe?.id,
    createdAt,
    updatedAt: now,
  });
  if (!candidate) throw new Error('The investigation template is incomplete or invalid.');
  return candidate;
}

export function saveInvestigationTemplate(localRaw: unknown, candidateRaw: unknown) {
  const candidate = normalizeInvestigationTemplate(candidateRaw);
  if (!candidate) throw new Error('The investigation template is incomplete or invalid.');
  const local = normalizeInvestigationTemplateStore(localRaw).templates;
  return normalizeInvestigationTemplateStore([
    candidate,
    ...local.filter((item) => item.id !== candidate.id),
  ]).templates;
}

export function deleteInvestigationTemplate(localRaw: unknown, id: string) {
  return normalizeInvestigationTemplateStore(localRaw).templates.filter((item) => item.id !== id);
}

export function buildInvestigationTemplateExport(raw: unknown, generatedAt = new Date().toISOString()) {
  return {
    ...normalizeInvestigationTemplateStore(raw),
    generatedAt: timestamp(generatedAt) || new Date().toISOString(),
    limitations: [
      'Templates contain allowlisted WHOISleuth tool steps and analyst-authored guidance only.',
      'A template cannot run code, start collection, submit evidence, change a case, or bypass a required request approval gate.',
      'Workflow outcomes are analyst progress markers and are not findings about a target.',
    ],
  };
}

function strictImport(raw: unknown) {
  const value = record(raw);
  if (value?.schema !== INVESTIGATION_TEMPLATE_SCHEMA || !Number.isSafeInteger(value.version)) {
    throw new Error('Expected a versioned WHOISleuth investigation-template export.');
  }
  if (Number(value.version) > INVESTIGATION_TEMPLATE_VERSION) {
    throw new Error('This investigation-template export uses a newer schema and cannot be imported safely.');
  }
  if (!(INVESTIGATION_TEMPLATE_SUPPORTED_VERSIONS as readonly number[]).includes(Number(value.version))) {
    throw new Error(`Expected investigation-template schema 1 or ${INVESTIGATION_TEMPLATE_VERSION}.`);
  }
  return normalizeInvestigationTemplateStore(value).templates;
}

export function mergeInvestigationTemplates(localRaw: unknown, incomingRaw: unknown) {
  const local = normalizeInvestigationTemplateStore(localRaw).templates;
  const incoming = strictImport(incomingRaw);
  const byId = new Map(local.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    if (byId.has(item.id)) updated += 1;
    else added += 1;
    byId.set(item.id, item);
  }
  const templates = normalizeInvestigationTemplateStore([...byId.values()]).templates;
  return {
    templates,
    added,
    updated,
    skipped: Math.max(0, incoming.length - added - updated),
    pruned: Math.max(0, byId.size - templates.length),
  };
}
