// Demo platform seed — owner: Dev 1 — TASK-103. Synthetic data only (ASM-4D-06).
// Two tenants with IDENTICAL natural keys (branch codes, team names, role codes, queue codes) so the isolation
// suite (TEST-SEC-001) can prove that the same key in another tenant is invisible. Emails differ only because
// Supabase Auth emails are global. Loaded by tools/provision-tenant.ts.
//
// MOD-ORG (DSA Notion, MODULE 2): TENANT-ADMIN and ORG-OWNER hold config.manage; BRANCH-MGR manages teams and
// membership in its branch (user.manage at BRANCH scope).
// TODO(TASK-104): confirm the rest of the role → permission map against Contracts §8 / Doc 03 §5.6 before Gate 1.

export type Scope = 'OWN' | 'TEAM' | 'BRANCH' | 'TENANT';

export interface RoleSeed {
  code: string;
  name: string;
  permissions: string[];
}

export interface UserSeed {
  handle: string; // local part of the email, unique per tenant
  displayName: string;
  branch: string; // branch code
  roles: { code: string; scope: Scope; branches?: string[] }[];
}

export interface TenantSeed {
  slug: string;
  legalName: string;
  organisation: { legalName: string; constitution: 'PVT_LTD' };
}

export const TENANTS: TenantSeed[] = [
  {
    slug: 'demo-alpha',
    legalName: 'Alpha Demo Finserv',
    organisation: { legalName: 'Alpha Demo Finserv Pvt Ltd', constitution: 'PVT_LTD' },
  },
  {
    slug: 'demo-beta',
    legalName: 'Beta Demo Loans',
    organisation: { legalName: 'Beta Demo Loans Pvt Ltd', constitution: 'PVT_LTD' },
  },
];

export const BRANCHES = [
  { code: 'MUM01', name: 'Mumbai Central', pincode: '400008' },
  { code: 'PUN01', name: 'Pune Camp', pincode: '411001' },
];

const LEAD_WORK = [
  'lead.read',
  'lead.create',
  'lead.update',
  'lead.qualify',
  'consent.record',
  'activity.create',
  'customer.read',
];
const TASK_WORK = ['task.read', 'task.create', 'task.update'];

export const ROLES: RoleSeed[] = [
  {
    code: 'ROLE-TENANT-ADMIN',
    name: 'Tenant administrator',
    permissions: ['config.manage', 'user.manage', 'audit.read', 'verification.read', 'verification.perform'],
  },
  {
    code: 'ROLE-ORG-OWNER',
    name: 'DSA owner',
    permissions: [
      'config.manage',
      'lead.read',
      'customer.read',
      'task.read',
      'application.read',
      'audit.read',
      'verification.read',
      'verification.perform',
    ],
  },
  {
    code: 'ROLE-BRANCH-MGR',
    name: 'Branch manager',
    permissions: [
      ...LEAD_WORK,
      'lead.assign',
      ...TASK_WORK,
      'application.read',
      'application.review',
      'user.manage',
      'verification.read',
      'verification.perform',
    ],
  },
  {
    code: 'ROLE-TEAM-MGR',
    name: 'Team manager',
    permissions: [...LEAD_WORK, 'lead.assign', ...TASK_WORK, 'application.read'],
  },
  {
    code: 'ROLE-RM',
    name: 'Relationship manager',
    permissions: [
      ...LEAD_WORK,
      ...TASK_WORK,
      'application.read',
      'application.create',
      'application.update',
      'application.cancel',
    ],
  },
  {
    code: 'ROLE-SALES-EXEC',
    name: 'Sales executive',
    permissions: [...LEAD_WORK, 'task.read', 'task.update'],
  },
  {
    code: 'ROLE-LOAN-OPS',
    name: 'Loan operations',
    permissions: [
      'application.read',
      'application.update',
      'application.review',
      'document.review',
      'lender_case.submit',
      'lender_case.update_status',
      'task.read',
      'task.update',
      'verification.perform',
      'verification.read',
    ],
  },
  {
    code: 'ROLE-DOC-VERIFIER',
    name: 'Document verifier',
    permissions: [
      'application.read',
      'document.review',
      'verification.perform',
      'verification.read',
    ],
  },
  {
    code: 'ROLE-COMPLIANCE',
    name: 'Compliance',
    permissions: ['lead.read', 'customer.read', 'application.read', 'audit.read', 'verification.read'],
  },
  { code: 'ROLE-RULE-AUTHOR', name: 'Rule author', permissions: ['rule.author', 'rule.simulate'] },
  {
    code: 'ROLE-RULE-APPROVER',
    name: 'Rule approver',
    permissions: ['rule.simulate', 'rule.approve', 'rule.publish', 'rule.suspend'],
  },
];

export const TEAM = {
  name: 'MUM01 Sales',
  branch: 'MUM01',
  manager: 'teammgr',
  members: ['rm1', 'rm2', 'sales1'],
};

export const USERS: UserSeed[] = [
  {
    handle: 'admin',
    displayName: 'Asha Admin',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-TENANT-ADMIN', scope: 'TENANT' }],
  },
  {
    handle: 'owner',
    displayName: 'Omkar Owner',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-ORG-OWNER', scope: 'TENANT' }],
  },
  {
    handle: 'branchmgr',
    displayName: 'Bhavna Branch',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-BRANCH-MGR', scope: 'BRANCH', branches: ['MUM01'] }],
  },
  {
    handle: 'teammgr',
    displayName: 'Tarun Team',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-TEAM-MGR', scope: 'TEAM' }],
  },
  { handle: 'rm1', displayName: 'Riya RM', branch: 'MUM01', roles: [{ code: 'ROLE-RM', scope: 'OWN' }] },
  { handle: 'rm2', displayName: 'Rohan RM', branch: 'MUM01', roles: [{ code: 'ROLE-RM', scope: 'OWN' }] },
  {
    handle: 'sales1',
    displayName: 'Sameer Sales',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-SALES-EXEC', scope: 'OWN' }],
  },
  {
    handle: 'loanops',
    displayName: 'Lata Loan Ops',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-LOAN-OPS', scope: 'BRANCH', branches: ['MUM01', 'PUN01'] }],
  },
  {
    handle: 'compliance',
    displayName: 'Chetan Compliance',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-COMPLIANCE', scope: 'TENANT' }],
  },
  {
    handle: 'ruleauthor',
    displayName: 'Rekha Author',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-RULE-AUTHOR', scope: 'TENANT' }],
  },
  {
    handle: 'ruleapprover',
    displayName: 'Ravi Approver',
    branch: 'MUM01',
    roles: [{ code: 'ROLE-RULE-APPROVER', scope: 'TENANT' }],
  },
  { handle: 'rmpune', displayName: 'Pooja RM', branch: 'PUN01', roles: [{ code: 'ROLE-RM', scope: 'OWN' }] },
];

/** INTAKE and UNASSIGNED per branch (one of each is enforced by unique indexes), plus the team queue. */
export const QUEUES = [
  ...BRANCHES.flatMap((b) => [
    {
      code: `${b.code}-INTAKE`,
      name: `${b.name} intake`,
      kind: 'INTAKE',
      branch: b.code,
      team: false,
      recordTypes: ['LEAD'],
    },
    {
      code: `${b.code}-UNASSIGNED`,
      name: `${b.name} unassigned`,
      kind: 'UNASSIGNED',
      branch: b.code,
      team: false,
      recordTypes: ['LEAD', 'TASK'],
    },
  ]),
  {
    code: 'MUM01-SALES',
    name: 'MUM01 Sales team',
    kind: 'TEAM',
    branch: 'MUM01',
    team: true,
    recordTypes: ['LEAD', 'TASK'],
  },
] as const;

/** queue code → members. `assign` lets the member assign records from the queue. */
export const QUEUE_MEMBERS: Record<string, { handle: string; assign?: boolean }[]> = {
  'MUM01-INTAKE': [
    { handle: 'sales1' },
    { handle: 'rm1' },
    { handle: 'rm2' },
    { handle: 'branchmgr', assign: true },
  ],
  'MUM01-UNASSIGNED': [
    { handle: 'branchmgr', assign: true },
    { handle: 'teammgr', assign: true },
  ],
  'PUN01-INTAKE': [{ handle: 'rmpune' }],
  'PUN01-UNASSIGNED': [{ handle: 'rmpune', assign: true }],
  'MUM01-SALES': [
    { handle: 'teammgr', assign: true },
    { handle: 'rm1' },
    { handle: 'rm2' },
    { handle: 'sales1' },
  ],
};

// Short local-only logins: admin@alpha.com, rm1@beta.com … (synthetic; mail only reaches the local Mailpit).
export const emailFor = (tenant: TenantSeed, handle: string) =>
  `${handle}@${tenant.slug.replace(/^demo-/, '')}.com`;
