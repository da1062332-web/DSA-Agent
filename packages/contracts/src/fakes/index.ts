// Port fakes for tests (Contracts §4.5). Each fake is owned by its port's provider and must pass the same
// contract test as the real implementation. Import from '@dsa/contracts/fakes' in tests only.
export * from './fake-consent';
export * from './fake-party';
export * from './fake-data-sharing';
export * from './fake-user-directory';

// TODO(Gate 1) — delivered by the port owners:
//   fake-decision.ts       FakeDecisionPort      (Dev 2)
//   fake-rules-seeder.ts   no-op RulesSeederPort (Dev 2)
//   fake-task.ts           FakeTaskPort          (Dev 6)
//   fake-application.ts    FakeApplicationPort   (Dev 3)
