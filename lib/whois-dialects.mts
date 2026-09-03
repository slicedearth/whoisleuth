// Marker-gated WHOIS registry dialect parsing. Ambiguous aliases stay scoped
// to complete response signatures and share the generic parser's bounds.

import { domainToASCII } from 'node:url';

import { hasNicKgRegistrationEvidence } from './whois-authority.mts';
import {
  parseIndentedContactBlock,
  resolveIrnicContact,
  resolveIsnicRole,
} from './whois-contacts.mts';
import {
  MAX_WHOIS_NAMESERVERS,
  MAX_WHOIS_STATUSES,
  WHOIS_DOMAIN_RE,
  addBoundedWhoisSetValue,
  assignBoundedWhoisMatch,
  collectBareWhoisNameservers,
} from './whois-parser-support.mts';
import {
  MAX_WHOIS_FIELD_LENGTH,
  boundedWhoisValue,
  parseBoundedWhoisSection,
  parseIndentedWhoisSubfield,
  parseIndentedWhoisValue,
  whoisFieldLimit,
} from './whois-values.mts';
import type { WhoisParserContext } from './whois-parser-support.mts';

type WhoisDialectFlags = {
  isDnsBelgium: boolean;
  isEurid: boolean;
  isNorid: boolean;
  isCnnic: boolean;
  isPunktum: boolean;
  isPandi: boolean;
  isIsocIl: boolean;
  isTwnic: boolean;
  isRegisterBg: boolean;
  isEif: boolean;
  isIszt: boolean;
  isIsnic: boolean;
  isNicLv: boolean;
  isSidn: boolean;
  isRnids: boolean;
  isCctldBy: boolean;
  isHkirc: boolean;
  isIrnic: boolean;
  isNicKz: boolean;
  isDnsLu: boolean;
  isNicMd: boolean;
  isThnic: boolean;
  isAtiTn: boolean;
  isMonic: boolean;
  isNicKg: boolean;
};

function applyWhoisDialects(
  text: string,
  isRootHop: boolean,
  context: WhoisParserContext,
): WhoisDialectFlags {
  const { fields, nameservers, statuses, truncatedFields } = context;

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

  return {
    isDnsBelgium,
    isEurid,
    isNorid,
    isCnnic,
    isPunktum,
    isPandi,
    isIsocIl,
    isTwnic,
    isRegisterBg,
    isEif,
    isIszt,
    isIsnic,
    isNicLv,
    isSidn,
    isRnids,
    isCctldBy,
    isHkirc,
    isIrnic,
    isNicKz,
    isDnsLu,
    isNicMd,
    isThnic,
    isAtiTn,
    isMonic,
    isNicKg,
  };
}

export { applyWhoisDialects };
export type { WhoisDialectFlags };
