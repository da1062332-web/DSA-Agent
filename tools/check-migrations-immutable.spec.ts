import { describe, expect, it } from 'vitest';
import { checkLock, hashMigration } from './check-migrations-immutable';

describe('TEST-MIG-LOCK merged migrations are never edited', () => {
  it('TEST-MIG-LOCK-01 reports a changed, a missing and an unrecorded file separately', () => {
    const lock = { 'a.sql': hashMigration('create table a();'), 'b.sql': hashMigration('create table b();') };
    const files = { 'a.sql': hashMigration('create table a(x int);'), 'c.sql': hashMigration('create table c();') };
    expect(checkLock(files, lock)).toEqual({ changed: ['a.sql'], missing: ['b.sql'], unrecorded: ['c.sql'] });
  });

  it('TEST-MIG-LOCK-02 line endings do not count as an edit', () => {
    expect(hashMigration('select 1;\r\nselect 2;\r\n')).toBe(hashMigration('select 1;\nselect 2;\n'));
  });
});
