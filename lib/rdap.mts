// RDAP: IANA bootstrap registry lookup (https://data.iana.org/rdap/) and
// response parsing. Shared by the Express server and the Netlify Functions.

import net from 'node:net';

import { registryDateIso } from './registry-dates.mts';
import {
  BOOTSTRAP_STALE_TTL_MS,
  BOOTSTRAP_TTL_MS,
  clearRdapBootstrapCache,
  fetchBootstrap,
  findRdapBases,
  uniqueRdapBases as uniqueBases,
} from './rdap-bootstrap.mts';
import {
  fetchRdapFromBasesWithParser,
  fetchRdapRecordWithParser,
} from './rdap-client.mts';
import {
  fetchRegistrarRdapRecordWithParser,
  selectRegistrarRdapLink,
} from './rdap-registrar.mts';
import {
  fetchRdapWithTimeout,
  type RdapFetch,
} from './rdap-transport.mts';
import {
  type LooseRdapRecord,
  type NormalizedRdapAutnumRecord,
  type NormalizedRdapDomainRecord,
  type NormalizedRdapDsData,
  type NormalizedRdapEvent,
  type NormalizedRdapLink,
  type NormalizedRdapNetworkRecord,
  type NormalizedRdapPublicId,
  type NormalizedRdapRecord,
  type NormalizedRdapRecordFor,
  type NormalizedRdapRedaction,
  type NormalizedRdapTextBlock,
  type NormalizedRdapVariant,
  type RdapEntitySummary,
  type RegistryRdapLinkSource,
} from './rdap-types.mts';

type LooseRecord = LooseRdapRecord;
type EntitySummary = RdapEntitySummary;

const MAX_RDAP_ENTITIES = 100;
const MAX_RDAP_ENTITY_DEPTH = 6;
const MAX_ENTITIES_PER_ROLE = 5;
const MAX_VCARD_ENTRIES = 100;
const MAX_ENTITY_ROLES = 12;
const MAX_CONTACT_VALUES = 8;
const MAX_ENTITY_LINKS = 10;
const MAX_RDAP_LINKS = 20;
const MAX_RDAP_REDACTIONS = 100;
const MAX_RDAP_VARIANT_GROUPS = 20;
const MAX_RDAP_VARIANT_NAMES = 50;
const MAX_RDAP_SERVER_TRUNCATION_REASONS = 8;
const RDAP_SERVER_TRUNCATION_TYPES = new Set([
  'result set truncated due to authorization',
  'result set truncated due to excessive load',
  'result set truncated due to unexplainable reasons',
  'object truncated due to authorization',
  'object truncated due to excessive load',
  'object truncated due to unexplainable reasons',
  // RFC 9083 erratum 7986 corrects this registered value to singular.
  'object truncated due to unexplainable reason',
]);
const RDAP_CONTACT_ROLES = new Set([
  'registrar', 'registrant', 'administrative', 'technical', 'billing', 'abuse', 'noc',
  'reseller', 'sponsor', 'proxy', 'notifications',
]);

// ---------------------------------------------------------------------------
// RDAP response parsing (turns the raw JSON into a readable summary)
// ---------------------------------------------------------------------------

function boundedString(value: unknown, maxLength: number, { lower = false }: { lower?: boolean } = {}): string | null {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return lower ? normalized.toLowerCase() : normalized;
}

function boundedInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
    ? value as number
    : null;
}

function truncatedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength).trim() || null;
}

function flattenScalarValues(value: unknown, maxValues = 32): string[] {
  const output: string[] = [];
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length && output.length < maxValues && visited < 128) {
    const current = stack.pop();
    if (!current) continue;
    visited += 1;
    if (Array.isArray(current.value)) {
      if (current.depth >= MAX_RDAP_ENTITY_DEPTH) continue;
      for (let i = Math.min(current.value.length, maxValues) - 1; i >= 0; i -= 1) {
        stack.push({ value: current.value[i], depth: current.depth + 1 });
      }
    } else if (typeof current.value === 'string') {
      output.push(current.value);
    } else if (typeof current.value === 'number' && Number.isFinite(current.value)) {
      output.push(String(current.value));
    }
  }
  return output;
}

function vcardRawValues(vcardArray: unknown, field: string): unknown[] {
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return [];
  return vcardArray[1]
    .slice(0, MAX_VCARD_ENTRIES)
    .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].toLowerCase() === field)
    .map((entry) => entry[3]);
}

function normalizeContactValues(
  vcardArray: unknown,
  field: string,
  maxLength: number,
  { lower = false }: { lower?: boolean } = {},
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const raw of vcardRawValues(vcardArray, field)) {
    for (const scalar of flattenScalarValues(raw, MAX_CONTACT_VALUES)) {
      const normalized = boundedString(scalar, maxLength, { lower });
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(normalized);
      if (values.length >= MAX_CONTACT_VALUES) return values;
    }
  }
  return values;
}

function normalizeAddresses(vcardArray: unknown): string[] {
  const addresses: string[] = [];
  const seen = new Set<string>();
  for (const raw of vcardRawValues(vcardArray, 'adr')) {
    const parts = flattenScalarValues(raw, 32)
      .map((part) => boundedString(part, 300))
      .filter(Boolean);
    const address = boundedString(parts.join(', '), 1000);
    if (!address || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    addresses.push(address);
    if (addresses.length >= MAX_CONTACT_VALUES) break;
  }
  return addresses;
}

function contactValuesTruncated(vcardArray: unknown): boolean {
  for (const field of ['fn', 'org', 'email', 'tel']) {
    let count = 0;
    for (const raw of vcardRawValues(vcardArray, field)) {
      count += flattenScalarValues(raw, MAX_CONTACT_VALUES + 1).length;
      if (count > MAX_CONTACT_VALUES) return true;
    }
  }
  return vcardRawValues(vcardArray, 'adr').length > MAX_CONTACT_VALUES;
}

function normalizeLinks(links: unknown, maxLinks = MAX_RDAP_LINKS) {
  if (!Array.isArray(links)) return [];
  const normalized: Array<{ rel: string | null; href: string; type: string | null; title: string | null }> = [];
  for (const linkValue of links.slice(0, 100)) {
    if (!linkValue || typeof linkValue !== 'object' || Array.isArray(linkValue)) continue;
    const link = linkValue as LooseRecord;
    const href = boundedString(link.href, 2048);
    if (!href) continue;
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    } catch {
      continue;
    }
    normalized.push({
      rel: boundedString(link.rel, 100, { lower: true }),
      href,
      type: boundedString(link.type, 160, { lower: true }),
      title: boundedString(link.title, 300),
    });
    if (normalized.length >= maxLinks) break;
  }
  return normalized;
}

function normalizePublicIds(publicIds: unknown) {
  if (!Array.isArray(publicIds)) return [];
  const normalized: Array<{ type: string; identifier: string }> = [];
  for (const itemValue of publicIds.slice(0, 100)) {
    if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) continue;
    const item = itemValue as LooseRecord;
    const type = boundedString(item.type, 160);
    const identifier = boundedString(item.identifier, 300);
    if (!type || !identifier) continue;
    normalized.push({ type, identifier });
    if (normalized.length >= 20) break;
  }
  return normalized;
}

function normalizeStringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
  { lower = false }: { lower?: boolean } = {},
): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, Math.max(maxItems * 4, maxItems))) {
    const normalized = boundedString(item, maxLength, { lower });
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function redactionLabel(value: unknown): string | null {
  if (typeof value === 'string') return boundedString(value, 300);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as LooseRecord;
  return boundedString(record.type, 160) || boundedString(record.description, 300);
}

function normalizeRedactions(redacted: unknown) {
  if (!Array.isArray(redacted)) return { redactions: [], redactionsTruncated: false };
  const redactions: NormalizedRdapRedaction[] = [];
  const candidates = redacted.slice(0, MAX_RDAP_REDACTIONS * 2);
  let stoppedAt = candidates.length;
  for (let index = 0; index < candidates.length; index += 1) {
    const itemValue = candidates[index];
    if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) continue;
    const item = itemValue as LooseRecord;
    const entry = {
      name: redactionLabel(item.name),
      reason: redactionLabel(item.reason),
      method: boundedString(item.method, 80, { lower: true }),
      pathLanguage: boundedString(item.pathLang, 80, { lower: true }),
      prePath: boundedString(item.prePath, 512),
      postPath: boundedString(item.postPath, 512),
      replacementPath: boundedString(item.replacementPath, 512),
    };
    if (!Object.values(entry).some(Boolean)) continue;
    redactions.push(entry);
    if (redactions.length >= MAX_RDAP_REDACTIONS) {
      stoppedAt = index + 1;
      break;
    }
  }
  return {
    redactions,
    redactionsTruncated: stoppedAt < redacted.length,
  };
}

function normalizeDomainVariants(value: unknown) {
  if (!Array.isArray(value)) return { variants: [], variantsTruncated: false };
  const variants: NormalizedRdapVariant[] = [];
  let truncated = value.length > MAX_RDAP_VARIANT_GROUPS;
  for (const groupValue of value.slice(0, MAX_RDAP_VARIANT_GROUPS)) {
    if (!groupValue || typeof groupValue !== 'object' || Array.isArray(groupValue)) continue;
    const group = groupValue as LooseRecord;
    const sourceNames = Array.isArray(group.variantNames) ? group.variantNames : [];
    const variantNames: Array<{ ldhName: string | null; unicodeName: string | null }> = [];
    for (const nameValue of sourceNames.slice(0, MAX_RDAP_VARIANT_NAMES * 2)) {
      if (!nameValue || typeof nameValue !== 'object' || Array.isArray(nameValue)) continue;
      const name = nameValue as LooseRecord;
      const ldhName = boundedString(name.ldhName, 253);
      const unicodeName = boundedString(name.unicodeName, 253);
      if (!ldhName && !unicodeName) continue;
      variantNames.push({ ldhName, unicodeName });
      if (variantNames.length >= MAX_RDAP_VARIANT_NAMES) break;
    }
    if (sourceNames.length > MAX_RDAP_VARIANT_NAMES) truncated = true;
    const relation = normalizeStringList(group.relation, 20, 100, { lower: true });
    const idnTable = boundedString(group.idnTable, 300);
    if (!variantNames.length && !relation.length && !idnTable) continue;
    variants.push({ relation, idnTable, variantNames });
  }
  return { variants, variantsTruncated: truncated };
}

function publicId(entity: LooseRecord | null | undefined, typePattern: RegExp): string | null {
  const match = entity && Array.isArray(entity.publicIds)
    ? entity.publicIds.find((item) => typePattern.test(String(item.type || '')))
    : null;
  return match ? match.identifier : null;
}

function textWouldTruncate(value: unknown, maxLength: number): boolean {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.replace(/\s+/g, ' ').trim().length > maxLength;
}

function summarizeTextBlocks(blocks: unknown) {
  if (!Array.isArray(blocks)) return { items: [], truncated: false };
  const output: NormalizedRdapTextBlock[] = [];
  let truncated = blocks.length > 50;
  for (const blockValue of blocks.slice(0, 50)) {
    if (!blockValue || typeof blockValue !== 'object' || Array.isArray(blockValue)) continue;
    const block = blockValue as LooseRecord;
    const descriptions: string[] = [];
    const sourceDescriptions = Array.isArray(block.description) ? block.description : [];
    if (sourceDescriptions.length > 20) truncated = true;
    for (const text of sourceDescriptions.slice(0, 20)) {
      if (textWouldTruncate(text, 800)) truncated = true;
      const description = truncatedText(text, 800);
      if (!description) continue;
      if (descriptions.length < 6) descriptions.push(description);
      else truncated = true;
    }
    if (!descriptions.length) continue;
    if (textWouldTruncate(block.title, 160)) truncated = true;
    const item = {
      title: truncatedText(block.title, 160) || 'Notice',
      type: boundedString(block.type, 160, { lower: true }),
      descriptions,
    };
    if (output.length < 12) output.push(item);
    else truncated = true;
  }
  return { items: output, truncated };
}

function normalizeServerTruncationType(value: unknown): string | null {
  const type = boundedString(value, 160, { lower: true });
  return type && RDAP_SERVER_TRUNCATION_TYPES.has(type) ? type : null;
}

function summarizeServerTruncation(...groups: unknown[]): string[] {
  const reasons = new Set<string>();
  for (const blocks of groups) {
    if (!Array.isArray(blocks)) continue;
    // Match the same bounded source window used by the text-block normalizer.
    // If a server publishes more blocks, noticesTruncated/remarksTruncated
    // separately disclose that the local inspection window was exceeded.
    for (const blockValue of blocks.slice(0, 50)) {
      if (!blockValue || typeof blockValue !== 'object' || Array.isArray(blockValue)) continue;
      const type = normalizeServerTruncationType((blockValue as LooseRecord).type);
      if (!type) continue;
      reasons.add(type);
      if (reasons.size >= MAX_RDAP_SERVER_TRUNCATION_REASONS) break;
    }
    if (reasons.size >= MAX_RDAP_SERVER_TRUNCATION_REASONS) break;
  }
  return [...reasons].sort();
}

function boundedEventString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim() || null;
}

function normalizeRdapEvents(value: unknown): NormalizedRdapEvent[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
    const record = event as LooseRecord;
    const action = boundedEventString(record.eventAction, 100)?.toLowerCase().replace(/\s+/g, ' ') || null;
    const date = boundedEventString(record.eventDate, 64);
    const actor = boundedEventString(record.eventActor, 160);
    return action || date ? { action, date, actor } : null;
  }).filter((event): event is NormalizedRdapEvent => event !== null);
}

function lifecycleDate(events: NormalizedRdapEvent[], action: string, newest: boolean): string | null {
  let selected: string | null = null;
  let selectedTime = newest ? -Infinity : Infinity;
  for (const event of events) {
    if (event.action !== action || !event.date) continue;
    const time = Date.parse(event.date);
    if (!Number.isFinite(time)) continue;
    if ((newest && time > selectedTime) || (!newest && time < selectedTime)) {
      selected = event.date;
      selectedTime = time;
    }
  }
  return selected;
}

function summarizeLifecycle(events: NormalizedRdapEvent[]) {
  const lifecycle = {
    createdDate: lifecycleDate(events, 'registration', false),
    reregistrationDate: lifecycleDate(events, 'reregistration', true),
    expiryDate: lifecycleDate(events, 'expiration', true),
    updatedDate: lifecycleDate(events, 'last changed', true),
    transferDate: lifecycleDate(events, 'transfer', true),
    deletionDate: lifecycleDate(events, 'deletion', true),
    reinstantiationDate: lifecycleDate(events, 'reinstantiation', true),
    databaseUpdatedDate: lifecycleDate(events, 'last update of rdap database', true),
  };
  return {
    ...lifecycle,
    createdDateIso: registryDateIso(lifecycle.createdDate),
    reregistrationDateIso: registryDateIso(lifecycle.reregistrationDate),
    expiryDateIso: registryDateIso(lifecycle.expiryDate),
    updatedDateIso: registryDateIso(lifecycle.updatedDate),
    transferDateIso: registryDateIso(lifecycle.transferDate),
    deletionDateIso: registryDateIso(lifecycle.deletionDate),
    reinstantiationDateIso: registryDateIso(lifecycle.reinstantiationDate),
    databaseUpdatedDateIso: registryDateIso(lifecycle.databaseUpdatedDate),
  };
}

function summarizeEntity(entity: unknown): EntitySummary | null {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;
  const record = entity as LooseRecord;
  const roles: string[] = [];
  if (Array.isArray(record.roles)) {
    for (const rawRole of record.roles.slice(0, 100)) {
      const role = boundedString(rawRole, 80, { lower: true });
      if (!role || roles.includes(role)) continue;
      roles.push(role);
      if (roles.length >= MAX_ENTITY_ROLES) break;
    }
  }
  const names = normalizeContactValues(record.vcardArray, 'fn', 300);
  const organizations = normalizeContactValues(record.vcardArray, 'org', 300);
  const emails = normalizeContactValues(record.vcardArray, 'email', 320, { lower: true });
  const phones = normalizeContactValues(record.vcardArray, 'tel', 100);
  const addresses = normalizeAddresses(record.vcardArray);
  const vcardEntries = Array.isArray(record.vcardArray) && Array.isArray(record.vcardArray[1])
    ? record.vcardArray[1]
    : [];
  const summary = {
    handle: boundedString(record.handle, 200),
    roles,
    name: names[0] || null,
    names,
    org: organizations[0] || null,
    organizations,
    email: emails[0] || null,
    emails,
    phone: phones[0] || null,
    phones,
    address: addresses[0] || null,
    addresses,
    publicIds: normalizePublicIds(record.publicIds),
    links: normalizeLinks(record.links, MAX_ENTITY_LINKS),
    truncated: Boolean(
      (Array.isArray(record.roles) && record.roles.length > MAX_ENTITY_ROLES)
      || vcardEntries.length > MAX_VCARD_ENTRIES
      || contactValuesTruncated(record.vcardArray)
      || (Array.isArray(record.publicIds) && record.publicIds.length > 20)
      || (Array.isArray(record.links) && record.links.length > MAX_ENTITY_LINKS)
    ),
  };
  const hasAny = Boolean(summary.handle || summary.name || summary.org || summary.email
    || summary.phone || summary.address || summary.publicIds.length || summary.links.length);
  return hasAny ? summary : null;
}

function summarizeEntities(entities: unknown) {
  const summaries: EntitySummary[] = [];
  const source = Array.isArray(entities) ? entities : [];
  let truncated = source.length > MAX_RDAP_ENTITIES;
  const stack = source
    .slice(0, MAX_RDAP_ENTITIES)
    .reverse()
    .map((entity) => ({ entity, depth: 0 }));
  const seen = new WeakSet<object>();
  let visited = 0;
  while (stack.length && visited < MAX_RDAP_ENTITIES) {
    const current = stack.pop();
    if (!current) continue;
    const { entity, depth } = current as { entity: unknown; depth: number };
    if (!entity || typeof entity !== 'object' || Array.isArray(entity) || seen.has(entity)) continue;
    seen.add(entity);
    visited += 1;
    const summary = summarizeEntity(entity);
    if (summary) summaries.push(summary);
    const record = entity as LooseRecord;
    if (depth >= MAX_RDAP_ENTITY_DEPTH || !Array.isArray(record.entities)) continue;
    const remaining = Math.max(0, MAX_RDAP_ENTITIES - visited - stack.length);
    const nested = record.entities.slice(0, remaining);
    if (nested.length < record.entities.length) truncated = true;
    for (let i = nested.length - 1; i >= 0; i -= 1) stack.push({ entity: nested[i], depth: depth + 1 });
  }
  if (stack.length) truncated = true;
  return { summaries, truncated };
}

function groupEntitiesByRole(entities: EntitySummary[]) {
  const grouped: Record<string, EntitySummary[]> = {};
  const truncatedRoles = new Set<string>();
  for (const entity of entities) {
    for (const role of entity.roles) {
      if (!RDAP_CONTACT_ROLES.has(role)) continue;
      if (!grouped[role]) grouped[role] = [];
      if (grouped[role].length < MAX_ENTITIES_PER_ROLE) grouped[role].push(entity);
      else truncatedRoles.add(role);
    }
  }
  return { entitiesByRole: grouped, truncatedEntityRoles: [...truncatedRoles].sort() };
}

function entityInventory(entities: unknown) {
  const collected = summarizeEntities(entities);
  const grouped = groupEntitiesByRole(collected.summaries);
  return {
    ...grouped,
    entitiesTruncated: collected.truncated || grouped.truncatedEntityRoles.length > 0
      || collected.summaries.some((entity) => entity.truncated),
  };
}

function parseRdapObject(type: string, data: LooseRecord): NormalizedRdapRecord | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const events = normalizeRdapEvents(data.events);
  const redactionInfo = normalizeRedactions(data.redacted);
  const noticesInfo = summarizeTextBlocks(data.notices);
  const remarksInfo = summarizeTextBlocks(data.remarks);
  const serverTruncationReasons = summarizeServerTruncation(data.notices, data.remarks);
  // Preserve the established status-array contract while making it available
  // to every RDAP object type. Unlike set-like fields, status order and
  // repetition remain as published for backwards compatibility.
  const statuses = Array.isArray(data.status)
    ? data.status.slice(0, 100)
        .map((status) => boundedString(status, 160))
        .filter((status): status is string => status !== null)
    : [];
  const common = {
    objectClassName: boundedString(data.objectClassName, 80, { lower: true }),
    language: boundedString(data.lang, 35, { lower: true }),
    conformance: normalizeStringList(data.rdapConformance, 50, 160, { lower: true }),
    conformanceTruncated: Array.isArray(data.rdapConformance) && data.rdapConformance.length > 50,
    ...redactionInfo,
    port43: boundedString(data.port43, 300),
    parentHandle: boundedString(data.parentHandle, 300),
    links: normalizeLinks(data.links),
    linksTruncated: Array.isArray(data.links) && data.links.length > MAX_RDAP_LINKS,
    notices: noticesInfo.items,
    noticesTruncated: noticesInfo.truncated,
    remarks: remarksInfo.items,
    remarksTruncated: remarksInfo.truncated,
    serverTruncated: serverTruncationReasons.length > 0,
    serverTruncationReasons,
    statuses,
    statusesTruncated: Array.isArray(data.status) && data.status.length > 100,
    events,
    eventsTruncated: Array.isArray(data.events) && data.events.length > 100,
    lifecycle: summarizeLifecycle(events),
  };

  if (type === 'domain') {
    const { entitiesByRole, entitiesTruncated, truncatedEntityRoles } = entityInventory(data.entities);
    const registrarEntity = entitiesByRole.registrar && entitiesByRole.registrar[0];
    let nameserverAddressesTruncated = false;
    const nameserverDetails = Array.isArray(data.nameservers)
      ? data.nameservers.slice(0, 200).map((ns) => {
          if (!ns || typeof ns !== 'object' || Array.isArray(ns)) return null;
          const nameserver = ns as LooseRecord;
          const ipAddresses = nameserver.ipAddresses && typeof nameserver.ipAddresses === 'object' && !Array.isArray(nameserver.ipAddresses)
            ? nameserver.ipAddresses as LooseRecord
            : {};
          const v4: unknown[] = Array.isArray(ipAddresses.v4) ? ipAddresses.v4 : [];
          const v6: unknown[] = Array.isArray(ipAddresses.v6) ? ipAddresses.v6 : [];
          if (v4.length + v6.length > 20) nameserverAddressesTruncated = true;
          const addresses = [
            ...v4.map((address) => boundedString(address, 80)).filter((address) => address && net.isIP(address) === 4),
            ...v6.map((address) => boundedString(address, 80)).filter((address) => address && net.isIP(address) === 6),
          ].slice(0, 20);
          return {
            name: boundedString(nameserver.ldhName || nameserver.unicodeName, 253),
            addresses,
          };
        }).filter((ns): ns is { name: string; addresses: string[] } => Boolean(ns?.name))
      : [];
    const secureDns: LooseRecord | null = data.secureDNS
      && typeof data.secureDNS === 'object'
      && !Array.isArray(data.secureDNS)
      ? data.secureDNS as LooseRecord
      : null;
    const variantInfo = normalizeDomainVariants(data.variants);
    const dsData: NormalizedRdapDsData[] = secureDns && Array.isArray(secureDns.dsData)
      ? secureDns.dsData.slice(0, 50).map((ds) => {
          if (!ds || typeof ds !== 'object' || Array.isArray(ds)) return null;
          const record = ds as LooseRecord;
          const digest = boundedString(record.digest, 512);
          const normalized = {
            keyTag: boundedInteger(record.keyTag, 0, 65535), algorithm: boundedInteger(record.algorithm, 0, 255),
            digestType: boundedInteger(record.digestType, 0, 255),
            digest: digest && digest.length % 2 === 0 && /^[0-9a-f]+$/i.test(digest) ? digest : null,
          };
          return Object.values(normalized).every((value) => value !== null)
            ? normalized as NormalizedRdapDsData
            : null;
        }).filter((value): value is NormalizedRdapDsData => value !== null)
      : [];
    return {
      ...common,
      domain: boundedString(data.ldhName || data.unicodeName, 253),
      unicodeDomain: data.unicodeName && data.unicodeName !== data.ldhName
        ? boundedString(data.unicodeName, 253) : null,
      handle: boundedString(data.handle, 300),
      nameservers: nameserverDetails.map((ns) => ns.name),
      nameserverDetails,
      nameserversTruncated: Array.isArray(data.nameservers) && data.nameservers.length > 200,
      nameserverAddressesTruncated,
      dnssec: secureDns && secureDns.delegationSigned === true
        ? 'Signed' : secureDns && secureDns.delegationSigned === false ? 'Unsigned' : 'Unknown',
      zoneSigned: secureDns && typeof secureDns.zoneSigned === 'boolean' ? secureDns.zoneSigned : null,
      delegationSigned: secureDns && typeof secureDns.delegationSigned === 'boolean'
        ? secureDns.delegationSigned : null,
      dsData,
      dsDataTruncated: Boolean(secureDns && Array.isArray(secureDns.dsData) && secureDns.dsData.length > 50),
      ...variantInfo,
      registrarIanaId: publicId(registrarEntity, /iana registrar id/i),
      entitiesByRole,
      entitiesTruncated,
      truncatedEntityRoles,
      registrar: registrarEntity || null,
      registrant: entitiesByRole.registrant?.[0] || null,
      administrative: entitiesByRole.administrative?.[0] || null,
      technical: entitiesByRole.technical?.[0] || null,
      billing: entitiesByRole.billing?.[0] || null,
      abuse: entitiesByRole.abuse?.[0] || null,
    };
  }

  if (type === 'ipv4' || type === 'ipv6') {
    const { entitiesByRole, entitiesTruncated, truncatedEntityRoles } = entityInventory(data.entities);
    const cidrs: string[] = Array.isArray(data.cidr0_cidrs)
      ? data.cidr0_cidrs.slice(0, 200)
          .map((c) => {
            if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
            const expectedFamily = type === 'ipv4' ? 4 : 6;
            const prefix = boundedString(expectedFamily === 4 ? c.v4prefix : c.v6prefix, 80);
            if (!prefix || net.isIP(prefix) !== expectedFamily) return null;
            const length = boundedInteger(c.length, 0, expectedFamily === 4 ? 32 : 128);
            return prefix && length !== null ? `${prefix}/${length}` : null;
          })
          .filter((value): value is string => value !== null)
      : [];
    return {
      ...common,
      handle: boundedString(data.handle, 300),
      name: boundedString(data.name, 300),
      startAddress: boundedString(data.startAddress, 80),
      endAddress: boundedString(data.endAddress, 80),
      cidrs,
      cidrsTruncated: Array.isArray(data.cidr0_cidrs) && data.cidr0_cidrs.length > 200,
      country: boundedString(data.country, 2),
      networkType: boundedString(data.type, 160),
      entitiesByRole,
      entitiesTruncated,
      truncatedEntityRoles,
      org: entitiesByRole.registrant?.[0] || entitiesByRole.administrative?.[0] || null,
      abuse: entitiesByRole.abuse?.[0] || null,
    };
  }

  if (type === 'asn') {
    const { entitiesByRole, entitiesTruncated, truncatedEntityRoles } = entityInventory(data.entities);
    return {
      ...common,
      handle: boundedString(data.handle, 300),
      name: boundedString(data.name, 300),
      startAutnum: boundedInteger(data.startAutnum, 0, 4294967295),
      endAutnum: boundedInteger(data.endAutnum, 0, 4294967295),
      country: boundedString(data.country, 2),
      autnumType: boundedString(data.type, 160),
      entitiesByRole,
      entitiesTruncated,
      truncatedEntityRoles,
      org: entitiesByRole.registrant?.[0] || null,
      abuse: entitiesByRole.abuse?.[0] || null,
    };
  }

  return null;
}

function parseRdap<const T extends string>(type: T, data: unknown): NormalizedRdapRecordFor<T> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  // parseRdapObject performs the matching runtime branch before returning.
  // This cast preserves that relationship for literal callers without
  // weakening the untrusted JSON boundary to any.
  return parseRdapObject(type, data as LooseRecord) as NormalizedRdapRecordFor<T> | null;
}

async function fetchRdapFromBases<const T extends string>(
  type: T,
  value: string,
  bases: unknown,
  fetchUpstream: RdapFetch = fetchRdapWithTimeout,
) {
  return fetchRdapFromBasesWithParser(
    type,
    value,
    bases,
    parseRdap,
    fetchUpstream,
  );
}

async function fetchRdapRecord<const T extends string>(
  type: T,
  value: string,
) {
  return fetchRdapRecordWithParser(type, value, parseRdap);
}

async function fetchRegistrarRdapRecord(
  domain: string,
  registryRecord: RegistryRdapLinkSource | null | undefined,
  options: { fetchUpstream?: RdapFetch } = {},
) {
  return fetchRegistrarRdapRecordWithParser(
    domain,
    registryRecord,
    parseRdap,
    options,
  );
}

export {
  BOOTSTRAP_TTL_MS,
  BOOTSTRAP_STALE_TTL_MS,
  fetchBootstrap,
  clearRdapBootstrapCache,
  fetchRdapRecord,
  fetchRdapFromBases,
  fetchRegistrarRdapRecord,
  selectRegistrarRdapLink,
  uniqueBases,
  parseRdap,
  normalizeRdapEvents,
  summarizeLifecycle,
};

export type {
  NormalizedRdapAutnumRecord,
  NormalizedRdapDomainRecord,
  NormalizedRdapNetworkRecord,
  NormalizedRdapRecord,
  NormalizedRdapRecordFor,
  RdapLookupRecord,
  RdapType,
} from './rdap-types.mts';
