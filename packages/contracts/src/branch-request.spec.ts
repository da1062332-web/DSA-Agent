// CreateBranchRequest (FR-TEN-007). The tenant is taken only from the token, so a body that names a tenant is refused.
import { describe, expect, it } from 'vitest';
import { CreateBranchRequest } from './config';

const valid = { code: 'NSK01', name: 'Nashik', pincode: '422001', timezone: 'Asia/Kolkata' };

describe('branch request (TEST-TEN-CONTRACT)', () => {
  it('accepts the fields the branch form sends', () => {
    expect(CreateBranchRequest.safeParse(valid).success).toBe(true);
    expect(
      CreateBranchRequest.safeParse({
        code: 'NSK01',
        name: 'Nashik',
        pincode: null,
        timezone: 'Asia/Kolkata',
      }).success,
    ).toBe(true);
  });

  it('refuses a tenant id in the body instead of ignoring it', () => {
    const res = CreateBranchRequest.safeParse({ ...valid, tenantId: 'ten_01JTESTTENANT00000000000000' });
    expect(res.success).toBe(false);
  });
});
