import { SaxesParser, type SaxesTagNS } from 'saxes';
import { extractBoundedZipEntries } from '../interchange/bounded-zip-extraction.mts';
import { decodeEvidencePng } from '../evidence/png-pixels.mts';
import { createDocumentIntake } from './document-intake.mts';
import { MAX_DOCUMENT_PARTS, MAX_DOCUMENT_DECODED_BYTES, MAX_DOCUMENT_TEXT_BYTES,
  MAX_DOCUMENT_XML_DEPTH, MAX_DOCUMENT_XML_NODES } from '../contracts/document-intake.mts';
import { MAX_MESSAGE_INTAKE_BYTES, MAX_INTAKE_LINKS, MAX_INTAKE_URL_LENGTH } from '../contracts/message-intake.mts';

const WORD_NAMESPACES = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const RELATIONSHIP_NAMESPACES = new Set(['http://schemas.openxmlformats.org/package/2006/relationships', 'http://purl.oclc.org/ooxml/package/relationships']);
const WORD_PART = /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/u;
const RELATIONSHIP_PART = /^word\/(?:[^/]+\/)*_rels\/[^/]+\.rels$/u;
const MEDIA_PART = /^word\/media\/[^/]+$/u;

function archiveKey(name: string): string {
  const parts = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  if (!name || name.length > 512 || /[\\\x00-\x1f\x7f]/u.test(name) || parts.some(part => !part || part === '.' || part === '..')) throw new TypeError('The document contains an unsafe archive path.');
  return name.normalize('NFC').toLowerCase();
}
function xmlText(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0 ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

export async function reviewDocxInput(bytes: Uint8Array, reviewedAt: string) {
  const review = await createDocumentIntake(bytes, 'docx', reviewedAt);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    review.unavailable('unsupported', 'This is a compound document, which may be encrypted or a legacy format. Export an unencrypted DOCX copy for review.');
    return review.finish();
  }
  let unsupportedParts = 0;
  const { files } = extractBoundedZipEntries(bytes, {
    maximumEntries: MAX_DOCUMENT_PARTS, maximumSelectedBytes: MAX_DOCUMENT_DECODED_BYTES,
    selectedBytesExceededMessage: 'The document exceeds the decoded-byte review bound.', metadataMismatchMessage: 'The DOCX archive is encrypted, malformed or outside supported ZIP bounds.',
    keyForName: archiveKey,
    inspect(entry, metadata) {
      const key = archiveKey(entry.name);
      if (metadata.kind === 'special') throw new TypeError('Document archives cannot contain special filesystem entries.');
      const xml = entry.name === '[Content_Types].xml' || WORD_PART.test(entry.name) || RELATIONSHIP_PART.test(entry.name);
      const png = MEDIA_PART.test(entry.name) && /\.png$/iu.test(entry.name);
      if (entry.name.startsWith('word/embeddings/') || /(?:vbaProject\.bin|\.jpe?g|\.webp|\.svg|\.wmf|\.emf|\.gif)$/iu.test(entry.name)) unsupportedParts++;
      return { key, selected: xml || png, maximumBytes: png ? MAX_MESSAGE_INTAKE_BYTES : MAX_DOCUMENT_TEXT_BYTES, exceededMessage: 'A document part exceeds the local review bound.' };
    },
  });
  if (!files.has('[Content_Types].xml') || !files.has('word/document.xml')) throw new TypeError('The selected archive is not a supported DOCX document.');
  let nodes = 0, declaredMain = false, externalResources = 0;
  function parseXml(input: Uint8Array, callbacks: { open?: (tag: SaxesTagNS) => void; close?: (tag: SaxesTagNS) => void; text?: (value: string) => void }) {
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    parser.on('doctype', () => { throw new TypeError('Document XML declarations cannot define entities.'); });
    parser.on('error', () => { throw new TypeError('A document XML part is malformed.'); });
    parser.on('opentag', tag => {
      if (++nodes > MAX_DOCUMENT_XML_NODES || ++depth > MAX_DOCUMENT_XML_DEPTH) throw new TypeError('Document XML exceeds the structural review bound.');
      callbacks.open?.(tag);
    });
    parser.on('closetag', tag => { callbacks.close?.(tag); depth--; });
    parser.on('text', value => callbacks.text?.(value));
    parser.on('cdata', value => callbacks.text?.(value));
    const inputText = xmlText(input);
    for (let offset = 0; offset < inputText.length; offset += 4096) parser.write(inputText.slice(offset, offset + 4096));
    parser.close();
  }
  const attr = (tag: SaxesTagNS, name: string) => Object.values(tag.attributes).find(value => value.local === name && value.uri === '')?.value;
  parseXml(files.get('[Content_Types].xml')!, { open(tag) {
    if (tag.local === 'Override' && tag.uri === 'http://schemas.openxmlformats.org/package/2006/content-types'
      && attr(tag, 'PartName') === '/word/document.xml' && attr(tag, 'ContentType') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') declaredMain = true;
  } });
  if (!declaredMain) throw new TypeError('The selected archive does not declare an ordinary DOCX document. Macro-enabled and other document types are not interpreted as DOCX.');
  for (const [name, body] of files) {
    if (WORD_PART.test(name)) {
      try {
        let text = '', textDepth = 0;
        parseXml(body, { open(tag) { if (WORD_NAMESPACES.has(tag.uri) && ['t', 'instrText'].includes(tag.local)) textDepth++; },
          close(tag) { if (WORD_NAMESPACES.has(tag.uri) && ['t', 'instrText'].includes(tag.local)) textDepth--; if (WORD_NAMESPACES.has(tag.uri) && ['p', 'tab', 'br'].includes(tag.local)) text += '\n'; },
          text(value) { if (textDepth) { if (text.length + value.length > MAX_DOCUMENT_TEXT_BYTES) throw new TypeError('Document text exceeds its review bound.'); text += value; } } });
        await review.text(text, null, body);
      } catch { review.partial('A document text part could not be fully decoded within the XML review bounds.'); }
    } else if (RELATIONSHIP_PART.test(name)) {
      try {
        const destinations: string[] = [];
        parseXml(body, { open(tag) {
          if (tag.local !== 'Relationship' || !RELATIONSHIP_NAMESPACES.has(tag.uri) || attr(tag, 'TargetMode') !== 'External') return;
          const type = attr(tag, 'Type'), target = attr(tag, 'Target');
          if (type !== 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink' && type !== 'http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink') { externalResources++; return; }
          if (!target || target.length > MAX_INTAKE_URL_LENGTH || destinations.length >= MAX_INTAKE_LINKS) { review.partial('Some relationship targets exceed the link review bound.'); return; }
          destinations.push(target);
        } });
        await review.destinations(destinations, null, body);
      } catch { review.partial('A relationship part could not be fully decoded within the XML review bounds.'); }
    } else if (MEDIA_PART.test(name)) {
      try { await review.image(decodeEvidencePng(body), null, body); }
      catch { review.partial('An embedded image was unsupported, malformed or outside the pixel review bounds.'); }
    }
  }
  if (externalResources) review.partial(`${externalResources} external non-link resources were declared but not requested.`);
  if (unsupportedParts) review.partial(`${unsupportedParts} embedded objects or non-PNG images were not decoded.`);
  // Text/relationships are declarations in the selected package, not a rendered page.
  review.partial('DOCX page layout, vector artwork, embedded objects and non-PNG images are not rendered. Link relationships can include unused declarations.');
  return review.finish();
}
