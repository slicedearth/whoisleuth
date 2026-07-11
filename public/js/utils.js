// Generic helpers with no dependency on any particular feature - string/HTML
// escaping, date formatting, and CSV/file parsing shared across single
// lookup, bulk lookup, and the generators.

// Escapes " and ' too, not just the three HTML-syntax characters - this is
// used to build attribute values (title="...", data-domain="...") all over
// the app, and an unescaped double quote in the source text (e.g. a literal
// "registered" in a tooltip label) would otherwise close the attribute
// early and truncate/corrupt the rendered element.
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Some registries fill a redacted field with a literal placeholder string
// (e.g. "REDACTED FOR PRIVACY") instead of omitting it - printed verbatim
// that reads as if it were real data, and worse, a mailto: link built from
// it would target that literal text as an email address. Same marker list
// lib/availability.js uses server-side for the privacyProtected signal;
// kept here too since render.js/outreach.js/abuse.js work from the raw
// RDAP/WHOIS field values directly, not that derived signal.
const REDACTION_MARKERS = [
  /redacted for privacy/i,
  /data protected/i,
  /privacy\s*protect/i,
  /whoisguard/i,
  /domains by proxy/i,
  /perfect privacy/i,
  /contact privacy/i,
  /private registration/i,
  /identity protect/i,
  /not disclosed/i,
  /withheld for privacy/i,
  /^redacted$/i,
];

export function isRedactionPlaceholder(value) {
  return typeof value === 'string' && REDACTION_MARKERS.some((re) => re.test(value));
}

// Deliberately conservative (no +tags, no comments, no quoted local parts) -
// this only gates whether a WHOIS/RDAP-sourced string is safe to drop into a
// mailto: URI as the recipient, not a general email validator. mailto:
// treats a comma as an additional-recipient separator (RFC 6068), so a
// registrant/abuse-contact field containing e.g. "victim@x.com,cc@evil.com"
// would silently add a second recipient to the outreach/abuse draft the user
// opens - rejecting anything outside a single plain address closes that off.
const SIMPLE_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidEmailAddress(value) {
  return typeof value === 'string' && SIMPLE_EMAIL_RE.test(value.trim());
}

// Hamming distance (0-64) between two 16-hex perceptual dHash strings (see
// lib/perceptual-hash.js), or null if either isn't a well-formed hash. Smaller
// = more visually similar. Shared by the brand-profile near-match check and
// bulk favicon clustering; mirrors the backend's hammingDistanceHex (the two
// can't share code - one is a CJS lib, the other a browser ESM module).
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
// lib/perceptual-hash.js's MIN_INFORMATIVE_BITS, mirrored here). Generation
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

export function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function kv(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

// A leading =, +, -, or @ (or tab/CR) makes Excel/Sheets/LibreOffice
// evaluate the cell as a formula instead of text - a real risk here since
// several exported columns (registrant/registrar name, nameservers) come
// straight from a domain's own WHOIS record, which its owner fully
// controls. Prefixing with a single quote forces text interpretation
// (spreadsheet apps hide the leading quote, so this doesn't change what's
// visibly displayed for ordinary values).
const CSV_FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

export function toCsvValue(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (CSV_FORMULA_TRIGGER_RE.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Wires a delegated click handler for a "Copy draft" button that appears
// next to a mailto: link (outreach.js and abuse.js both use this same
// pattern - a domain-keyed draft plus clipboard fallback for anyone without
// a desktop mail client). `getText(domain)` should return the draft text
// for that button's domain, or a falsy value if there's nothing to copy.
export function wireCopyToClipboard(buttonClass, getText) {
  document.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest(`.${buttonClass}`);
    if (!(btn instanceof HTMLElement)) return;
    const text = getText(btn.dataset.domain);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    } catch {
      /* clipboard access denied - the mailto link above still works as a fallback */
    }
  });
}

// Wraps a single localStorage key as JSON, with parse/stringify and a
// try/catch on both read and write - shortlist.js, watchlist.js, and
// brand-profiles.js each kept their own copy of this exact pattern (only the
// key and default value differed). `load()` always returns a value parsed
// fresh from `defaultValue`'s own JSON (whether that's because the key is
// missing or storage/JSON access failed), matching what the original
// per-feature copies did - never the same object instance handed back
// twice, so a caller mutating one loaded copy can't affect another.
export function createLocalStore(key, defaultValue) {
  const defaultJson = JSON.stringify(defaultValue);
  return {
    load() {
      try {
        return JSON.parse(localStorage.getItem(key) ?? defaultJson);
      } catch {
        return JSON.parse(defaultJson);
      }
    },
    save(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage full/unavailable - value just won't persist this time */
      }
    },
  };
}

// Shared by shortlist.js/watchlist.js/brand-profiles.js's "export to a JSON
// file" buttons - only the data and filename prefix differ.
export function exportJsonFile(data, filenamePrefix) {
  downloadBlob(JSON.stringify(data, null, 2), `${filenamePrefix}-${Date.now()}.json`, 'application/json;charset=utf-8;');
}

// Shared by CSV export (bulk.js) and JSON export (shortlist.js/watchlist.js) -
// only the content/filename/MIME type differ, the actual "trigger a browser
// download" mechanics are identical.
export function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Types `text` into el one character at a time - purely decorative (the
// terminal-prompt-echo lines), so it respects prefers-reduced-motion by
// just setting the text instantly instead. Cancels any run already in
// progress on this element (a fast repeat lookup shouldn't leave two
// competing timers racing to finish the same line).
const typingTimers = new WeakMap();
export function typeText(el, text, { speed = 18 } = {}) {
  const pending = typingTimers.get(el);
  if (pending) clearTimeout(pending);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = text;
    return;
  }

  el.textContent = '';
  let i = 0;
  const tick = () => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i < text.length) typingTimers.set(el, setTimeout(tick, speed));
    else typingTimers.delete(el);
  };
  tick();
}

// Runs `worker` over `items` with up to `concurrency` in flight at once,
// passing each item's original index alongside it so a caller that needs to
// write results into a pre-sized array (to preserve order despite
// out-of-order completion) can do so. Concurrency lives here (client-side)
// rather than in a single long-lived server request/stream, so a bulk scan
// or audit is just N independent /api/... calls - the same shape whether
// the backend is a long-running Express server or a short-lived serverless
// function, which only ever handles one request per invocation. Shared by
// bulk.js (scanning candidate domains) and brand-profiles.js (auditing a
// profile's official domains).
export async function runPool(items, concurrency, worker) {
  let idx = 0;
  const size = Math.min(concurrency, items.length) || 1;
  const runners = new Array(size).fill(0).map(async () => {
    while (idx < items.length) {
      const current = idx++;
      await worker(items[current], current);
    }
  });
  await Promise.allSettled(runners);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsText(file);
  });
}

function splitCsvLine(line) {
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
    } else if (ch === ',' && !inQuotes) {
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

export function parseDomainsFromText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const domainColIdx = header.findIndex((h) => DOMAIN_HEADER_NAMES.includes(h));

  let dataLines = lines;
  let colIdx = 0;
  if (domainColIdx !== -1) {
    dataLines = lines.slice(1);
    colIdx = domainColIdx;
  }

  return dataLines
    .map((line) => splitCsvLine(line)[colIdx] || '')
    .map((s) => s.trim())
    .filter(Boolean);
}
