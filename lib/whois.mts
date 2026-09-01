// WHOIS: stable transport, referral-chain, authority and parsing facade shared
// by the Express server, Netlify Functions and CLI.

export {
  queryWhoisAddress,
  whoisQuery,
} from './whois-transport.mts';
export {
  buildWhoisChain,
  buildWhoisChainUncached,
} from './whois-chain.mts';
export { analyzeWhoisChainAuthority } from './whois-authority.mts';
export { parseWhoisChain } from './whois-parser.mts';
export type { ParsedWhoisRecord } from './whois-contracts.mts';
