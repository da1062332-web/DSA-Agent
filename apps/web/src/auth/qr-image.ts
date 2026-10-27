// Turns the QR value from Supabase into an image source for the enrolment screen.
// The auth client returns the QR as "data:image/svg+xml;utf-8," followed by the raw SVG, without encoding it. A raw "#" in the SVG
// (for example a fill colour) ends a data URI early, so the barcode would not load. The SVG is therefore percent-encoded here.
// An image that is already encoded, or base64, is passed through. Anything that is not an image gives an empty string.
const SVG_PREFIX = 'data:image/svg+xml;utf-8,';

export function qrImageSource(qr: string | null | undefined): string {
  const value = (qr ?? '').trim();
  if (value.startsWith(SVG_PREFIX)) {
    const payload = value.slice(SVG_PREFIX.length).trim();
    return payload.startsWith('<') ? `${SVG_PREFIX}${encodeURIComponent(payload)}` : value;
  }
  if (value.startsWith('data:image/')) return value;
  if (value.startsWith('<')) return `${SVG_PREFIX}${encodeURIComponent(value)}`;
  return '';
}
