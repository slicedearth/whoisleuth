import {
  appendWatchlistScan,
  MAX_WATCHLIST_DOMAINS,
  projectWatchlistDomainHistory as projectDomainHistory,
  watchlistHistoryDomains as historyDomains,
} from './analysis/watchlist-history.js';
import { httpSecurityHeaderLabel } from './analysis/http-summary.js';
import {
  buildWatchlistExport,
  mergeWatchlistStores,
  normalizeWatchlistName,
  serializeWatchlistStore,
} from './analysis/watchlist-store.js';
import { browserLocalDataProvider } from './browser-local-data-service.js';
import { LEGACY_WATCHLIST_KEY, WATCHLISTS_COLLECTION } from './browser-local-data-definitions.js';

export const WATCHLIST_KEY = LEGACY_WATCHLIST_KEY;
export const MAX_WATCHLIST_IMPORT_BYTES = 2 * 1024 * 1024;

export interface WatchlistChange { domain:string; field:string; before:unknown; after:unknown; kind:string; tone:string }
export interface WatchlistEvent { checkedAt:string; mode:string; resultCount:number; conclusiveCount:number; changeCount:number; omittedChanges:number; changes:WatchlistChange[] }
export interface WatchlistEntry { updatedAt:string; results:Array<Record<string,any>>; baseline:Array<Record<string,any>>; history:WatchlistEvent[] }
export type Watchlists = Record<string, WatchlistEntry>;
export interface WatchlistHistoryGroup { key:string; label:string; changes:WatchlistChange[] }
export interface WatchlistDomainHistoryEvent { checkedAt:string; mode:string; groups:WatchlistHistoryGroup[] }
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
  return (await browserLocalDataProvider()).read(WATCHLISTS_COLLECTION) as Promise<Watchlists>;
}

function boundedWatchlists(all: Watchlists): Watchlists {
  return JSON.parse(serializeWatchlistStore(all)).watchlists as Watchlists;
}

export async function writeWatchlists(all: Watchlists): Promise<void> {
  await (await browserLocalDataProvider()).update(WATCHLISTS_COLLECTION, () => ({ document: boundedWatchlists(all), result: undefined }));
}

export async function saveWatchlist(name:string, results:Array<Record<string,any>>, mode:'fast'|'deep'|'saved'): Promise<WatchlistChange[]> {
  const normalizedName=normalizeWatchlistName(name);
  if(!normalizedName)throw new Error('Watchlist names must be 1–100 characters and use a safe name.');
  if(results.length>MAX_WATCHLIST_DOMAINS)throw new Error(`Watchlists are limited to ${MAX_WATCHLIST_DOMAINS} domains.`);
  return (await browserLocalDataProvider()).update(WATCHLISTS_COLLECTION, (current) => {
    const all = { ...current } as Watchlists;
    const {entry,changes}=appendWatchlistScan(all[normalizedName]||null,results,{mode});
    Object.defineProperty(all,normalizedName,{value:entry,writable:true,enumerable:true,configurable:true});
    return { document: boundedWatchlists(all), result: changes as WatchlistChange[] };
  });
}

export async function deleteWatchlist(name:string):Promise<void>{await(await browserLocalDataProvider()).update(WATCHLISTS_COLLECTION,(current)=>{const all={...current} as Watchlists;delete all[name];return{document:boundedWatchlists(all),result:undefined};});}

export async function importWatchlists(value:unknown){return(await browserLocalDataProvider()).update(WATCHLISTS_COLLECTION,(current)=>{const result=mergeWatchlistStores(current,value);const watchlists=boundedWatchlists(result.watchlists as Watchlists);return{document:watchlists,result:{added:result.added,updated:result.updated,skipped:result.skipped}};});}

export async function exportWatchlists(){const blob=new Blob([JSON.stringify(buildWatchlistExport(await loadWatchlists()),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`whoisleuth-watchlists-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);}

export const fieldLabels:Record<string,string>={availability:'Availability',registrarName:'Registrar',nameservers:'Nameservers',createdDate:'Creation date',expiryDate:'Expiry date',privacyProtected:'WHOIS privacy',hasMx:'MX',hasSpf:'SPF',hasDmarc:'DMARC',activityStatus:'Website activity',pageTitle:'Page title',httpEvidenceStatus:'HTTP evidence status',httpFinalOrigin:'Final website origin',httpResponseStatus:'HTTP response status',httpTransportSecurity:'Website transport',httpRedirectCount:'HTTP redirect count',httpCrossOriginRedirect:'Cross-origin redirect',httpHttpsDowngrade:'HTTPS downgrade',httpContentType:'Website content type',httpSecurityHeaders:'Observed security headers',faviconHash:'Favicon',faviconMatch:'Official favicon match',faviconNearMatch:'Official favicon near-match',hasPasswordField:'Password form',phishingLanguageMatch:'Phishing language',reusesOfficialAssets:'Official asset reuse',riskScore:'Risk score'};
export function formatValue(value:unknown,field=''){if(Array.isArray(value))return (field==='httpSecurityHeaders'?value.map(item=>httpSecurityHeaderLabel(String(item))):value).join(', ')||'None';if(typeof value==='boolean')return value?'Yes':'No';return value==null||value===''?'None':String(value);}
export function watchlistHistoryDomains(entry:WatchlistEntry|null){return historyDomains(entry) as {domains:string[];omittedDomains:number};}
export function projectWatchlistDomainHistory(entry:WatchlistEntry|null,domain:string){return projectDomainHistory(entry,domain) as WatchlistDomainHistory|null;}
