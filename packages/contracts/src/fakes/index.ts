// Port fakes for tests (Contracts §4.5). Each fake is owned by its port's provider and must pass the same
// contract test as the real implementation. Import from '@dsa/contracts/fakes' in tests only.
export * from './fake-consent';
export * from './fake-party';
export * from './fake-data-sharing';
export * from './fake-user-directory';

export * from './fake-decision';
export * from './fake-application';
export * from './fake-task';
export * from './fake-complaint-subject';
export * from './fake-product-version';

