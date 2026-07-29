// Stable normalized WHOIS contracts. Parsing and transport remain separate so
// consumers can depend on the record shape without importing network code.

export type WhoisScalarFields = Record<string, string | undefined>;

export type WhoisContact = {
  handle: string | null;
  roles: string[];
  name: string | null;
  names: string[];
  org: string | null;
  organizations: string[];
  email: string | null;
  emails: string[];
  phone: string | null;
  phones: string[];
  address: string | null;
  addresses: string[];
  publicIds: Array<{ type: string; identifier: string }>;
  links: never[];
};

export type WhoisLifecycle = {
  createdDate: string | null;
  expiryDate: string | null;
  updatedDate: string | null;
  createdDateIso: string | null;
  expiryDateIso: string | null;
  updatedDateIso: string | null;
};

export type WhoisAuthority = {
  registrationStatus: 'registered' | 'not_found' | 'inconclusive';
  notFound: boolean;
  notFoundSource: string | null;
  authoritativeHop: string | null;
  failedHop: string | null;
  conflictingHop: string | null;
  chainStatus: 'complete' | 'partial';
};

export type ParsedWhoisRecord = Record<string, unknown> & Partial<{
  domainName: string;
  registryDomainId: string;
  registrar: string;
  registrarUrl: string;
  registrarWhoisServer: string;
  registrarIanaId: string;
  reseller: string;
  createdDate: string;
  expiryDate: string;
  updatedDate: string;
  abuseEmail: string;
  abusePhone: string;
  dnssec: string;
  eligibilityType: string;
  eligibilityId: string;
  registrantId: string;
  registrantName: string;
  registrantOrg: string;
  registrantEmail: string;
  registrantPhone: string;
  registrantAddress: string;
  registrantStreet: string;
  registrantCity: string;
  registrantState: string;
  registrantPostalCode: string;
  registrantCountry: string;
  adminId: string;
  adminName: string;
  adminOrg: string;
  adminEmail: string;
  adminPhone: string;
  adminAddress: string;
  adminStreet: string;
  adminCity: string;
  adminState: string;
  adminPostalCode: string;
  adminCountry: string;
  techId: string;
  techName: string;
  techOrg: string;
  techEmail: string;
  techPhone: string;
  techAddress: string;
  techStreet: string;
  techCity: string;
  techState: string;
  techPostalCode: string;
  techCountry: string;
  billingId: string;
  billingName: string;
  billingOrg: string;
  billingEmail: string;
  billingPhone: string;
  billingAddress: string;
  billingStreet: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
  billingCountry: string;
}> & {
  nameservers: string[];
  statuses: string[];
  createdDateIso: string | null;
  expiryDateIso: string | null;
  updatedDateIso: string | null;
  lifecycle: WhoisLifecycle;
  contactsByRole: Record<string, WhoisContact[]>;
  fieldsTruncated: string[];
} & WhoisAuthority;
