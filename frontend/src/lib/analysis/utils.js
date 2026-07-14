// Browser-safe analysis helpers shared by the Svelte workspaces.

// Deliberately conservative (no +tags, no comments, no quoted local parts) -
// this only gates whether a WHOIS/RDAP-sourced string is safe to drop into a
// mailto: URI as the recipient, not a general email validator. mailto:
// treats a comma as an additional-recipient separator (RFC 6068), so a
// registrant/abuse-contact field containing e.g. "victim@x.com,cc@evil.com"
// would silently add a second recipient to the outreach/abuse draft the user
// opens - rejecting anything outside a single plain address closes that off.
const SIMPLE_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_ENTITY_DISPLAY_LENGTH = 300;

export function isValidEmailAddress(value) {
  return typeof value === 'string' && SIMPLE_EMAIL_RE.test(value.trim());
}

// RDAP and compact availability results represent a registrar as an entity,
// while some WHOIS paths retain the historical string field. Normalize both
// forms before they reach UI summaries or browser-local evidence; blindly
// calling String() on an entity would persist "[object Object]" and hide real
// registrar changes. The backend already bounds these values, but this client
// boundary revalidates the API response before retaining it.
export function entityDisplayName(value) {
  let candidate = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    candidate = value.name || value.org || value.handle;
  }
  if (typeof candidate !== 'string' && typeof candidate !== 'number') return null;
  const normalized = String(candidate)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ENTITY_DISPLAY_LENGTH);
  return normalized || null;
}

// Hamming distance (0-64) between two 16-hex perceptual dHash strings (see
// lib/perceptual-hash.mts), or null if either isn't a well-formed hash. Smaller
// = more visually similar. Shared by the brand-profile near-match check and
// bulk favicon clustering; mirrors the backend's hammingDistanceHex. The two
// implementations target separate Node and browser execution boundaries.
const HEX_HASH_RE = /^[0-9a-f]{16}$/;

export function hammingDistanceHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  if (!HEX_HASH_RE.test(a) || !HEX_HASH_RE.test(b)) return null;
  let distance = 0;
  for (let i = 0; i < 16; i += 1) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (diff) { distance += diff & 1; diff >>= 1; }
  }
  return distance;
}

// A dHash carries usable structure only when its set-bit count is away from
// the degenerate extremes - a near-all-zero (or near-all-one) hash comes from
// a solid/monotonic icon and collides with every other such icon (see
// lib/perceptual-hash.mts's MIN_INFORMATIVE_BITS, mirrored here). Generation
// already rejects these, but this is re-checked at every comparison so a
// degenerate hash saved into a Brand Profile before that guard existed can't
// keep producing false near-matches.
const MIN_INFORMATIVE_HASH_BITS = 10;

export function isInformativeFaviconHash(hex) {
  if (typeof hex !== 'string' || !HEX_HASH_RE.test(hex)) return false;
  let bits = 0;
  for (let i = 0; i < 16; i += 1) {
    let n = parseInt(hex[i], 16);
    while (n) { bits += n & 1; n >>= 1; }
  }
  return bits >= MIN_INFORMATIVE_HASH_BITS && bits <= 64 - MIN_INFORMATIVE_HASH_BITS;
}

// Groups records that share a favicon, connecting two whenever their exact
// hashes match OR their perceptual hashes are within maxDistance. Returns the
// domain lists of every group of 2+ (singletons dropped). Exact-hash matching
// still covers favicons that can't be perceptually decoded (GIF/JPEG/SVG ->
// null phash), while the perceptual pass additionally catches resized or
// recompressed near-duplicates the exact hash alone would miss - so a phishing
// ring that varied one favicon slightly across its domains still clusters.
// Union-find gives transitive grouping (A~B, B~C => one group); the pairwise
// perceptual pass is O(n^2) but only over records that carry a favicon at all
// (deep-scanned domains, capped well below the fast-scan ceiling).
export function groupBySimilarFavicon(records, maxDistance) {
  const items = (records || []).filter((r) => r
    && (r.faviconHash || (typeof r.faviconPHash === 'string' && HEX_HASH_RE.test(r.faviconPHash))));
  const parent = items.map((_, i) => i);
  const find = (x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next; }
    return root;
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };

  // Exact-hash buckets first (cheap, and the only signal for undecodable icons).
  const firstByHash = new Map();
  items.forEach((r, i) => {
    if (!r.faviconHash) return;
    if (firstByHash.has(r.faviconHash)) union(i, firstByHash.get(r.faviconHash));
    else firstByHash.set(r.faviconHash, i);
  });

  // Perceptual near-matches among records with an *informative* phash -
  // degenerate hashes (solid/monotonic icons) are skipped so they don't all
  // cluster together; they can still group via an exact-hash match above.
  const withPhash = [];
  items.forEach((r, i) => { if (isInformativeFaviconHash(r.faviconPHash)) withPhash.push({ i, phash: r.faviconPHash }); });
  for (let a = 0; a < withPhash.length; a += 1) {
    for (let b = a + 1; b < withPhash.length; b += 1) {
      const distance = hammingDistanceHex(withPhash[a].phash, withPhash[b].phash);
      if (distance !== null && distance <= maxDistance) union(withPhash[a].i, withPhash[b].i);
    }
  }

  const groups = new Map();
  items.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r.domain);
  });
  return [...groups.values()].filter((domains) => domains.length >= 2);
}

// A leading =, +, -, or @ (or tab/CR) makes Excel/Sheets/LibreOffice
// evaluate the cell as a formula instead of text - a real risk here since
// several exported columns (registrant/registrar name, nameservers) come
// straight from a domain's own WHOIS record, which its owner fully
// controls. Prefixing with a single quote forces text interpretation
// (spreadsheet apps hide the leading quote, so this doesn't change what's
// visibly displayed for ordinary values).
const CSV_FORMULA_TRIGGER_RE = /^(?:[\t\r\n ]*[=+\-@]|[\t\r\n])/;

export function toCsvValue(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (CSV_FORMULA_TRIGGER_RE.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows) {
  return rows.map((row) => row.map(toCsvValue).join(',')).join('\n');
}

function splitDelimitedLine(line, delimiter = ',') {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result.map((s) => s.trim());
}

const DOMAIN_HEADER_NAMES = ['domain', 'domain_name', 'domain name', 'hostname', 'name'];

function detectDelimiter(line) {
  const candidates = [',', ';', '\t'];
  let best = null;
  let bestCount = 0;
  for (const delimiter of candidates) {
    const count = splitDelimitedLine(line, delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

// Used only to distinguish a pasted delimiter-separated query list from a
// headerless multi-column CSV. Server-side classifyQuery remains the
// authoritative validator when the scan runs.
function looksLikeLookupToken(value) {
  const token = String(value || '').trim();
  if (!token || /\s/.test(token)) return false;
  if (/^AS\d+$/i.test(token) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(token) || token.includes(':')) return true;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(token) ? token : `https://${token}`);
    return url.hostname.includes('.');
  } catch {
    return false;
  }
}

export function parseDomainInput(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { entries: [], duplicates: 0, usedHeader: false };

  const delimiter = detectDelimiter(lines[0]);
  const firstCells = delimiter ? splitDelimitedLine(lines[0], delimiter) : [lines[0]];
  const header = firstCells.map((cell) => cell.toLowerCase());
  const domainColIdx = header.findIndex((cell) => DOMAIN_HEADER_NAMES.includes(cell));
  const usedHeader = domainColIdx !== -1;

  let candidates;
  if (usedHeader) {
    candidates = lines.slice(1).map((line) => {
      const rowDelimiter = delimiter || detectDelimiter(line);
      const cells = rowDelimiter ? splitDelimitedLine(line, rowDelimiter) : [line];
      return cells[domainColIdx] || '';
    });
  } else {
    const rows = lines.map((line) => {
      const rowDelimiter = detectDelimiter(line);
      return rowDelimiter ? splitDelimitedLine(line, rowDelimiter) : [line];
    });
    const flattened = rows.flat().map((cell) => cell.trim()).filter(Boolean);
    // If every cell looks like a query, this is a pasted comma/semicolon list
    // (possibly wrapped over several lines). Otherwise retain column zero so
    // a headerless "domain,notes" CSV does not scan its notes as domains.
    candidates = lines.length === 1 || (flattened.length > 0 && flattened.every(looksLikeLookupToken))
      ? flattened
      : rows.map((cells) => cells[0] || '');
  }

  const entries = [];
  const seen = new Set();
  let duplicates = 0;
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    entries.push(value);
  }

  return { entries, duplicates, usedHeader };
}
