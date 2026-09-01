// Bounded primitives and generic field patterns shared by the WHOIS parser.

import {
  boundedWhoisValue,
  whoisFieldLimit,
} from './whois-values.mts';
import type { WhoisScalarFields } from './whois-contracts.mts';

type WhoisParserContext = {
  expandedStreetFields: Set<string>;
  fields: WhoisScalarFields;
  nameservers: Set<string>;
  statuses: Set<string>;
  truncatedFields: Set<string>;
};

const MAX_WHOIS_NAMESERVERS = 200;
const MAX_WHOIS_STATUSES = 100;
const WHOIS_DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

// ---------------------------------------------------------------------------
// WHOIS response parsing (merges the referral chain into readable fields)
// ---------------------------------------------------------------------------

function assignBoundedWhoisMatch(
  text: string,
  fields: WhoisScalarFields,
  key: string,
  pattern: RegExp,
  truncatedFields: Set<string>,
) {
  if (fields[key]) return;
  const match = text.match(pattern);
  if (!match) return;
  const bounded = boundedWhoisValue(match[1], whoisFieldLimit(key));
  if (!bounded.value) return;
  fields[key] = bounded.value;
  if (bounded.truncated) truncatedFields.add(key);
}

function addBoundedWhoisSetValue(set: Set<string>, rawValue: unknown, {
  maxEntries, maxLength, field, truncatedFields,
}: { maxEntries: number; maxLength: number; field: string; truncatedFields: Set<string> }) {
  const bounded = boundedWhoisValue(rawValue, maxLength);
  if (!bounded.value || set.has(bounded.value)) return 'ignored';
  if (set.size >= maxEntries) {
    truncatedFields.add(field);
    return 'capped';
  }
  set.add(bounded.value);
  return 'added';
}

function collectBareWhoisNameservers(
  text: string,
  headerRe: RegExp,
  nameservers: Set<string>,
  truncatedFields: Set<string>,
) {
  const headerMatch = text.match(headerRe);
  if (!headerMatch) return;
  const lines = text.slice((headerMatch.index ?? 0) + headerMatch[0].length)
    .split('\n', MAX_WHOIS_NAMESERVERS + 3);
  let found = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (found) break;
      continue;
    }
    const hostMatch = trimmed.match(/^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\.?(?:\s|$)/);
    if (!hostMatch) break;
    const hostname = hostMatch[1];
    if (!hostname) break;
    const result = addBoundedWhoisSetValue(nameservers, hostname.replace(/\.$/, ''), {
      maxEntries: MAX_WHOIS_NAMESERVERS,
      maxLength: 253,
      field: 'nameservers',
      truncatedFields,
    });
    if (result === 'capped') break;
    if (result === 'added') found += 1;
  }
}

function normalizedWhoisContact(
  fields: WhoisScalarFields,
  prefix: string,
  role: string,
  truncatedFields: Set<string>,
) {
  let address = fields[`${prefix}Address`] || [
    fields[`${prefix}Street`], fields[`${prefix}City`], fields[`${prefix}State`],
    fields[`${prefix}PostalCode`], fields[`${prefix}Country`],
  ].filter(Boolean).join(', ') || null;
  if (address && !fields[`${prefix}Address`]) {
    const bounded = boundedWhoisValue(address, 1000);
    address = bounded.value;
    if (address) fields[`${prefix}Address`] = address;
    if (bounded.truncated) truncatedFields.add(`${prefix}Address`);
  }
  const handle = fields[`${prefix}Id`] || null;
  const name = fields[`${prefix}Name`] || null;
  const org = fields[`${prefix}Org`] || null;
  const email = fields[`${prefix}Email`] || null;
  const phone = fields[`${prefix}Phone`] || null;
  if (![handle, name, org, email, phone, address].some(Boolean)) return null;
  return {
    handle,
    roles: [role],
    name,
    names: name ? [name] : [],
    org,
    organizations: org ? [org] : [],
    email,
    emails: email ? [email] : [],
    phone,
    phones: phone ? [phone] : [],
    address,
    addresses: address ? [address] : [],
    publicIds: handle ? [{ type: 'Registry contact ID', identifier: handle }] : [],
    links: [],
  };
}

// [ \t]* (not \s*) after each colon - same reasoning as extractReferral:
// several registries list a field with no value (e.g. "Registrant
// Organization: " followed directly by "Registrant Street: REDACTED"),
// and \s* would cross that blank line and capture the next field's own
// label as the value.
//
// Each field lists the standard ICANN thick-WHOIS label first, then
// common alternates seen on registries that predate/ignore that format
// (e.g. .it uses "Domain:"/"Created:"/"Expire Date:"). First match wins.
// This is a broad-coverage net, not a claim of full per-registry support -
// registries with entirely different conventions (e.g. .jp's bracketed
// dual-language format) still need their own dedicated handling.
// ^[ \t*]* (not ^\s*) - some registries prefix lines with "**" (e.g. .tr's
// "** Domain Name:"). [ \t.]* before the colon - some use dot-leaders
// (.tr's "Created on..........:") or extra spaces before the colon
// (.kr's "Domain Name                 :") instead of a colon right after
// the label.
const WHOIS_FIELD_PATTERNS = {
  domainName: [
    /^[ \t*]*Domain Name[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Domain[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*domain_name[ \t]*:[ \t]*(.+)$/im,
  ],
  registryDomainId: [/^[ \t*]*Registry Domain ID[ \t.]*:[ \t]*(.+)$/im],
  registrar: [
    /^[ \t*]*Registrar[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Sponsoring Registrar[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Registrar Name[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*registrar_name[ \t]*:[ \t]*(.+)$/im,
  ],
  registrarUrl: [/^[ \t*]*Registrar URL[ \t.]*:[ \t]*(.+)$/im],
  registrarWhoisServer: [/^[ \t*]*Registrar WHOIS Server[ \t.]*:[ \t]*(.+)$/im],
  registrarIanaId: [/^[ \t*]*Registrar IANA ID[ \t.]*:[ \t]*(.+)$/im],
  reseller: [/^[ \t*]*Reseller[ \t.]*:[ \t]*(.+)$/im],
  createdDate: [
    /^[ \t*]*Creation Date[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Created(?: On)?[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Regist(?:ration|ered)(?: Time| Date| On)?[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Domain record activated[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*domain_dateregistered[ \t]*:[ \t]*(.+)$/im,
    /^[ \t]*domain_datecreated[ \t]*:[ \t]*(.+)$/im,
  ],
  expiryDate: [
    /^[ \t*]*Registr(?:y|ar) Expiry Date[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Registrar Registration Expiration Date[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Expir(?:y|ation|e)s?(?: Date| On)?[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Valid Until[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Domain expires[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Renewal Date[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*paid-till[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*domain_datebilleduntil[ \t]*:[ \t]*(.+)$/im,
  ],
  updatedDate: [
    /^[ \t*]*Updated Date[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Update Date[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Last Update(?:d)?(?: Date| On)?[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Last Modified[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Modified(?: Date)?[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Modification Date[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*last-update[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Changed[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Domain record last updated[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*domain_datelastmodified[ \t]*:[ \t]*(.+)$/im,
  ],
  abuseEmail: [/^[ \t*]*Registrar Abuse Contact Email[ \t.]*:[ \t]*(.+)$/im],
  abusePhone: [/^[ \t*]*Registrar Abuse Contact Phone[ \t.]*:[ \t]*(.+)$/im],
  dnssec: [
    /^[ \t*]*DNSSEC[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Signed[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*domain_signed[ \t]*:[ \t]*(.+)$/im,
  ],
  // auDA (.au) publishes the registrant's eligibility basis (e.g. an ABN/
  // ACN for a company) alongside - and often instead of - a named contact,
  // since .au domain eligibility is tied to a registrable Australian
  // presence rather than an individual.
  eligibilityType: [/^[ \t*]*Eligibility Type[ \t.]*:[ \t]*(.+)$/im],
  eligibilityId: [/^[ \t*]*Eligibility ID[ \t.]*:[ \t]*(.+)$/im],
  // Standard ICANN thick-WHOIS registrant/admin fields - present verbatim
  // on registries that don't redact contact data, and also what the .gt
  // web-lookup fallback below is formatted to produce. Several registries
  // (e.g. .au via auDA) insert an extra "Contact" word - "Registrant
  // Contact Email:", "Tech Contact Name:" - handled below with an optional
  // "(?:Contact )?" group rather than a whole separate pattern, except for
  // registrantName, where priority matters: on .au, the plain "Registrant:"
  // line carries the actual legal entity ("Example Corporation Pty Ltd") while
  // "Registrant Contact Name:" is often just a generic role ("Domain
  // Administrator") - kept as a lower-priority third alternate so the more
  // useful value wins when both are present.
  registrantName: [
    /^[ \t*]*Registrant Name[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Registrant[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Registrant Contact Name[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Owner Name[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*registrant_contact_name[ \t]*:[ \t]*(.+)$/im,
  ],
  registrantId: [/^[ \t*]*(?:Registry )?Registrant ID[ \t.]*:[ \t]*(.+)$/im],
  registrantOrg: [/^[ \t*]*Registrant (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
  registrantEmail: [
    /^[ \t*]*Registrant (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*registrant_contact_email[ \t]*:[ \t]*(.+)$/im,
  ],
  registrantPhone: [
    /^[ \t*]*Registrant (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*registrant_contact_phone[ \t]*:[ \t]*(.+)$/im,
  ],
  registrantAddress: [
    /^[ \t*]*Registrant (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Owner Address[ \t.]*:[ \t]*(.+)$/im,
  ],
  registrantStreet: [/^[ \t*]*Registrant (?:Contact )?Street[ \t.]*:[ \t]*(.+)$/im],
  registrantCity: [
    /^[ \t*]*Registrant (?:Contact )?City[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*registrant_contact_city[ \t]*:[ \t]*(.+)$/im,
  ],
  registrantState: [
    /^[ \t*]*Registrant (?:Contact )?State(?:\/Province)?[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*registrant_contact_province[ \t]*:[ \t]*(.+)$/im,
  ],
  registrantPostalCode: [
    /^[ \t*]*Registrant (?:Contact )?Postal Code[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*registrant_contact_postalcode[ \t]*:[ \t]*(.+)$/im,
  ],
  registrantCountry: [
    /^[ \t*]*Registrant (?:Contact )?Country[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t*]*Owner Country[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*registrant_contact_country[ \t]*:[ \t]*(.+)$/im,
  ],
  adminId: [/^[ \t*]*(?:Registry )?Admin(?:istrative)? (?:Contact )?ID[ \t.]*:[ \t]*(.+)$/im],
  adminName: [
    /^[ \t*]*Admin(?:istrative)? (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*admin_contact_name[ \t]*:[ \t]*(.+)$/im,
  ],
  adminOrg: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
  adminEmail: [
    /^[ \t*]*Admin(?:istrative)? (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*admin_contact_email[ \t]*:[ \t]*(.+)$/im,
  ],
  adminPhone: [
    /^[ \t*]*Admin(?:istrative)? (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*admin_contact_phone[ \t]*:[ \t]*(.+)$/im,
  ],
  adminAddress: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im],
  adminStreet: [/^[ \t*]*Admin(?:istrative)? (?:Contact )?Street[ \t.]*:[ \t]*(.+)$/im],
  adminCity: [
    /^[ \t*]*Admin(?:istrative)? (?:Contact )?City[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*admin_contact_city[ \t]*:[ \t]*(.+)$/im,
  ],
  adminState: [
    /^[ \t*]*Admin(?:istrative)? (?:Contact )?State(?:\/Province)?[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*admin_contact_province[ \t]*:[ \t]*(.+)$/im,
  ],
  adminPostalCode: [
    /^[ \t*]*Admin(?:istrative)? (?:Contact )?Postal Code[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*admin_contact_postalcode[ \t]*:[ \t]*(.+)$/im,
  ],
  adminCountry: [
    /^[ \t*]*Admin(?:istrative)? (?:Contact )?Country[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*admin_contact_country[ \t]*:[ \t]*(.+)$/im,
  ],
  techId: [/^[ \t*]*(?:Registry )?Tech(?:nical)? (?:Contact )?ID[ \t.]*:[ \t]*(.+)$/im],
  techName: [
    /^[ \t*]*Tech(?:nical)? (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*technical_contact_name[ \t]*:[ \t]*(.+)$/im,
  ],
  techOrg: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
  techEmail: [
    /^[ \t*]*Tech(?:nical)? (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*technical_contact_email[ \t]*:[ \t]*(.+)$/im,
  ],
  techPhone: [
    /^[ \t*]*Tech(?:nical)? (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*technical_contact_phone[ \t]*:[ \t]*(.+)$/im,
  ],
  techAddress: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im],
  techStreet: [/^[ \t*]*Tech(?:nical)? (?:Contact )?Street[ \t.]*:[ \t]*(.+)$/im],
  techCity: [
    /^[ \t*]*Tech(?:nical)? (?:Contact )?City[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*technical_contact_city[ \t]*:[ \t]*(.+)$/im,
  ],
  techState: [
    /^[ \t*]*Tech(?:nical)? (?:Contact )?State(?:\/Province)?[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*technical_contact_province[ \t]*:[ \t]*(.+)$/im,
  ],
  techPostalCode: [
    /^[ \t*]*Tech(?:nical)? (?:Contact )?Postal Code[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*technical_contact_postalcode[ \t]*:[ \t]*(.+)$/im,
  ],
  techCountry: [
    /^[ \t*]*Tech(?:nical)? (?:Contact )?Country[ \t.]*:[ \t]*(.+)$/im,
    /^[ \t]*technical_contact_country[ \t]*:[ \t]*(.+)$/im,
  ],
  billingId: [/^[ \t*]*(?:Registry )?Billing (?:Contact )?ID[ \t.]*:[ \t]*(.+)$/im],
  billingName: [/^[ \t*]*Billing (?:Contact )?Name[ \t.]*:[ \t]*(.+)$/im],
  billingOrg: [/^[ \t*]*Billing (?:Contact )?Organi[sz]ation[ \t.]*:[ \t]*(.+)$/im],
  billingEmail: [/^[ \t*]*Billing (?:Contact )?Email[ \t.]*:[ \t]*(.+)$/im],
  billingPhone: [/^[ \t*]*Billing (?:Contact )?Phone[ \t.]*:[ \t]*(.+)$/im],
  billingAddress: [/^[ \t*]*Billing (?:Contact )?Address[ \t.]*:[ \t]*(.+)$/im],
  billingStreet: [/^[ \t*]*Billing (?:Contact )?Street[ \t.]*:[ \t]*(.+)$/im],
  billingCity: [/^[ \t*]*Billing (?:Contact )?City[ \t.]*:[ \t]*(.+)$/im],
  billingState: [/^[ \t*]*Billing (?:Contact )?State(?:\/Province)?[ \t.]*:[ \t]*(.+)$/im],
  billingPostalCode: [/^[ \t*]*Billing (?:Contact )?Postal Code[ \t.]*:[ \t]*(.+)$/im],
  billingCountry: [/^[ \t*]*Billing (?:Contact )?Country[ \t.]*:[ \t]*(.+)$/im],
};

export {
  MAX_WHOIS_NAMESERVERS,
  MAX_WHOIS_STATUSES,
  WHOIS_DOMAIN_RE,
  WHOIS_FIELD_PATTERNS,
  assignBoundedWhoisMatch,
  addBoundedWhoisSetValue,
  collectBareWhoisNameservers,
  normalizedWhoisContact,
};
export type { WhoisParserContext };
