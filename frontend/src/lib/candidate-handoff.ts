export interface Candidate {
  domain: string;
  source: string;
  mutationTypes: string[];
}

export interface CandidateHandoff {
  version: 1;
  createdAt: string;
  source: 'typosquat' | 'keyword' | 'certificate-transparency' | 'watchlist' | 'manual';
  candidates: Candidate[];
  generatedCandidates?: Candidate[];
}

const KEY = 'whoisleuth:candidate-handoff:v1';
const MAX_HANDOFF_CANDIDATES=2000,MAX_GENERATED_CONTEXT=5000;
const HANDOFF_SOURCES:CandidateHandoff['source'][]=['typosquat','keyword','certificate-transparency','watchlist','manual'];
function isHandoffSource(value:unknown):value is CandidateHandoff['source']{return HANDOFF_SOURCES.includes(value as CandidateHandoff['source']);}
function normalizeCandidate(value:any):Candidate|null{const domain=String(value?.domain||'').trim().toLowerCase();if(!domain||domain.length>253)return null;const types:string[]=Array.isArray(value?.mutationTypes)?value.mutationTypes.slice(0,30).map((item:unknown)=>String(item).slice(0,80)):[];return{domain,source:String(value?.source||'').slice(0,253),mutationTypes:[...new Set<string>(types)]};}
function normalizeCandidates(values:unknown,limit:number){return Array.isArray(values)?values.slice(0,limit).map(normalizeCandidate).filter((value):value is Candidate=>Boolean(value)):[];}

export function saveCandidateHandoff(source: CandidateHandoff['source'], candidates: Candidate[], generatedCandidates?:Candidate[]) {
  const value: CandidateHandoff = { version: 1, createdAt: new Date().toISOString(), source, candidates:normalizeCandidates(candidates,MAX_HANDOFF_CANDIDATES), ...(generatedCandidates?{generatedCandidates:normalizeCandidates(generatedCandidates,MAX_GENERATED_CONTEXT)}: {}) };
  sessionStorage.setItem(KEY, JSON.stringify(value));
}

export function loadCandidateHandoff(): CandidateHandoff | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || 'null') as CandidateHandoff | null;
    if(parsed?.version!==1||!Array.isArray(parsed.candidates)||!isHandoffSource(parsed.source))return null;
    return{version:1,createdAt:String(parsed.createdAt||''),source:parsed.source,candidates:normalizeCandidates(parsed.candidates,MAX_HANDOFF_CANDIDATES),...(parsed.generatedCandidates?{generatedCandidates:normalizeCandidates(parsed.generatedCandidates,MAX_GENERATED_CONTEXT)}:{})};
  } catch {
    return null;
  }
}
