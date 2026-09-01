// WHOIS response parsing. Transport, referral-chain and stable public exports
// remain owned by the facade in whois.mts.

import { registryDateIso } from './registry-dates.mts';
import { analyzeWhoisChainAuthority } from './whois-authority.mts';
import { normalizeWhoisChain } from './whois-normalization.mts';
import { applyWhoisCommonFormats } from './whois-common-formats.mts';
import { applyWhoisDialects } from './whois-dialects.mts';
import {
  WHOIS_FIELD_PATTERNS,
  normalizedWhoisContact,
} from './whois-parser-support.mts';
import {
  boundedWhoisValue,
  whoisFieldLimit,
} from './whois-values.mts';
import type {
  ParsedWhoisRecord,
  WhoisContact,
  WhoisLifecycle,
  WhoisScalarFields,
} from './whois-contracts.mts';

function parseWhoisChain(chain: unknown): ParsedWhoisRecord {
  const source = normalizeWhoisChain(chain);
  const fields: WhoisScalarFields = {};
  const truncatedFields = new Set<string>();
  const expandedStreetFields = new Set<string>();
  const nameservers = new Set<string>();
  const statuses = new Set<string>();

  source.forEach((hop, hopIndex) => {
    const text = hop.response;
    if (!text) return;

    // hopIndex 0 is always whois.iana.org, whose "domain:"/"created:"/
    // "changed:" fields describe the TLD's own root delegation record, not
    // the queried domain - e.g. "created: 1992-08-14" for .gt is Guatemala's
    // delegation date, not any individual .gt domain's registration date.
    // The broadened alternate labels (everything past index 0 in each
    // pattern array) are common enough on real registries' per-domain
    // responses that they'd false-match that IANA hop too, so they're only
    // tried against later, registry-level hops.
    const isRootHop = hopIndex === 0;
    for (const [key, res] of Object.entries(WHOIS_FIELD_PATTERNS)) {
      // IANA's root hop describes the TLD and its operator, never a contact
      // for the queried registrable domain. Domain contacts therefore come
      // only from registry/registrar hops.
      if (isRootHop && /^(?:registrant|admin|tech|billing)/.test(key)) continue;
      if (fields[key]) continue; // earlier hop already set it - don't let a later, less-authoritative hop overwrite
      const candidates = isRootHop ? res.slice(0, 1) : res;
      for (const re of candidates) {
        const m = text.match(re);
        const matchedValue = m?.[1];
        if (matchedValue) {
          const value = matchedValue.trim();
          // Some WHOIS formats use "Registered: yes/no" as a boolean state,
          // while others use "Registered: <date>" for creation time. Never
          // store the boolean form as a date ("no" previously became a truthy
          // createdDate and could make availability look registered).
          if (key === 'createdDate' && /^(?:yes|no|true|false|available|free)$/i.test(value)) continue;
          const bounded = boundedWhoisValue(value, whoisFieldLimit(key));
          if (!bounded.value) continue;
          fields[key] = bounded.value;
          if (bounded.truncated) truncatedFields.add(key);
          break;
        }
      }
    }

    const dialects = applyWhoisDialects(text, isRootHop, {
      expandedStreetFields,
      fields,
      nameservers,
      statuses,
      truncatedFields,
    });
    applyWhoisCommonFormats(text, isRootHop, dialects, {
      expandedStreetFields,
      fields,
      nameservers,
      statuses,
      truncatedFields,
    });
  });

  // Dedicated legacy-format parsers above populate some fields outside the
  // generic pattern loop. Apply the same string/control bounds to every
  // scalar before constructing compatibility and normalized contact views.
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') continue;
    const bounded = boundedWhoisValue(value, whoisFieldLimit(key));
    if (!bounded.value) delete fields[key];
    else fields[key] = bounded.value;
    if (bounded.truncated) truncatedFields.add(key);
  }

  const createdDateIso = registryDateIso(fields.createdDate);
  const expiryDateIso = registryDateIso(fields.expiryDate);
  const updatedDateIso = registryDateIso(fields.updatedDate);
  const lifecycle: WhoisLifecycle = {
    createdDate: fields.createdDate || null,
    expiryDate: fields.expiryDate || null,
    updatedDate: fields.updatedDate || null,
    createdDateIso,
    expiryDateIso,
    updatedDateIso,
  };
  const contactsByRole: Record<string, WhoisContact[]> = {};
  for (const [prefix, role] of [
    ['registrant', 'registrant'], ['admin', 'administrative'],
    ['tech', 'technical'], ['billing', 'billing'],
  ] as const) {
    const contact = normalizedWhoisContact(fields, prefix, role, truncatedFields);
    if (contact) contactsByRole[role] = [contact];
  }
  if (fields.abuseEmail || fields.abusePhone) {
    contactsByRole.abuse = [{
      handle: null, roles: ['abuse'], name: null, names: [], org: fields.registrar || null,
      organizations: fields.registrar ? [fields.registrar] : [],
      email: fields.abuseEmail || null, emails: fields.abuseEmail ? [fields.abuseEmail] : [],
      phone: fields.abusePhone || null, phones: fields.abusePhone ? [fields.abusePhone] : [],
      address: null, addresses: [], publicIds: [], links: [],
    }];
  }
  // Existence is decided authority-aware, not by a global "any hop said no
  // match" flag: positive registry evidence is never overridden by a later
  // registrar hop that failed, rate-limited, or returned "no match".
  const authority = analyzeWhoisChainAuthority(source);
  return {
    ...fields,
    nameservers: [...nameservers],
    statuses: [...statuses],
    createdDateIso,
    expiryDateIso,
    updatedDateIso,
    lifecycle,
    contactsByRole,
    fieldsTruncated: [...truncatedFields].sort(),
    ...authority,
  };
}

export { parseWhoisChain };
