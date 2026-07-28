export type LooseRdapRecord = Record<string, unknown>;

export type RdapAttempt = {
  endpoint: string;
  transportSecurity: 'https' | 'http';
  status: number | null;
  outcome: string;
  detail: string | null;
  selected: boolean;
};

export type NormalizedRdapLink = {
  rel: string | null;
  href: string;
  type: string | null;
  title: string | null;
};

export type NormalizedRdapPublicId = { type: string; identifier: string };

export type NormalizedRdapTextBlock = {
  title: string;
  type: string | null;
  descriptions: string[];
};

export type NormalizedRdapRedaction = {
  name: string | null;
  reason: string | null;
  method: string | null;
  pathLanguage: string | null;
  prePath: string | null;
  postPath: string | null;
  replacementPath: string | null;
};

export type NormalizedRdapVariant = {
  relation: string[];
  idnTable: string | null;
  variantNames: Array<{ ldhName: string | null; unicodeName: string | null }>;
};

export type NormalizedRdapNameserver = { name: string; addresses: string[] };

export type NormalizedRdapDsData = {
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
};

export type NormalizedRdapLifecycle = {
  createdDate: string | null;
  reregistrationDate: string | null;
  expiryDate: string | null;
  updatedDate: string | null;
  transferDate: string | null;
  deletionDate: string | null;
  reinstantiationDate: string | null;
  databaseUpdatedDate: string | null;
  createdDateIso: string | null;
  reregistrationDateIso: string | null;
  expiryDateIso: string | null;
  updatedDateIso: string | null;
  transferDateIso: string | null;
  deletionDateIso: string | null;
  reinstantiationDateIso: string | null;
  databaseUpdatedDateIso: string | null;
};

export type RdapEntitySummary = {
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
  publicIds: NormalizedRdapPublicId[];
  links: NormalizedRdapLink[];
  truncated: boolean;
};

export type NormalizedRdapEvent = {
  action: string | null;
  date: string | null;
  actor: string | null;
};

export type NormalizedRdapCommonRecord = {
  objectClassName: string | null;
  language: string | null;
  conformance: string[];
  conformanceTruncated: boolean;
  redactions: NormalizedRdapRedaction[];
  redactionsTruncated: boolean;
  port43: string | null;
  parentHandle: string | null;
  statuses: string[];
  statusesTruncated: boolean;
  events: NormalizedRdapEvent[];
  eventsTruncated: boolean;
  lifecycle: NormalizedRdapLifecycle;
  links: NormalizedRdapLink[];
  linksTruncated: boolean;
  notices: NormalizedRdapTextBlock[];
  noticesTruncated: boolean;
  remarks: NormalizedRdapTextBlock[];
  remarksTruncated: boolean;
  serverTruncated: boolean;
  serverTruncationReasons: string[];
};

export type NormalizedRdapDomainRecord = NormalizedRdapCommonRecord & {
  domain: string | null;
  unicodeDomain: string | null;
  handle: string | null;
  nameservers: string[];
  nameserverDetails: NormalizedRdapNameserver[];
  nameserversTruncated: boolean;
  nameserverAddressesTruncated: boolean;
  dnssec: 'Signed' | 'Unsigned' | 'Unknown';
  zoneSigned: boolean | null;
  delegationSigned: boolean | null;
  dsData: NormalizedRdapDsData[];
  dsDataTruncated: boolean;
  variants: NormalizedRdapVariant[];
  variantsTruncated: boolean;
  registrarIanaId: string | null;
  entitiesByRole: Record<string, RdapEntitySummary[]>;
  entitiesTruncated: boolean;
  truncatedEntityRoles: string[];
  registrar: RdapEntitySummary | null;
  registrant: RdapEntitySummary | null;
  administrative: RdapEntitySummary | null;
  technical: RdapEntitySummary | null;
  billing: RdapEntitySummary | null;
  abuse: RdapEntitySummary | null;
};

export type NormalizedRdapNetworkRecord = NormalizedRdapCommonRecord & {
  handle: string | null;
  name: string | null;
  startAddress: string | null;
  endAddress: string | null;
  cidrs: string[];
  cidrsTruncated: boolean;
  country: string | null;
  networkType: string | null;
  entitiesByRole: Record<string, RdapEntitySummary[]>;
  entitiesTruncated: boolean;
  truncatedEntityRoles: string[];
  org: RdapEntitySummary | null;
  abuse: RdapEntitySummary | null;
};

export type NormalizedRdapAutnumRecord = NormalizedRdapCommonRecord & {
  handle: string | null;
  name: string | null;
  startAutnum: number | null;
  endAutnum: number | null;
  country: string | null;
  autnumType: string | null;
  entitiesByRole: Record<string, RdapEntitySummary[]>;
  entitiesTruncated: boolean;
  truncatedEntityRoles: string[];
  org: RdapEntitySummary | null;
  abuse: RdapEntitySummary | null;
};

export type NormalizedRdapRecord =
  | NormalizedRdapDomainRecord
  | NormalizedRdapNetworkRecord
  | NormalizedRdapAutnumRecord;

export type RdapType = 'domain' | 'ipv4' | 'ipv6' | 'asn';

export type NormalizedRdapRecordFor<T extends string> = T extends 'domain'
  ? NormalizedRdapDomainRecord
  : T extends 'ipv4' | 'ipv6'
    ? NormalizedRdapNetworkRecord
    : T extends 'asn'
      ? NormalizedRdapAutnumRecord
      : NormalizedRdapRecord;

export type RdapLookupRecord<
  TRecord extends NormalizedRdapRecord = NormalizedRdapRecord,
> = {
  rdapServer: string;
  transportSecurity: 'https' | 'http';
  upstreamStatus: number;
  fetchedAt: string;
  data: unknown;
  parsed: TRecord | null;
  attempts: RdapAttempt[];
};

export type RegistryRdapLinkSource = {
  rdapServer?: unknown;
  parsed?: unknown;
};
