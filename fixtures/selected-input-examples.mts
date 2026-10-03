import { Encoder, Byte } from '@nuintun/qrcode';
import { encode } from 'fast-png';
import { zipSync, zlibSync } from 'fflate';

const text = (value: string) => new TextEncoder().encode(value);
function join(parts: readonly Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; } return bytes;
}
function qr() {
  const symbol = new Encoder().encode(new Byte('https://document-qr.example/private?token=private-value'));
  const width = (symbol.size + 8) * 4, data = new Uint8Array(width * width * 3);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const qx = Math.floor(x / 4) - 4, qy = Math.floor(y / 4) - 4;
    const colour = qx >= 0 && qy >= 0 && qx < symbol.size && qy < symbol.size && symbol.get(qx, qy) ? 0 : 255;
    data.fill(colour, (y * width + x) * 3, (y * width + x + 1) * 3);
  }
  return { width, height: width, data, channels: 3 as const };
}

/** A small genuine PDF with text, a URI annotation and an embedded QR image. */
export function selectedPdfFixture(encrypted = false): Uint8Array {
  const image = qr(), pixels = zlibSync(image.data);
  const content = 'BT /F1 12 Tf 20 760 Td (https://pdf-text.example/private?token=private-value) Tj ET\nq 220 0 0 220 20 400 cm /Im0 Do Q';
  const objects = [
    text('<< /Type /Catalog /Pages 2 0 R >>'),
    text('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    text('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 7 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>'),
    text('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    text(`<< /Length ${text(content).length} >>\nstream\n${content}\nendstream`),
    text('<< /Type /Annot /Subtype /Link /Rect [20 740 200 780] /A << /S /URI /URI (https://pdf-link.example/private?token=private-value) >> >>'),
    join([text(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`), pixels, text('\nendstream')]),
    ...(encrypted ? [text(`<< /Filter /Standard /V 1 /R 2 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`)] : []),
  ];
  const parts: Uint8Array[] = [text('%PDF-1.7\n')], offsets = [0];
  let length = parts[0]!.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length); const value = join([text(`${index + 1} 0 obj\n`), object, text('\nendobj\n')]); parts.push(value); length += value.length;
  }
  parts.push(text(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt 8 0 R /ID [<${'11'.repeat(16)}><${'11'.repeat(16)}>]` : ''} >>\nstartxref\n${length}\n%%EOF\n`));
  return join(parts);
}

export function selectedDocxEntries() {
  return {
    '[Content_Types].xml': text('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': text('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>https://docx-text.example/private?token=private-value</w:t></w:r></w:p></w:body></w:document>'),
    'word/_rels/document.xml.rels': text('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://docx-link.example/private?token=private-value"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://never-fetch.example/private"/></Relationships>'),
    'word/media/image1.png': encode(qr()),
  };
}
export function selectedDocxFixture() { return zipSync(selectedDocxEntries()); }
export function selectedHarFixture() {
  return text(JSON.stringify({ log: { version: '1.2', entries: [
    { startedDateTime: '2026-09-20T10:01:00+10:00', time: 0, request: { method: 'POST', url: 'https://request.example/private?access_token=private-value', headers: [{ name: 'Authorization', value: 'Bearer private-value' }], cookies: [{ name: 'session', value: 'private-value' }], postData: { text: 'private-value' } }, response: { status: 302, content: { mimeType: 'text/html', text: 'private-body' } }, timings: { dns: -1, connect: 0, send: 0, wait: 0, receive: 0 }, _resourceType: 'document' },
    { startedDateTime: '2026-09-20T00:00:59Z', time: -1, request: { method: 'GET', url: 'https://later.example/private' }, response: { status: 0, content: {} }, timings: { dns: -1 }, _resourceType: 'fetch', _error: 'private-error' },
  ] } }));
}
