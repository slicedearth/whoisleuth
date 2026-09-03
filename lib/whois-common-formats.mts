// Common contact, bracketed-record, nameserver and status formats applied
// after generic fields and marker-gated registry dialects.

import {
  parseIndentedContactBlock,
  resolveFredContact,
} from './whois-contacts.mts';
import {
  MAX_WHOIS_NAMESERVERS,
  MAX_WHOIS_STATUSES,
  addBoundedWhoisSetValue,
} from './whois-parser-support.mts';
import { boundedWhoisValue } from './whois-values.mts';
import type { WhoisDialectFlags } from './whois-dialects.mts';
import type { WhoisParserContext } from './whois-parser-support.mts';

function applyWhoisCommonFormats(
  text: string,
  isRootHop: boolean,
  dialects: WhoisDialectFlags,
  context: WhoisParserContext,
) {
  const {
    expandedStreetFields,
    fields,
    nameservers,
    statuses,
    truncatedFields,
  } = context;
  const {
    isAtiTn,
    isDnsBelgium,
    isEif,
    isHkirc,
    isIsocIl,
    isNicKz,
    isNicMd,
    isPunktum,
    isRnids,
    isTwnic,
  } = dialects;

  if (!isRootHop) {
    for (const [prefix, label] of [
      ['registrant', 'Registrant'], ['admin', 'Admin(?:istrative)?'],
      ['tech', 'Tech(?:nical)?'], ['billing', 'Billing'],
    ]) {
      const key = `${prefix}Street`;
      if (expandedStreetFields.has(key)) continue;
      const streetRe = new RegExp(`^[ \\t*]*${label} (?:Contact )?Street[ \\t.]*:[ \\t]*(.+)$`, 'gim');
      const lines: string[] = [];
      for (const match of text.matchAll(streetRe)) {
        const bounded = boundedWhoisValue(match[1], 300);
        if (bounded.truncated) truncatedFields.add(key);
        if (!bounded.value || lines.includes(bounded.value)) continue;
        if (lines.length >= 4) {
          truncatedFields.add(key);
          break;
        }
        lines.push(bounded.value);
      }
      if (lines.length) fields[key] = lines.join(', ');
      expandedStreetFields.add(key);
    }

    // The documented .nz protocol numbers up to two address lines using
    // underscore field names. Aggregate only those exact fields, keeping
    // the same four-line/300-character bounds as repeated ICANN-style
    // street fields and leaving city/province/postcode separately typed.
    for (const [prefix, nzPrefix] of [
      ['registrant', 'registrant'], ['admin', 'admin'], ['tech', 'technical'],
    ]) {
      const key = `${prefix}Street`;
      if (fields[key]) continue;
      const addressRe = new RegExp(`^[ \\t]*${nzPrefix}_contact_address(?:1|2)[ \\t]*:[ \\t]*(.+)$`, 'gim');
      const lines: string[] = [];
      for (const match of text.matchAll(addressRe)) {
        const bounded = boundedWhoisValue(match[1], 300);
        if (bounded.truncated) truncatedFields.add(key);
        if (!bounded.value || lines.includes(bounded.value)) continue;
        if (lines.length >= 4) {
          truncatedFields.add(key);
          break;
        }
        lines.push(bounded.value);
      }
      if (lines.length) fields[key] = lines.join(', ');
    }
  }

  // If registrantName looks like it's actually a handle (a matching
  // "contact: <handle>" block exists in this same hop), resolve it for
  // the real name/org/email/phone/address. Harmless no-op otherwise -
  // registries where "Registrant:" is already the real name (e.g. .kr)
  // simply won't have a matching contact block to find.
  if (!isRootHop && fields.registrantName) {
    const resolved = resolveFredContact(text, fields.registrantName);
    if (resolved) {
      if (resolved.name) fields.registrantName = resolved.name;
      if (resolved.org && !fields.registrantOrg) fields.registrantOrg = resolved.org;
      if (resolved.email && !fields.registrantEmail) fields.registrantEmail = resolved.email;
      if (resolved.phone && !fields.registrantPhone) fields.registrantPhone = resolved.phone;
      if (resolved.address && !fields.registrantAddress) fields.registrantAddress = resolved.address;
    }
  }

  // EDUCAUSE (.edu) and similar legacy registries list registrant/admin/
  // technical contacts as indented blocks rather than "Field: value"
  // pairs - see parseIndentedContactBlock. The plain "Registrant:" header
  // has no separate person name on .edu (registrants are institutions),
  // so its block's first line maps to the org, not a name.
  if (!isRootHop && !fields.registrantOrg && !fields.registrantName) {
    const block = parseIndentedContactBlock(text, /^[ \t]*Registrant:[ \t]*$/im);
    if (block) {
      if (block.name) fields.registrantOrg = block.name;
      if (block.address) fields.registrantAddress = block.address;
      if (block.phone) fields.registrantPhone = block.phone;
      if (block.email) fields.registrantEmail = block.email;
      if (block.truncated) truncatedFields.add('registrantAddress');
    }
  }
  if (!isRootHop && !fields.adminName) {
    const block = parseIndentedContactBlock(text, /^[ \t]*Administrative Contact:[ \t]*$/im);
    if (block) {
      if (block.name) fields.adminName = block.name;
      if (block.address) fields.adminAddress = block.address;
      if (block.phone) fields.adminPhone = block.phone;
      if (block.email) fields.adminEmail = block.email;
      if (block.truncated) truncatedFields.add('adminAddress');
    }
  }
  if (!isRootHop && !fields.techName) {
    const block = parseIndentedContactBlock(text, /^[ \t]*Technical Contact:[ \t]*$/im);
    if (block) {
      if (block.name) fields.techName = block.name;
      if (block.address) fields.techAddress = block.address;
      if (block.phone) fields.techPhone = block.phone;
      if (block.email) fields.techEmail = block.email;
      if (block.truncated) truncatedFields.add('techAddress');
    }
  }
  if (!isRootHop && !fields.billingName) {
    const block = parseIndentedContactBlock(text, /^[ \t]*Billing Contact:[ \t]*$/im);
    if (block) {
      if (block.name) fields.billingName = block.name;
      if (block.address) fields.billingAddress = block.address;
      if (block.phone) fields.billingPhone = block.phone;
      if (block.email) fields.billingEmail = block.email;
      if (block.truncated) truncatedFields.add('billingAddress');
    }
  }

  // .jp (JPRS) uses a bracketed dual-language format instead of
  // "Label: value" - e.g. "[Domain Name]   GOO.JP", with Japanese-only
  // labels alongside English ones for the same field. The bracket syntax
  // is distinctive enough to not need root-hop gating.
  if (!fields.domainName) {
    const m = text.match(/\[Domain Name\][ \t]*(.+)/i);
    if (m?.[1]) fields.domainName = m[1].trim();
  }
  if (!fields.registrantName) {
    const m = text.match(/\[Registrant\][ \t]*(.+)/i);
    if (m?.[1]) fields.registrantName = m[1].trim();
  }
  if (!fields.createdDate) {
    const m = text.match(/\[登録年月日\][ \t]*(.+)/);
    if (m?.[1]) fields.createdDate = m[1].trim();
  }
  if (!fields.expiryDate) {
    const m = text.match(/\[有効期限\][ \t]*(.+)/);
    if (m?.[1]) fields.expiryDate = m[1].trim();
  }
  for (const m of text.matchAll(/\[状態\][ \t]*(.+)/g)) {
    if (addBoundedWhoisSetValue(statuses, m[1], {
      maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
      field: 'statuses', truncatedFields,
    }) === 'capped') break;
  }
  for (const m of text.matchAll(/\[Name Server\][ \t]*([a-zA-Z0-9.\-]+)/gi)) {
    if (addBoundedWhoisSetValue(nameservers, m[1], {
      maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
      field: 'nameservers', truncatedFields,
    }) === 'capped') break;
  }

  // "Name Server:" never collides with the IANA root hop (which uses
  // lowercase "nserver:" for the TLD's own root nameservers) so it's safe
  // on every hop; "nserver:"/"Host Name:"/"DNS:" are real per-domain
  // labels on some registries (e.g. .ru, .kr, .mx) but only once we're
  // past the root hop, for the same reason as the field patterns above.
  const nsLinePatterns = [/^[ \t*]*Name Server[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim];
  if (!isRootHop) {
    nsLinePatterns.push(
      /^[ \t*]*nserver[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim,
      /^[ \t*]*Nameserver[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim,
      /^[ \t*]*Host Name[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim,
      /^[ \t]*ns_name_\d{2}[ \t]*:[ \t]*([a-zA-Z0-9.\-]+)/gim
    );
    // Punktum dk uses `DNS: example.dk` for the queried domain, then
    // `Hostname:` inside its nameserver section. Other supported
    // registries use `DNS:` for an actual nameserver, so switch aliases
    // only when the full .dk marker set is present.
    nsLinePatterns.push(isPunktum
      ? /^[ \t*]*Hostname[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim
      : /^[ \t*]*DNS[ \t.]*:[ \t]*([a-zA-Z0-9.\-]+)/gim);
  }
  for (const re of nsLinePatterns) {
    for (const m of text.matchAll(re)) {
      if (addBoundedWhoisSetValue(nameservers, m[1], {
        maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
        field: 'nameservers', truncatedFields,
      }) === 'capped') break;
    }
  }

  // Same root-hop exclusion as above: bare "status:" is also how IANA
  // reports the TLD's own delegation status (e.g. "status: ACTIVE" for
  // .gt itself), not the queried domain's status. Deliberately not adding
  // "state:" as an alternate here (some registries, e.g. .ru/.se, use it
  // for domain status) - it's also the standard label for a postal
  // address's state/province in Name/City/State/Country contact blocks
  // (seen on .mx), and there's no reliable way to tell those apart from
  // the label alone - a missing status is safer than a wrong one.
  const statusRe = isRootHop
    ? /^[ \t*]*Domain Status[ \t.]*:[ \t]*([a-zA-Z][a-zA-Z0-9_-]*)/gim
    : (isDnsBelgium || isPunktum || isIsocIl || isTwnic || isEif
        || isHkirc || isNicKz || isNicMd || isAtiTn)
      ? /^[ \t*]*(?:Domain Status|Status)[ \t.]*:[ \t]*([^\r\n]+)/gim
      : /^[ \t*]*(?:Domain Status|Status)[ \t.]*:[ \t]*([a-zA-Z][a-zA-Z0-9_-]*)/gim;
  if (!isRnids) {
    for (const m of text.matchAll(statusRe)) {
      if (addBoundedWhoisSetValue(statuses, m[1], {
        maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
        field: 'statuses', truncatedFields,
      }) === 'capped') break;
    }
  }
  if (!isRootHop) {
    for (const m of text.matchAll(/^[ \t]*query_status[ \t]*:[ \t]*(\d{3}(?:[ \t]+[^\r\n]+)?)/gim)) {
      if (addBoundedWhoisSetValue(statuses, m[1], {
        maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
        field: 'statuses', truncatedFields,
      }) === 'capped') break;
    }
  }

  // Some registries (e.g. .it, .tr) list nameservers as a bare header
  // ("Nameservers", "Domain Servers") followed by unlabeled lines -
  // sometimes just a hostname, sometimes "hostname  ip.addr" - rather
  // than a per-line "Name Server:" label. Only meaningful on non-root hops.
  if (!isRootHop && nameservers.size === 0) {
    const headerMatch = text.match(/^[ \t*]*(?:Name ?[Ss]ervers|Domain Servers|DNS servers)[ \t.]*:?[ \t]*$/mi);
    if (headerMatch) {
      let found = 0;
      for (const line of text.slice((headerMatch.index ?? 0) + headerMatch[0].length).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
          if (found > 0) break; // blank line after >=1 hostname ends the section
          continue; // the header line's own line break - not a real gap yet
        }
        const hostMatch = trimmed.match(/^([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})(?:\s|$)/);
        if (hostMatch) {
          const result = addBoundedWhoisSetValue(nameservers, hostMatch[1], {
            maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
            field: 'nameservers', truncatedFields,
          });
          if (result === 'capped') break;
          if (result === 'added') found += 1;
        } else {
          break;
        }
      }
    }
  }
}

export { applyWhoisCommonFormats };
