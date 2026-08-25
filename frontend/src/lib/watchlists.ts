import {
  appendWatchlistScan,
  MAX_WATCHLIST_DOMAINS,
  projectWatchlistDomainHistory as projectDomainHistory,
  watchlistHistoryDomains as historyDomains,
} from './analysis/watchlist-history.ts';
import { httpSecurityHeaderLabel } from './analysis/http-summary.ts';
import {
  buildWatchlistExport,
  MAX_WATCHLISTS,
  mergeWatchlistStores,
  normalizeWatchlistName,
  serializeWatchlistStore,
} from './analysis/watchlist-store.ts';
import type {
  WatchlistCollection,
  WatchlistEntry,
} from './analysis/watchlist-store.ts';
import type {
  WatchlistChange,
  WatchlistComparableRecord,
  WatchlistDomainHistoryEvent,
  WatchlistHistoryEvent,
  WatchlistHistoryGroup,
} from './analysis/watchlist-history.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { LEGACY_WATCHLIST_KEY } from './browser-local-data-contract.ts';
import { serialiseWorkspacePortableJson } from '../../../packages/contracts/workspace-portability.mts';
export { MAX_WATCHLIST_IMPORT_BYTES } from '../../../packages/contracts/workspace-portability.mts';

export const WATCHLIST_KEY = LEGACY_WATCHLIST_KEY;

export type {
  WatchlistChange,
  WatchlistEntry,
  WatchlistHistoryEvent as WatchlistEvent,
  WatchlistHistoryGroup,
};
export type Watchlists = WatchlistCollection;
export interface WatchlistDomainHistory {
  domain:string;
  retainedWatchlistChecks:number;
  watchlistFirstCheckedAt:string|null;
  watchlistLastCheckedAt:string|null;
  scanModes:string[];
  materialChangeCount:number;
  omittedChanges:number;
  events:WatchlistDomainHistoryEvent[];
}

export async function loadWatchlists(): Promise<Watchlists> {
  return readBrowserLocalData('watchlists');
}

function boundedWatchlists(all: Watchlists): Watchlists {
  return JSON.parse(serializeWatchlistStore(all)).watchlists as Watchlists;
}

export async function writeWatchlists(all: Watchlists): Promise<void> {
  await updateBrowserLocalData('watchlists', () => ({ document: boundedWatchlists(all), result: undefined }));
}

export function mergeHostedWatchlist(
  current: Watchlists,
  name: string,
  hostedEntry: WatchlistEntry,
): Watchlists {
  const normalizedName = normalizeWatchlistName(name);
  if (!normalizedName) throw new Error('Hosted watchlist name is invalid.');
  const all = { ...current } as Watchlists;
  const existing = Object.keys(all).find((candidate) => candidate.toLowerCase() === normalizedName.toLowerCase());
  if (!existing && Object.keys(all).length >= MAX_WATCHLISTS) {
    throw new Error('Watchlist storage is full. Export and remove a watchlist before saving more.');
  }
  if (existing && existing !== normalizedName) delete all[existing];
  Object.defineProperty(all, normalizedName, {
    value: hostedEntry,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return boundedWatchlists(all);
}

export async function restoreHostedWatchlist(name: string, hostedEntry: WatchlistEntry): Promise<void> {
  await updateBrowserLocalData('watchlists', (current) => ({
    document: mergeHostedWatchlist(current as Watchlists, name, hostedEntry),
    result: undefined,
  }));
}

export async function saveWatchlist(name:string, results:WatchlistComparableRecord[], mode:'fast'|'deep'|'saved'): Promise<WatchlistChange[]> {
  const normalizedName=normalizeWatchlistName(name);
  if(!normalizedName)throw new Error('Watchlist names must be 1–100 characters and use a safe name.');
  if(results.length>MAX_WATCHLIST_DOMAINS)throw new Error(`Watchlists are limited to ${MAX_WATCHLIST_DOMAINS} domains.`);
  return updateBrowserLocalData('watchlists', (current) => {
    const all = { ...current } as Watchlists;
    const {entry,changes}=appendWatchlistScan(all[normalizedName]||null,results,{mode});
    Object.defineProperty(all,normalizedName,{value:entry,writable:true,enumerable:true,configurable:true});
    return { document: boundedWatchlists(all), result: changes as WatchlistChange[] };
  });
}

export async function deleteWatchlist(name:string):Promise<void>{await updateBrowserLocalData('watchlists',(current)=>{const all={...current} as Watchlists;delete all[name];return{document:boundedWatchlists(all),result:undefined};});}

export async function importWatchlists(value:unknown){return updateBrowserLocalData('watchlists',(current)=>{const result=mergeWatchlistStores(current,value);const watchlists=boundedWatchlists(result.watchlists as Watchlists);return{document:watchlists,result:{added:result.added,updated:result.updated,skipped:result.skipped}};});}

export async function exportWatchlists(){const blob=new Blob([serialiseWorkspacePortableJson(buildWatchlistExport(await loadWatchlists()))],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`whoisleuth-watchlists-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);}

export const fieldLabels:Record<string,string>={availability:'Availability',registrarName:'Registrar',nameservers:'Nameservers',createdDate:'Creation date',expiryDate:'Expiry date',privacyProtected:'WHOIS privacy',hasMx:'MX',hasSpf:'SPF',hasDmarc:'DMARC',activityStatus:'Website activity',pageTitle:'Page title',httpEvidenceStatus:'HTTP evidence status',httpFinalOrigin:'Final website origin',httpResponseStatus:'HTTP response status',httpTransportSecurity:'Website transport',httpRedirectCount:'HTTP redirect count',httpCrossOriginRedirect:'Cross-origin redirect',httpHttpsDowngrade:'HTTPS downgrade',httpContentType:'Website content type',httpSecurityHeaders:'Observed security headers',faviconHash:'Favicon',faviconMatch:'Official favicon match',faviconNearMatch:'Official favicon near-match',hasPasswordField:'Password form',phishingLanguageMatch:'Phishing language',reusesOfficialAssets:'Official asset reuse',riskScore:'Risk score'};
export function formatValue(value:unknown,field=''){if(Array.isArray(value))return (field==='httpSecurityHeaders'?value.map(item=>httpSecurityHeaderLabel(String(item))):value).join(', ')||'None';if(typeof value==='boolean')return value?'Yes':'No';return value==null||value===''?'None':String(value);}
export function watchlistHistoryDomains(entry:WatchlistEntry|null){return historyDomains(entry);}
export function projectWatchlistDomainHistory(entry:WatchlistEntry|null,domain:string):WatchlistDomainHistory|null{return projectDomainHistory(entry,domain) as WatchlistDomainHistory|null;}
