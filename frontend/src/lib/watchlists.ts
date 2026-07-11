import { appendWatchlistScan, normalizeWatchlistEntry } from './analysis/watchlist-history.js';

export const WATCHLIST_KEY = 'whois-rdap-watchlist-v1';
export const MAX_WATCHLIST_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORTED_WATCHLISTS = 100;
const MAX_DOMAINS_PER_WATCHLIST = 2000;
const BLOCKED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

export interface WatchlistChange { domain:string; field:string; before:unknown; after:unknown; kind:string; tone:string }
export interface WatchlistEvent { checkedAt:string; mode:string; resultCount:number; conclusiveCount:number; changeCount:number; omittedChanges:number; changes:WatchlistChange[] }
export interface WatchlistEntry { updatedAt:string; results:Array<Record<string,any>>; baseline:Array<Record<string,any>>; history:WatchlistEvent[] }
export type Watchlists = Record<string, WatchlistEntry>;
function safeName(name:string){return name.length>0&&name.length<=100&&!BLOCKED_NAMES.has(name.toLowerCase());}

export function loadWatchlists(): Watchlists {
  try {
    const stored = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const entries = Object.entries(stored as Record<string, any>);
    return Object.fromEntries(entries.filter(([name,entry])=>safeName(name)&&Array.isArray(entry?.results)&&entry.results.length<=MAX_DOMAINS_PER_WATCHLIST).map(([name,entry])=>[name,normalizeWatchlistEntry(entry)])) as Watchlists;
  } catch { return {}; }
}

export function writeWatchlists(all: Watchlists) { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(all)); }

export function saveWatchlist(name:string, results:Array<Record<string,any>>, mode:'fast'|'deep'|'saved') {
  if(!safeName(name))throw new Error('Watchlist names must be 1–100 characters and use a safe name.');
  if(results.length>MAX_DOMAINS_PER_WATCHLIST)throw new Error(`Watchlists are limited to ${MAX_DOMAINS_PER_WATCHLIST} domains.`);
  const all=loadWatchlists();
  const {entry,changes}=appendWatchlistScan(all[name]||null,results,{mode});
  all[name]=entry as WatchlistEntry; writeWatchlists(all); return changes as WatchlistChange[];
}

export function deleteWatchlist(name:string){const all=loadWatchlists();delete all[name];writeWatchlists(all);}

export function importWatchlists(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected an object mapping names to watchlists.');const entries=Object.entries(value);if(entries.length>MAX_IMPORTED_WATCHLISTS)throw new Error(`Imports are limited to ${MAX_IMPORTED_WATCHLISTS} watchlists.`);const all=loadWatchlists();let added=0,updated=0;for(const [name,entry] of entries){if(!safeName(name)||!entry||!Array.isArray((entry as any).results))continue;if((entry as any).results.length>MAX_DOMAINS_PER_WATCHLIST)throw new Error(`Watchlist "${name}" exceeds the ${MAX_DOMAINS_PER_WATCHLIST}-domain limit.`);all[name]?updated++:added++;Object.defineProperty(all,name,{value:normalizeWatchlistEntry(entry),writable:true,enumerable:true,configurable:true});}writeWatchlists(all);return{added,updated};}

export function exportWatchlists(){const blob=new Blob([JSON.stringify(loadWatchlists(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`whoisleuth-watchlists-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);}

export const fieldLabels:Record<string,string>={availability:'Availability',registrarName:'Registrar',nameservers:'Nameservers',createdDate:'Creation date',expiryDate:'Expiry date',privacyProtected:'WHOIS privacy',hasMx:'MX',hasSpf:'SPF',hasDmarc:'DMARC',activityStatus:'Website activity',pageTitle:'Page title',faviconHash:'Favicon',faviconMatch:'Official favicon match',faviconNearMatch:'Official favicon near-match',hasPasswordField:'Password form',phishingLanguageMatch:'Phishing language',reusesOfficialAssets:'Official asset reuse',riskScore:'Risk score'};
export function formatValue(value:unknown){if(Array.isArray(value))return value.join(', ')||'None';if(typeof value==='boolean')return value?'Yes':'No';return value==null||value===''?'None':String(value);}
