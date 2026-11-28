// P2-04 lender pack profile rules (owner: Dipanshu). The order and the file names the download uses and the editor previews.
import { describe, expect, it } from 'vitest';
import {
  LenderPackProfilePutSchema,
  defaultPackProfile,
  orderPackDocuments,
  packFileExtension,
  packFileName,
} from './lender-pack';

const file = (over: Partial<Parameters<typeof packFileName>[1]> = {}) => ({
  seq: 1,
  documentTypeCode: 'PAN',
  party: 'PRIMARY' as const,
  originalFileName: 'my pan scan.PDF',
  mimeType: 'application/pdf',
  ...over,
});

describe('P2-04 lender pack profile', () => {
  it('TEST-PACK-001 listed types come first in the lender order; the rest keep their manifest order', () => {
    const docs = ['BANK_STATEMENT', 'SALARY_SLIP', 'PAN', 'ITR', 'PAN'].map((documentTypeCode, i) => ({
      documentTypeCode,
      i,
    }));
    expect(orderPackDocuments(docs, ['PAN', 'BANK_STATEMENT']).map((d) => d.i)).toEqual([2, 4, 0, 1, 3]);
    expect(orderPackDocuments(docs, []).map((d) => d.i)).toEqual([0, 1, 2, 3, 4]);
  });

  it('TEST-PACK-002 names fill the tokens, keep only safe characters and take the original extension', () => {
    expect(packFileName('{seq}_{docType}', file())).toBe('1_PAN.pdf');
    expect(packFileName('{seq}_{docType}_{party}', file({ seq: 2, party: 'CO_APPLICANT' }))).toBe(
      '2_PAN_CoApplicant.pdf',
    );
    expect(packFileName('{seq}-{original}', file())).toBe('1-my-pan-scan.pdf');
    expect(packFileName('{seq} {docType} {party}', file({ party: null }))).toBe('1-PAN.pdf');
    expect(packFileName('{seq}_{original}', file({ originalFileName: '../../etc/passwd' }))).toBe(
      '1_-etc-passwd.pdf',
    );
    expect(packFileName('{seq}_{docType}', file({ originalFileName: 'scan', mimeType: 'image/jpeg' }))).toBe(
      '1_PAN.jpg',
    );
    expect(packFileExtension('noext', null)).toBe('bin');
  });

  it('TEST-PACK-003 a pattern needs {seq}, known tokens and safe text; the order has each type once', () => {
    const ok = { documentOrder: ['PAN', 'BANK_STATEMENT'], filenamePattern: '{seq}_{docType}' };
    expect(LenderPackProfilePutSchema.parse(ok)).toEqual(ok);
    for (const bad of [
      { ...ok, filenamePattern: '{docType}_file' },
      { ...ok, filenamePattern: '{seq}_{name}' },
      { ...ok, filenamePattern: '{seq}/{docType}' },
      { ...ok, documentOrder: ['PAN', 'PAN'] },
      { ...ok, documentOrder: ['pan'] },
      { ...ok, mergePdf: true },
    ]) {
      expect(LenderPackProfilePutSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('TEST-PACK-004 the default profile is version 0 with the manifest order and {seq}_{docType}', () => {
    expect(defaultPackProfile('lnd_1')).toMatchObject({
      isDefault: true,
      version: 0,
      documentOrder: [],
      filenamePattern: '{seq}_{docType}',
    });
  });
});
