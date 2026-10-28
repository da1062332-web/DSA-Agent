// The enrolment barcode: what the screen shows for each value Supabase can return. Pure functions, no rendering.
import { describe, expect, it } from 'vitest';
import { qrImageSource } from './qr-image';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="#000"/></svg>';

describe('qrImageSource', () => {
  it('TEST-QR-01 SVG markup from Supabase becomes an SVG data URI that decodes to the same markup', () => {
    const src = qrImageSource(svg);
    expect(src.startsWith('data:image/svg+xml;utf-8,')).toBe(true);
    expect(decodeURIComponent(src.slice('data:image/svg+xml;utf-8,'.length))).toBe(svg);
  });

  it('TEST-QR-02 leading whitespace and an XML declaration do not stop the barcode from showing', () => {
    const withDeclaration = `\n  <?xml version="1.0"?>${svg}\n`;
    const src = qrImageSource(withDeclaration);
    expect(src.startsWith('data:image/svg+xml;utf-8,')).toBe(true);
    expect(decodeURIComponent(src.slice('data:image/svg+xml;utf-8,'.length))).toBe(withDeclaration.trim());
  });

  it('TEST-QR-03 an image data URI is passed through unchanged', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo=';
    expect(qrImageSource(uri)).toBe(uri);
  });

  it('TEST-QR-04 a missing or non-image value gives no source, so no broken image is shown', () => {
    expect(qrImageSource(undefined)).toBe('');
    expect(qrImageSource(null)).toBe('');
    expect(qrImageSource('')).toBe('');
    expect(qrImageSource('   ')).toBe('');
    expect(qrImageSource('https://example.test/not-an-image')).toBe('');
  });

  it('TEST-QR-05 the auth client returns the SVG unencoded in a data URI; a "#" in it must not end the image early', () => {
    const coloured = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f172a"/></svg>';
    const fromClient = `data:image/svg+xml;utf-8,${coloured}`;
    const src = qrImageSource(fromClient);
    expect(src.startsWith('data:image/svg+xml;utf-8,')).toBe(true);
    expect(src).not.toContain('#');
    expect(src).not.toContain('"');
    expect(decodeURIComponent(src.slice('data:image/svg+xml;utf-8,'.length))).toBe(coloured);
  });

  it('TEST-QR-06 a data URI whose SVG is already encoded is not encoded twice', () => {
    const encoded = `data:image/svg+xml;utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#000"/></svg>')}`;
    expect(qrImageSource(encoded)).toBe(encoded);
  });
});
