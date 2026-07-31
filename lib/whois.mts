// WHOIS: raw TCP port-43 lookups, following registry referrals starting from
// the IANA root WHOIS server, plus response parsing. Shared by the Express
// server and the Netlify Functions.

import { domainToASCII } from 'node:url';

import { registryDateIso } from './registry-dates.mts';
import {
  queryWhoisAddress,
  whoisQuery,
} from './whois-transport.mts';
import {
  buildWhoisChain,
  buildWhoisChainUncached,
  fetchGtRegistryWhois,
  type WhoisChain,
} from './whois-chain.mts';
import {
  analyzeWhoisChainAuthority,
  hasNicKgRegistrationEvidence,
} from './whois-authority.mts';
import {
  parseIndentedContactBlock,
  resolveFredContact,
  resolveIrnicContact,
  resolveIsnicRole,
} from './whois-contacts.mts';
import { normalizeWhoisChain } from './whois-normalization.mts';
import {
  MAX_WHOIS_FIELD_LENGTH,
  boundedWhoisValue,
  parseBoundedWhoisSection,
  parseIndentedWhoisSubfield,
  parseIndentedWhoisValue,
  whoisFieldLimit,
} from './whois-values.mts';
import type {
  ParsedWhoisRecord,
  WhoisContact,
  WhoisLifecycle,
  WhoisScalarFields,
} from './whois-contracts.mts';

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

function parseWhoisChain(chain: unknown): ParsedWhoisRecord {
  const source = normalizeWhoisChain(chain);
  const fields: WhoisScalarFields = {};
  const truncatedFields = new Set<string>();
  const expandedStreetFields = new Set<string>();
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
  const patterns = {
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
    const isDnsBelgium = !isRootHop
      && /^%[^\r\n]*\.be Whois Server/im.test(text)
      && /^[ \t]*Registered[ \t]*:/im.test(text);
    const isEurid = !isRootHop
      && /^[ \t]*Script[ \t]*:/im.test(text)
      && /(?:^|\s)(?:www\.)?eurid\.eu(?:\s|\/|$)/im.test(text);
    const isNorid = !isRootHop
      && /^[ \t]*Domain Information[ \t]*$/im.test(text)
      && /^[ \t]*NORID Handle[ \t.]*:/im.test(text)
      && /^[ \t]*Registrar Handle[ \t.]*:/im.test(text)
      && /^[ \t]*Additional information[ \t]*:/im.test(text);
    const isCnnic = !isRootHop
      && /^[ \t]*ROID[ \t]*:/im.test(text)
      && /^[ \t]*Sponsoring Registrar[ \t]*:/im.test(text)
      && /^[ \t]*Registration Time[ \t]*:/im.test(text)
      && /^[ \t]*Expiration Time[ \t]*:/im.test(text);
    const isPunktum = !isRootHop
      && /^[ \t]*Registration period[ \t]*:/im.test(text)
      && /^[ \t]*VID[ \t]*:/im.test(text)
      && /^[ \t]*Nameservers[ \t]*$/im.test(text);
    const isPandi = !isRootHop
      && /^[ \t]*Domain ID[ \t]*:/im.test(text)
      && /^[ \t]*Sponsoring Registrar Organization[ \t]*:/im.test(text);
    const isIsocIl = !isRootHop
      && /^[ \t]*query[ \t]*:/im.test(text)
      && /^[ \t]*reg-name[ \t]*:/im.test(text)
      && /^[ \t]*validity[ \t]*:/im.test(text);
    const isTwnic = !isRootHop
      && /^[ \t]*Record created on[ \t]*:/im.test(text)
      && /^[ \t]*Record expires on[ \t]*:/im.test(text)
      && /^[ \t]*Registration Service Provider[ \t]*:/im.test(text);
    const isRegisterBg = !isRootHop
      && /^[ \t]*registration status[ \t]*:/im.test(text)
      && /^[ \t]*NAME SERVER INFORMATION[ \t]*:[ \t]*$/im.test(text);
    const isEif = !isRootHop
      && /Estonia \.ee Top Level Domain WHOIS server/i.test(text)
      && /^[ \t]*Domain[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Name servers[ \t]*:[ \t]*$/im.test(text);
    const isIszt = !isRootHop
      && /^% Whois server[^\r\n]*hu ccTLD/im.test(text)
      && /^[ \t]*record created[ \t]*:/im.test(text);
    const isIsnic = !isRootHop
      && /^% This is the ISNIC Whois server\./im.test(text)
      && /^[ \t]*source[ \t]*:[ \t]*ISNIC(?:\s|$)/im.test(text);
    const isNicLv = !isRootHop
      && /^[ \t]*\[Domain\][ \t]*$/im.test(text)
      && /^[ \t]*\[Holder\][ \t]*$/im.test(text)
      && /^[ \t]*\[Whois\][ \t]*$/im.test(text);
    const isSidn = !isRootHop
      && /^[ \t]*Domain nameservers[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Abuse Contact[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Record maintained by[ \t]*:/im.test(text);
    const isRnids = !isRootHop
      && /^[ \t]*Registration date[ \t]*:/im.test(text)
      && /^[ \t]*Modification date[ \t]*:/im.test(text)
      && /^[ \t]*DNSSEC signed[ \t]*:/im.test(text);
    const isCctldBy = !isRootHop
      && /^[ \t]*Domain name[ \t]*:/im.test(text)
      && /^[ \t]*Registration or other identification number[ \t]*:/im.test(text);
    const isHkirc = !isRootHop
      && /^[ \t]*Domain Name Information[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Name Servers Information[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Domain Name Commencement Date[ \t]*:/im.test(text);
    const isIrnic = !isRootHop
      && /^[ \t]*source[ \t]*:[ \t]*IRNIC(?:\s|$)/im.test(text)
      && /^[ \t]*holder-c[ \t]*:/im.test(text)
      && /^[ \t]*nic-hdl[ \t]*:/im.test(text);
    const isNicKz = !isRootHop
      && /^[ \t]*Domain Name[ \t.]*:/im.test(text)
      && /^[ \t]*Current Registar[ \t]*:/im.test(text)
      && /^[ \t]*Primary server[ \t.]*:/im.test(text);
    const isDnsLu = !isRootHop
      && /^[ \t]*domainname[ \t]*:/im.test(text)
      && /^[ \t]*domaintype[ \t]*:/im.test(text)
      && /^[ \t]*registrar-name[ \t]*:/im.test(text);
    const isNicMd = !isRootHop
      && /^[ \t]*Domain[ \t]+name[ \t]*:/im.test(text)
      && /^[ \t]*Domain state[ \t]*:/im.test(text)
      && /^[ \t]*Registered on[ \t]*:/im.test(text);
    const isThnic = !isRootHop
      && /^[ \t]*Domain Holder Organization[ \t]*:/im.test(text)
      && /^[ \t]*Created date[ \t]*:/im.test(text)
      && /^[ \t]*Exp date[ \t]*:/im.test(text);
    const isAtiTn = !isRootHop
      && /^[ \t]*NIC Whois server for cTLDs[ \t.]*:/im.test(text)
      && /^[ \t]*Domain name[ \t.]*:/im.test(text)
      && /^[ \t]*Creation date[ \t.]*:/im.test(text);
    const isMonic = !isRootHop
      && /^%[ \t]*Monic Whois Server Version[ \t]+\d/im.test(text)
      && /^[ \t]*Domain Name[ \t]*:/im.test(text)
      && /^[ \t]*Record created on[ \t]+[^:\r\n]/im.test(text)
      && /^[ \t]*Domain name servers[ \t]*:[ \t]*$/im.test(text);
    const isNicKg = !isRootHop && hasNicKgRegistrationEvidence(text);

    for (const [key, res] of Object.entries(patterns)) {
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

    // A small set of ccTLD dialects reuse terse labels that would be unsafe
    // as global aliases (for example `org:` and `state:` also occur inside
    // contact/address blocks). Gate those fields on registry-specific marker
    // combinations, while retaining the same scalar/list bounds as the
    // generic parser and leaving endpoint discovery and authority untouched.
    if (!isRootHop) {
      if (isRegisterBg) {
        const domainLine = text.match(/^[ \t]*DOMAIN NAME[ \t]*:[ \t]*([^\r\n]+)/im);
        const rawDomainLine = domainLine?.[1];
        if (rawDomainLine) {
          const boundedLine = rawDomainLine.slice(0, MAX_WHOIS_FIELD_LENGTH);
          const parenthesized = boundedLine.match(/\(([a-z0-9.-]{1,253})\)[ \t]*$/i)?.[1] || '';
          const leadingAscii = boundedLine.match(/^([a-z0-9.-]{1,253})(?:[ \t]|$)/i)?.[1] || '';
          const unicodeDomain = boundedLine.replace(/[ \t]+\([^\r\n()]{1,253}\)[ \t]*$/, '').trim();
          const domain = [parenthesized, leadingAscii, domainToASCII(unicodeDomain)]
            .find((candidate) => WHOIS_DOMAIN_RE.test(candidate));
          const bounded = boundedWhoisValue(domain, whoisFieldLimit('domainName'));
          if (bounded.value) fields.domainName = bounded.value;
          if (bounded.truncated) truncatedFields.add('domainName');
        }
        for (const match of text.matchAll(/^[ \t]*registration status[ \t]*:[ \t]*([^\r\n]+)/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
        collectBareWhoisNameservers(
          text,
          /^[ \t]*NAME SERVER INFORMATION[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      if (isEif) {
        const domainSection = parseBoundedWhoisSection(text, /^[ \t]*Domain[ \t]*:[ \t]*$/im);
        const registrantSection = parseBoundedWhoisSection(text, /^[ \t]*Registrant[ \t]*:[ \t]*$/im);
        const adminSection = parseBoundedWhoisSection(text, /^[ \t]*Administrative contact[ \t]*:[ \t]*$/im);
        const techSection = parseBoundedWhoisSection(text, /^[ \t]*Technical contact[ \t]*:[ \t]*$/im);
        const registrarSection = parseBoundedWhoisSection(text, /^[ \t]*Registrar[ \t]*:[ \t]*$/im);
        assignBoundedWhoisMatch(domainSection, fields, 'domainName', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrantSection, fields, 'registrantName', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrantSection, fields, 'registrantId', /^[ \t]*org id[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrantSection, fields, 'registrantCountry', /^[ \t]*country[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(adminSection, fields, 'adminName', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(techSection, fields, 'techName', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrarSection, fields, 'registrar', /^[ \t]*name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(registrarSection, fields, 'registrarUrl', /^[ \t]*url[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isIszt) {
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*record created[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isIsnic) {
        const handle = text.match(/^[ \t]*registrant[ \t]*:[ \t]*(.+)$/im)?.[1] || null;
        if (handle) {
          const boundedHandle = boundedWhoisValue(handle, whoisFieldLimit('registrantId'));
          if (boundedHandle.value) fields.registrantId = boundedHandle.value;
          if (boundedHandle.truncated) truncatedFields.add('registrantId');
          delete fields.registrantName;
          const role = resolveIsnicRole(text, boundedHandle.value);
          if (role) {
            if (role.org.value) fields.registrantOrg = role.org.value;
            if (role.email.value) fields.registrantEmail = role.email.value;
            if (role.phone.value) fields.registrantPhone = role.phone.value;
            if (role.address.value) fields.registrantAddress = role.address.value;
            if (role.org.truncated) truncatedFields.add('registrantOrg');
            if (role.email.truncated) truncatedFields.add('registrantEmail');
            if (role.phone.truncated) truncatedFields.add('registrantPhone');
            if (role.address.truncated || role.truncated) truncatedFields.add('registrantAddress');
          }
        }
        assignBoundedWhoisMatch(text, fields, 'adminId', /^[ \t]*admin-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techId', /^[ \t]*tech-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'billingId', /^[ \t]*billing-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isNicLv) {
        const holderSection = parseBoundedWhoisSection(text, /^[ \t]*\[Holder\][ \t]*$/im);
        assignBoundedWhoisMatch(holderSection, fields, 'registrantName', /^[ \t]*Name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(holderSection, fields, 'registrantId', /^[ \t]*RegNr[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(holderSection, fields, 'registrantAddress', /^[ \t]*Address[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(holderSection, fields, 'registrantCountry', /^[ \t]*Country[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isSidn) {
        const registrar = parseIndentedWhoisValue(
          text,
          /^[ \t]*Registrar[ \t]*:[ \t]*$/im,
          whoisFieldLimit('registrar'),
        );
        if (registrar?.value) fields.registrar = registrar.value;
        if (registrar?.truncated) truncatedFields.add('registrar');
        const abuse = parseIndentedContactBlock(text, /^[ \t]*Abuse Contact[ \t]*:[ \t]*$/im);
        if (abuse?.email) fields.abuseEmail = abuse.email;
        if (abuse?.phone) fields.abusePhone = abuse.phone;
        if (abuse?.truncated) {
          truncatedFields.add('abuseEmail');
          truncatedFields.add('abusePhone');
        }
        collectBareWhoisNameservers(
          text,
          /^[ \t]*Domain nameservers[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      if (isRnids) {
        assignBoundedWhoisMatch(text, fields, 'adminName', /^[ \t]*Administrative contact[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techName', /^[ \t]*Technical contact[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'dnssec', /^[ \t]*DNSSEC signed[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*Domain status[ \t]*:[ \t]*(.*?)(?:[ \t]+https?:\/\/\S+)?[ \t]*$/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      if (isCctldBy) {
        assignBoundedWhoisMatch(text, fields, 'registrantOrg', /^[ \t]*Org[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*Registration or other identification number[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isHkirc) {
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*Domain Name Commencement Date[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        collectBareWhoisNameservers(
          text,
          /^[ \t]*Name Servers Information[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      if (isIrnic) {
        const registrantId = text.match(/^[ \t]*holder-c[ \t]*:[ \t]*(.+)$/im)?.[1] || null;
        if (registrantId) {
          assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*holder-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
          const contact = resolveIrnicContact(text, fields.registrantId);
          if (contact) {
            if (contact.name.value) fields.registrantName = contact.name.value;
            if (contact.org.value) fields.registrantOrg = contact.org.value;
            if (contact.email.value) fields.registrantEmail = contact.email.value;
            if (contact.phone.value) fields.registrantPhone = contact.phone.value;
            if (contact.address.value) fields.registrantAddress = contact.address.value;
            if (contact.name.truncated) truncatedFields.add('registrantName');
            if (contact.org.truncated) truncatedFields.add('registrantOrg');
            if (contact.email.truncated) truncatedFields.add('registrantEmail');
            if (contact.phone.truncated) truncatedFields.add('registrantPhone');
            if (contact.address.truncated || contact.truncated) truncatedFields.add('registrantAddress');
          }
        }
        assignBoundedWhoisMatch(text, fields, 'adminId', /^[ \t]*admin-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techId', /^[ \t]*tech-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'billingId', /^[ \t]*bill-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isNicKz) {
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*Domain created[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'updatedDate', /^[ \t]*Last modified[ \t.]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*Current Registar[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const pattern of [
          /^[ \t]*Primary server[ \t.]*:[ \t]*([a-zA-Z0-9.-]+)/gim,
          /^[ \t]*Secondary server[ \t.]*:[ \t]*([a-zA-Z0-9.-]+)/gim,
        ]) {
          for (const match of text.matchAll(pattern)) {
            const result = addBoundedWhoisSetValue(nameservers, match[1], {
              maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
              field: 'nameservers', truncatedFields,
            });
            if (result === 'capped') break;
          }
        }
      }

      if (isDnsLu) {
        assignBoundedWhoisMatch(text, fields, 'domainName', /^[ \t]*domainname[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*registrar-name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrarUrl', /^[ \t]*registrar-url[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isNicMd) {
        assignBoundedWhoisMatch(text, fields, 'domainName', /^[ \t]*Domain[ \t]+name[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*Domain state[ \t]*:[ \t]*([^\r\n]+)/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      if (isThnic) {
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*Created date[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'expiryDate', /^[ \t]*Exp date[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantOrg', /^[ \t]*Domain Holder Organization[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantCountry', /^[ \t]*Domain Holder Country[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantStreet', /^[ \t]*Domain Holder Street[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      if (isMonic) {
        assignBoundedWhoisMatch(
          text,
          fields,
          'createdDate',
          /^[ \t]*Record created on[ \t]+(.+)$/im,
          truncatedFields,
        );
        collectBareWhoisNameservers(
          text,
          /^[ \t]*Domain name servers[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      if (isNicKg) {
        const domainHeader = text.match(
          /^[ \t]*Domain[ \t]+([a-z0-9.-]+)[ \t]+\(([A-Z][A-Z0-9_-]*)\)[ \t]*$/im,
        );
        if (domainHeader) {
          const domain = boundedWhoisValue(domainHeader[1], whoisFieldLimit('domainName'));
          if (domain.value) fields.domainName = domain.value;
          if (domain.truncated) truncatedFields.add('domainName');
          addBoundedWhoisSetValue(statuses, domainHeader[2], {
            maxEntries: MAX_WHOIS_STATUSES,
            maxLength: 160,
            field: 'statuses',
            truncatedFields,
          });
        }
        assignBoundedWhoisMatch(
          text,
          fields,
          'createdDate',
          /^[ \t]*Record created[ \t]*:[ \t]*(.+)$/im,
          truncatedFields,
        );
        assignBoundedWhoisMatch(
          text,
          fields,
          'updatedDate',
          /^[ \t]*Record last updated on[ \t]*:[ \t]*(.+)$/im,
          truncatedFields,
        );
        assignBoundedWhoisMatch(
          text,
          fields,
          'expiryDate',
          /^[ \t]*Record expires on[ \t]*:[ \t]*(.+)$/im,
          truncatedFields,
        );
        collectBareWhoisNameservers(
          text,
          /^[ \t]*Name servers in the listed order[ \t]*:[ \t]*$/im,
          nameservers,
          truncatedFields,
        );
      }

      const isRegistroBr = /^[ \t]*owner-c[ \t]*:/im.test(text)
        && /^[ \t]*country[ \t]*:[ \t]*BR(?:\s|$)/im.test(text);
      if (isRegistroBr) {
        assignBoundedWhoisMatch(text, fields, 'registrantName', /^[ \t]*owner[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*owner-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'adminId', /^[ \t]*admin-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techId', /^[ \t]*tech-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }

      const isAfnic = /^[ \t]*source[ \t]*:[ \t]*FRNIC(?:\s|$)/im.test(text);
      if (isAfnic) {
        assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*holder-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'adminId', /^[ \t]*admin-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'techId', /^[ \t]*tech-c[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*eppstatus[ \t]*:[ \t]*(.+)$/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      const isTci = /^[ \t]*source[ \t]*:[ \t]*TCI(?:\s|$)/im.test(text)
        && /^[ \t]*paid-till[ \t]*:/im.test(text);
      if (isTci) {
        assignBoundedWhoisMatch(text, fields, 'registrantOrg', /^[ \t]*org[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*state[ \t]*:[ \t]*(.+)$/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      const isInternetstiftelsen = /^[ \t]*registry-lock[ \t]*:/im.test(text)
        && /^[ \t]*holder[ \t]*:/im.test(text);
      if (isInternetstiftelsen) {
        assignBoundedWhoisMatch(text, fields, 'registrantId', /^[ \t]*holder[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        for (const match of text.matchAll(/^[ \t]*state[ \t]*:[ \t]*(.+)$/gim)) {
          if (addBoundedWhoisSetValue(statuses, match[1], {
            maxEntries: MAX_WHOIS_STATUSES, maxLength: 160,
            field: 'statuses', truncatedFields,
          }) === 'capped') break;
        }
      }

      const isNask = /^[ \t]*DOMAIN NAME[ \t]*:/im.test(text)
        && /^[ \t]*registrant type[ \t]*:/im.test(text)
        && /^[ \t]*renewal date[ \t]*:/im.test(text)
        && /^[ \t]*REGISTRAR[ \t]*:[ \t]*$/im.test(text);
      if (isNask) {
        if (!fields.registrar) {
          const registrarHeader = text.match(/^[ \t]*REGISTRAR[ \t]*:[ \t]*$/im);
          const followingLines = registrarHeader
            ? text.slice((registrarHeader.index ?? 0) + registrarHeader[0].length).split('\n').slice(0, 8)
            : [];
          for (const line of followingLines) {
            if (!line.trim()) continue;
            const bounded = boundedWhoisValue(line, whoisFieldLimit('registrar'));
            if (bounded.value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(bounded.value)
              && !/^[a-z][a-z0-9 -]{0,50}:[ \t]/i.test(bounded.value)) {
              fields.registrar = bounded.value;
            }
            if (bounded.truncated) truncatedFields.add('registrar');
            break;
          }
        }

        const nameserverHeader = text.match(/^[ \t]*nameservers[ \t]*:[ \t]*(.*)$/im);
        if (nameserverHeader) {
          const candidates = [
            nameserverHeader[1] ?? '',
            ...text.slice((nameserverHeader.index ?? 0) + nameserverHeader[0].length)
              .split('\n').slice(1, MAX_WHOIS_NAMESERVERS + 2),
          ];
          let found = 0;
          for (const line of candidates) {
            if (line === undefined) continue;
            const trimmed = line.trim();
            if (!trimmed) {
              if (found > 0) break;
              continue;
            }
            const hostMatch = trimmed.match(/^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\.?(?:\s|$)/);
            if (!hostMatch) break;
            const hostname = hostMatch[1];
            if (!hostname) break;
            const result = addBoundedWhoisSetValue(nameservers, hostname.replace(/\.$/, ''), {
              maxEntries: MAX_WHOIS_NAMESERVERS, maxLength: 253,
              field: 'nameservers', truncatedFields,
            });
            if (result === 'capped') break;
            if (result === 'added') found += 1;
          }
        }
      }

      if ((isDnsBelgium || isEurid) && !fields.registrar) {
        const registrar = parseIndentedWhoisSubfield(
          text,
          /^[ \t]*Registrar[ \t]*:[ \t]*$/im,
          /^[ \t]*Name[ \t]*:[ \t]*(.+)$/i,
          whoisFieldLimit('registrar'),
        );
        if (registrar?.value) fields.registrar = registrar.value;
        if (registrar?.truncated) truncatedFields.add('registrar');
      }

      if (isNorid) {
        assignBoundedWhoisMatch(text, fields, 'registryDomainId', /^[ \t]*NORID Handle[ \t.]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*Registrar Handle[ \t.]*:[ \t]*(.+)$/im, truncatedFields);
      }

      // These aliases are meaningful only inside their registry's
      // distinctive response dialect. Keeping them marker-gated avoids
      // treating generic contact IDs, validity text, or service-provider
      // prose as domain-level evidence in unrelated WHOIS responses.
      if (isCnnic) {
        assignBoundedWhoisMatch(text, fields, 'registryDomainId', /^[ \t]*ROID[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'expiryDate', /^[ \t]*Expiration Time[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }
      if (isPandi) {
        assignBoundedWhoisMatch(text, fields, 'registryDomainId', /^[ \t]*Domain ID[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*Sponsoring Registrar Organization[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }
      if (isIsocIl) {
        assignBoundedWhoisMatch(text, fields, 'expiryDate', /^[ \t]*validity[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }
      if (isTwnic) {
        assignBoundedWhoisMatch(text, fields, 'registrar', /^[ \t]*Registration Service Provider[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'createdDate', /^[ \t]*Record created on[ \t]*:[ \t]*(.+)$/im, truncatedFields);
        assignBoundedWhoisMatch(text, fields, 'expiryDate', /^[ \t]*Record expires on[ \t]*:[ \t]*(.+)$/im, truncatedFields);
      }
    }

    // Sectioned legacy port-43 responses use a distinctive pair of section
    // headers and place several values on following indented lines. Gate the
    // dialect on both markers so generic responses with one blank field are
    // not reinterpreted. This is parser compatibility only: IANA still
    // selects the endpoint and authority analysis remains unchanged.
    const isSectionedRegistryResponse = !isRootHop
      && /^[ \t]*Relevant dates[ \t]*:[ \t]*$/im.test(text)
      && /^[ \t]*Registration status[ \t]*:[ \t]*$/im.test(text);
    if (isSectionedRegistryResponse) {
      for (const [key, headerRe] of [
        ['domainName', /^[ \t]*Domain(?: name)?[ \t]*:[ \t]*$/im],
        ['registrantName', /^[ \t]*Registrant[ \t]*:[ \t]*$/im],
        ['registrar', /^[ \t]*Registrar[ \t]*:[ \t]*$/im],
      ] as const) {
        if (fields[key]) continue;
        const parsed = parseIndentedWhoisValue(text, headerRe, whoisFieldLimit(key));
        if (!parsed?.value) continue;
        fields[key] = parsed.value;
        if (parsed.truncated) truncatedFields.add(key);
      }
      const registrationStatus = parseIndentedWhoisValue(
        text,
        /^[ \t]*Registration status[ \t]*:[ \t]*$/im,
        160,
      );
      if (registrationStatus?.value) {
        addBoundedWhoisSetValue(statuses, registrationStatus.value, {
          maxEntries: MAX_WHOIS_STATUSES,
          maxLength: 160,
          field: 'statuses',
          truncatedFields,
        });
      }

      const isChannelIslandsResponse = /^[ \t]*Domain Status[ \t]*:[ \t]*$/im.test(text)
        && /^[ \t]*WHOIS lookup made on[ \t]+[^\r\n]+$/im.test(text);
      if (isChannelIslandsResponse) {
        assignBoundedWhoisMatch(
          text,
          fields,
          'createdDate',
          /^[ \t]*Registered on[ \t]+(.+)$/im,
          truncatedFields,
        );
        const domainStatus = parseIndentedWhoisValue(
          text,
          /^[ \t]*Domain Status[ \t]*:[ \t]*$/im,
          160,
        );
        if (domainStatus?.value) {
          addBoundedWhoisSetValue(statuses, domainStatus.value, {
            maxEntries: MAX_WHOIS_STATUSES,
            maxLength: 160,
            field: 'statuses',
            truncatedFields,
          });
        }
      }
    }

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

export {
  buildWhoisChain,
  parseWhoisChain,
  analyzeWhoisChainAuthority,
  whoisQuery,
  queryWhoisAddress,
  buildWhoisChainUncached,
  fetchGtRegistryWhois,
};
export type { ParsedWhoisRecord } from './whois-contracts.mts';
