import { appendWatchlistScan, MAX_WATCHLIST_DOMAINS } from './analysis/watchlist-history.js';
import { httpSecurityHeaderLabel } from './analysis/http-summary.js';
import {
  buildWatchlistExport,
  mergeWatchlistStores,
  normalizeWatchlistName,
  normalizeWatchlistStore,
  serializeWatchlistStore,
  WATCHLIST_SCHEMA_VERSION,
  watchlistStoreVersion,
} from './analysis/watchlist-store.js';

export const WATCHLIST_KEY = 'whois-rdap-watchlist-v1';
export const MAX_WATCHLIST_IMPORT_BYTES = 2 * 1024 * 1024;

export interface WatchlistChange { domain:string; field:string; before:unknown; after:unknown; kind:string; tone:string }
export interface WatchlistEvent { checkedAt:string; mode:string; resultCount:number; conclusiveCount:number; changeCount:number; omittedChanges:number; changes:WatchlistChange[] }
export interface WatchlistEntry { updatedAt:string; results:Array<Record<string,any>>; baseline:Array<Record<string,any>>; history:WatchlistEvent[] }
export type Watchlists = Record<string, WatchlistEntry>;

function readRaw(): unknown {
  const raw = localStorage.getItem(WATCHLIST_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function loadWatchlists(): Watchlists {
  try {
    return normalizeWatchlistStore(readRaw()).watchlists as Watchlists;
  } catch { return {}; }
}

export function writeWatchlists(all: Watchlists) {
  let version: number | null = null;
  try { version = watchlistStoreVersion(readRaw()); } catch { /* corrupt data can be replaced safely */ }
  if (version !== null && version > WATCHLIST_SCHEMA_VERSION) {
    throw new Error('Watchlists were created by a newer app version. Update the app before saving.');
  }
  const serialized = serializeWatchlistStore(all);
  try { localStorage.setItem(WATCHLIST_KEY, serialized); }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Watchlist storage is full')) throw cause;
    throw new Error('Could not save watchlists. Browser storage may be full or unavailable.');
  }
}

export function saveWatchlist(name:string, results:Array<Record<string,any>>, mode:'fast'|'deep'|'saved') {
  const normalizedName=normalizeWatchlistName(name);
  if(!normalizedName)throw new Error('Watchlist names must be 1–100 characters and use a safe name.');
  if(results.length>MAX_WATCHLIST_DOMAINS)throw new Error(`Watchlists are limited to ${MAX_WATCHLIST_DOMAINS} domains.`);
  const all=loadWatchlists();
  const {entry,changes}=appendWatchlistScan(all[normalizedName]||null,results,{mode});
  Object.defineProperty(all,normalizedName,{value:entry,writable:true,enumerable:true,configurable:true});writeWatchlists(all);return changes as WatchlistChange[];
}

export function deleteWatchlist(name:string){const all=loadWatchlists();delete all[name];writeWatchlists(all);}

export function importWatchlists(value:unknown){const result=mergeWatchlistStores(loadWatchlists(),value);writeWatchlists(result.watchlists as Watchlists);return{added:result.added,updated:result.updated,skipped:result.skipped};}

export function exportWatchlists(){let version:number|null=null;try{version=watchlistStoreVersion(readRaw());}catch{/* export normalized recovery */}if(version!==null&&version>WATCHLIST_SCHEMA_VERSION)throw new Error('Watchlists were created by a newer app version. Update the app before exporting.');const blob=new Blob([JSON.stringify(buildWatchlistExport(loadWatchlists()),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`whoisleuth-watchlists-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);}

export const fieldLabels:Record<string,string>={availability:'Availability',registrarName:'Registrar',nameservers:'Nameservers',createdDate:'Creation date',expiryDate:'Expiry date',privacyProtected:'WHOIS privacy',hasMx:'MX',hasSpf:'SPF',hasDmarc:'DMARC',activityStatus:'Website activity',pageTitle:'Page title',httpEvidenceStatus:'HTTP evidence status',httpFinalOrigin:'Final website origin',httpResponseStatus:'HTTP response status',httpTransportSecurity:'Website transport',httpRedirectCount:'HTTP redirect count',httpCrossOriginRedirect:'Cross-origin redirect',httpHttpsDowngrade:'HTTPS downgrade',httpContentType:'Website content type',httpSecurityHeaders:'Observed security headers',faviconHash:'Favicon',faviconMatch:'Official favicon match',faviconNearMatch:'Official favicon near-match',hasPasswordField:'Password form',phishingLanguageMatch:'Phishing language',reusesOfficialAssets:'Official asset reuse',riskScore:'Risk score'};
export function formatValue(value:unknown,field=''){if(Array.isArray(value))return (field==='httpSecurityHeaders'?value.map(item=>httpSecurityHeaderLabel(String(item))):value).join(', ')||'None';if(typeof value==='boolean')return value?'Yes':'No';return value==null||value===''?'None':String(value);}
