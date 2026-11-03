// FileLinkSigner accepts one spelling of each link (F21, TEST-SEC-001). A signature that decodes to the same bytes but is written
// differently, a link with an extra segment, or an altered body must all be refused.
import { describe, expect, it } from 'vitest';
import { FileLinkSigner } from '../src/modules/origination/applications/document-store';

type Claims = Parameters<FileLinkSigner['sign']>[0];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const signer = new FileLinkSigner('test-secret-for-file-links-0123456789');
const claims: Claims = { t: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA', k: 'v', i: 'ver_1', d: 'inline', e: 4_000_000_000 } as Claims;

describe('FileLinkSigner (F21)', () => {
  it('verifies a link it issued and returns its claims until it expires', () => {
    const token = signer.sign(claims);
    expect(signer.verify(token, 1_000)?.t).toBe(claims.t);
    expect(signer.verify(token, 4_000_000_001)).toBeNull();
  });

  it('refuses a signature written with a different last character that decodes to the same bytes', () => {
    const token = signer.sign(claims);
    const [body, sig] = token.split('.') as [string, string];
    // The last character of a 32-byte signature carries two padding bits; flipping the lowest bit changes the spelling, not the bytes.
    const other = ALPHABET[ALPHABET.indexOf(sig.slice(-1)) ^ 1]!;
    const altered = `${body}.${sig.slice(0, -1)}${other}`;
    expect(altered).not.toBe(token);
    expect(signer.verify(altered, 1_000)).toBeNull();
  });

  it('refuses a link with an extra segment', () => {
    const token = signer.sign(claims);
    expect(signer.verify(`${token}.x`, 1_000)).toBeNull();
    expect(signer.verify(`${token}.`, 1_000)).toBeNull();
  });

  it('refuses a link whose body was altered', () => {
    const token = signer.sign(claims);
    const [, sig] = token.split('.') as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ ...claims, t: 'ten_other' })).toString('base64url');
    expect(signer.verify(`${forgedBody}.${sig}`, 1_000)).toBeNull();
  });
});
