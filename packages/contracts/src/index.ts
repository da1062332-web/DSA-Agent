// @dsa/contracts — the only code shared across modules and with the web app (Contracts §2, §14).
// A type used by more than one module lives here, owned by the provider of the concept.
export * from './errors';
export * from './money';
export * from './ids';
export * from './pagination';
export * from './events';
export * from './permissions';
export * from './kernel';
export * from './users';
export * from './config';
export type { Database } from './db';

export type * from './ports/crm-ports';
export type * from './ports/decision-keys';
export type * from './ports/decision-port';
export type * from './ports/rules-seeder-port';
export type * from './ports/task-port';
export type * from './ports/application-port';
