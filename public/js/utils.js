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

export function toCsvValue(v) {
  const s = v === null || v === undefined ? '' : String(v);
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
    const btn = e.target.closest(`.${buttonClass}`);
    if (!btn) return;
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
