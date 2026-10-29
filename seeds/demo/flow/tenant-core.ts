// Tenant core for the flow-wise demo seed — owner: Dev 1. Synthetic data only (ASM-4D-06).
// Reuses people, roles and queues from ../platform.ts and adds local-only branches, teams and queues so every
// table in this group has at least eight rows per demo tenant. Pilot tenants exist only as tenant rows.
import { QUEUE_MEMBERS, ROLES, TEAM, TENANTS, USERS } from '../platform';
import type { Tables } from './types';
import { ANCHOR, type Row, at, ix, mobileFor, onDate, pad, sha256Hex } from './types';

export interface Tenant {
  tag: string;
  tagDigit: string;
  id: string;
  slug: string;
  name: string;
  orgs: string[];
  branches: Record<string, string>; // branch code -> id
  users: Record<string, string>; // handle -> app_user id
  teams: Record<string, string>; // team key -> id
  queues: Record<string, string>; // queue code -> id
  roles: Record<string, string>; // role code -> id
  connectorUsers: string[];
  actor: string; // admin user id, used as created_by
}

/** Deterministic id: prefix_tag_suffix. Keeps ids readable in the database and stable between runs. */
export const idOf = (t: Tenant, prefix: string, suffix: number | string) =>
  `${prefix}_${t.tag}_${typeof suffix === 'number' ? pad(suffix) : suffix}`;

/** Connector ids are fixed up front so connector users and finance rows can refer to them. */
export const CONNECTORS = 8;
export const connectorId = (t: Tenant, n: number) => idOf(t, 'con', n);

export const BRANCH_DEFS = [
  { code: 'MUM01', name: 'Mumbai Central', pincode: '400008', org: 0 },
  { code: 'PUN01', name: 'Pune Camp', pincode: '411001', org: 0 },
  { code: 'BLR01', name: 'Bengaluru MG Road', pincode: '560001', org: 1 },
  { code: 'DEL01', name: 'Delhi Connaught Place', pincode: '110001', org: 1 },
  { code: 'HYD01', name: 'Hyderabad Banjara Hills', pincode: '500034', org: 2 },
  { code: 'AHM01', name: 'Ahmedabad Navrangpura', pincode: '380009', org: 2 },
  { code: 'CHN01', name: 'Chennai T Nagar', pincode: '600017', org: 3 },
  { code: 'KOL01', name: 'Kolkata Park Street', pincode: '700016', org: 3 },
];

const ORG_SUFFIXES = [
  { suffix: 'Pvt Ltd', constitution: 'PVT_LTD' },
  { suffix: 'Capital LLP', constitution: 'LLP' },
  { suffix: 'Partners', constitution: 'PARTNERSHIP' },
  { suffix: 'Proprietary Services', constitution: 'PROPRIETORSHIP' },
  { suffix: 'Insurance Brokers LLP', constitution: 'LLP' },
  { suffix: 'Home Finance Partners', constitution: 'PARTNERSHIP' },
  { suffix: 'Trust Services', constitution: 'TRUST' },
  { suffix: 'Advisory Pvt Ltd', constitution: 'PVT_LTD' },
] as const;

/**
 * Partner portal logins (user_type CONNECTOR), one per seeded connector. They are not staff: they hold no internal role, so they reach
 * only their own connector through the portal. The label says so, to tell them apart from internal relationship managers.
 */
const CONNECTOR_USERS = [
  { handle: 'conuser1', displayName: 'Partner login: Connector Portal One', branch: 'MUM01' },
  { handle: 'conuser2', displayName: 'Partner login: Connector Portal Two', branch: 'PUN01' },
];

/** Local-only teams for the branches platform.ts does not cover. Manager and members are platform handles. */
const EXTRA_TEAMS = [
  { key: 'pun-sales', name: 'PUN01 Sales', branch: 'PUN01', manager: 'rmpune', members: ['rmpune'] },
  { key: 'blr-sales', name: 'BLR01 Sales', branch: 'BLR01', manager: 'branchmgr', members: ['rm1'] },
  { key: 'del-sales', name: 'DEL01 Sales', branch: 'DEL01', manager: 'branchmgr', members: ['sales1'] },
  {
    key: 'mum-verify',
    name: 'MUM01 Verification',
    branch: 'MUM01',
    manager: 'teammgr',
    members: ['teammgr', 'compliance'],
  },
  {
    key: 'mum-loanops',
    name: 'MUM01 Loan Operations',
    branch: 'MUM01',
    manager: 'loanops',
    members: ['loanops'],
  },
  {
    key: 'hyd-collections',
    name: 'HYD01 Collections',
    branch: 'HYD01',
    manager: 'teammgr',
    members: ['rm2'],
  },
  { key: 'chn-sales', name: 'CHN01 Sales', branch: 'CHN01', manager: 'teammgr', members: ['rmpune'] },
];

const EXTRA_QUEUES = [
  {
    code: 'BLR01-INTAKE',
    name: 'Bengaluru intake',
    kind: 'INTAKE',
    branch: 'BLR01',
    team: null,
    recordTypes: ['LEAD'],
  },
  {
    code: 'BLR01-UNASSIGNED',
    name: 'Bengaluru unassigned',
    kind: 'UNASSIGNED',
    branch: 'BLR01',
    team: null,
    recordTypes: ['LEAD', 'TASK'],
  },
  {
    code: 'DEL01-INTAKE',
    name: 'Delhi intake',
    kind: 'INTAKE',
    branch: 'DEL01',
    team: null,
    recordTypes: ['LEAD'],
  },
  {
    code: 'HYD01-INTAKE',
    name: 'Hyderabad intake',
    kind: 'INTAKE',
    branch: 'HYD01',
    team: null,
    recordTypes: ['LEAD'],
  },
  {
    code: 'CHN01-INTAKE',
    name: 'Chennai intake',
    kind: 'INTAKE',
    branch: 'CHN01',
    team: null,
    recordTypes: ['LEAD'],
  },
  {
    code: 'MUM01-VERIFY',
    name: 'MUM01 verification pool',
    kind: 'FUNCTIONAL',
    branch: 'MUM01',
    team: 'mum-verify',
    recordTypes: ['APPLICATION'],
  },
  {
    code: 'MUM01-LOANOPS',
    name: 'MUM01 loan operations',
    kind: 'FUNCTIONAL',
    branch: 'MUM01',
    team: 'mum-loanops',
    recordTypes: ['APPLICATION'],
  },
  {
    code: 'MUM01-EXCEPTIONS',
    name: 'MUM01 exceptions',
    kind: 'EXCEPTION',
    branch: 'MUM01',
    team: null,
    recordTypes: ['APPLICATION', 'TASK'],
  },
];

const ROLE_STEM = (code: string) =>
  code
    .replace(/^ROLE-/, '')
    .toLowerCase()
    .replace(/-/g, '_');

/** Builds the tenant identity (ids only); rows are written by buildTenantCore. */
export function makeTenant(tag: string, tagDigit: string, slug: string, name: string): Tenant {
  const t: Tenant = {
    tag,
    tagDigit,
    id: `ten_${tag}`,
    slug,
    name,
    orgs: [],
    branches: {},
    users: {},
    teams: {},
    queues: {},
    roles: {},
    connectorUsers: [],
    actor: '',
  };
  t.orgs = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => idOf(t, 'org', n + 1));
  for (const b of BRANCH_DEFS) t.branches[b.code] = idOf(t, 'br', b.code);
  for (const u of USERS) t.users[u.handle] = idOf(t, 'usr', u.handle);
  for (const u of CONNECTOR_USERS) t.users[u.handle] = idOf(t, 'usr', u.handle);
  t.connectorUsers = CONNECTOR_USERS.map((u) => ix(t.users, u.handle));
  t.actor = ix(t.users, 'admin');
  for (const team of [{ key: 'mum-sales' }, ...EXTRA_TEAMS]) t.teams[team.key] = idOf(t, 'team', team.key);
  for (const q of [...QUEUE_CODES, ...EXTRA_QUEUES.map((x) => x.code)])
    t.queues[q] = idOf(t, 'wq', q.toLowerCase());
  for (const r of ROLES) t.roles[r.code] = idOf(t, 'rol', ROLE_STEM(r.code));
  return t;
}

const QUEUE_CODES = [
  'MUM01-INTAKE',
  'MUM01-UNASSIGNED',
  'PUN01-INTAKE',
  'PUN01-UNASSIGNED',
  'MUM01-SALES',
] as const;

/** Pilot tenants: tenant rows only, so the tenant table holds eight or more rows without extra operational data. */
export const PILOT_TENANTS: {
  tag: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  reason?: string;
}[] = [
  { tag: 'gamma', slug: 'pilot-gamma', name: 'Gamma Pilot Partners', type: 'DSA_ORG', status: 'ACTIVE' },
  { tag: 'delta', slug: 'pilot-delta', name: 'Delta Pilot Finance', type: 'DSA_ORG', status: 'ACTIVE' },
  {
    tag: 'epsilon',
    slug: 'pilot-epsilon',
    name: 'Epsilon Credit Desk',
    type: 'NBFC_DISTRIBUTION',
    status: 'ACTIVE',
  },
  {
    tag: 'zeta',
    slug: 'pilot-zeta',
    name: 'Zeta Loan Network',
    type: 'DSA_ORG',
    status: 'SUSPENDED',
    reason: 'Unpaid platform invoice (synthetic)',
  },
  {
    tag: 'eta',
    slug: 'pilot-eta',
    name: 'Eta Micro Finance',
    type: 'DSA_ORG',
    status: 'SUSPENDED',
    reason: 'Security review pending (synthetic)',
  },
  {
    tag: 'theta',
    slug: 'pilot-theta',
    name: 'Theta Home Loans',
    type: 'DSA_ORG',
    status: 'OFFBOARDING',
    reason: 'Customer requested exit (synthetic)',
  },
  {
    tag: 'iota',
    slug: 'pilot-iota',
    name: 'Iota Auto Credit',
    type: 'NBFC_DISTRIBUTION',
    status: 'OFFBOARDING',
    reason: 'Contract ended (synthetic)',
  },
  { tag: 'kappa', slug: 'pilot-kappa', name: 'Kappa Business Loans', type: 'DSA_ORG', status: 'ACTIVE' },
];

/** Writes tenant, organisation, branch, staff, team, queue, role, calendar, settings and reference rows for one demo tenant. */
export function buildTenantCore(t: Tenant, out: Tables): void {
  const def = TENANTS.find((x) => x.slug === t.slug)!;
  const created = { created_by: t.actor, updated_by: t.actor };

  out.add('tenant', {
    id: t.id,
    slug: t.slug,
    legal_name: def.legalName,
    tenant_type: 'DSA_ORG',
    status: 'ACTIVE',
    entitlements: { leads: true, origination: true, commissions: true, ledger: true, partnerApi: false },
    entitlements_version: 1,
    created_by: 'SYSTEM:platform',
  });

  // Four organisations under the demo tenant; branches are spread across them.
  ORG_SUFFIXES.forEach((o, i) =>
    out.add('organisation', {
      id: ix(t.orgs, i),
      tenant_id: t.id,
      legal_name: `${def.legalName.replace(/ Finserv$| Loans$/, '')} ${o.suffix}`,
      constitution: o.constitution,
      status: 'ACTIVE',
      ...created,
    }),
  );

  for (const b of BRANCH_DEFS) {
    out.add('branch', {
      id: ix(t.branches, b.code),
      tenant_id: t.id,
      organisation_id: ix(t.orgs, b.org),
      code: b.code,
      name: b.name,
      pincode: b.pincode,
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      ...created,
    });
  }

  // Staff from platform.ts plus two connector portal logins.
  const phoneBase = (n: number) => mobileFor(t.tagDigit, n);
  [...USERS, ...CONNECTOR_USERS].forEach((u, i) => {
    const isConnector = 'branch' in u && CONNECTOR_USERS.some((c) => c.handle === u.handle);
    out.add('app_user', {
      id: ix(t.users, u.handle),
      tenant_id: t.id,
      idp_subject: `local-${t.tag}-${u.handle}`,
      email: `${u.handle}@${t.tag}.example.com`,
      mobile_e164: phoneBase(100 + i),
      display_name: u.displayName,
      user_type: isConnector ? 'CONNECTOR' : 'STAFF',
      status: 'ACTIVE',
      availability: i % 4 === 3 ? 'BUSY' : 'AVAILABLE',
      primary_branch_id: ix(t.branches, u.branch),
      connector_id: isConnector ? connectorId(t, i - USERS.length + 1) : null,
      capacity: 10 + (i % 3) * 5,
      created_by: t.actor,
      updated_by: t.actor,
    });
  });

  // Teams: the platform team plus the local extras.
  out.add('team', {
    id: ix(t.teams, 'mum-sales'),
    tenant_id: t.id,
    name: TEAM.name,
    branch_id: ix(t.branches, TEAM.branch),
    manager_user_id: ix(t.users, TEAM.manager),
    status: 'ACTIVE',
    ...created,
  });
  for (const team of EXTRA_TEAMS) {
    out.add('team', {
      id: ix(t.teams, team.key),
      tenant_id: t.id,
      name: team.name,
      branch_id: ix(t.branches, team.branch),
      manager_user_id: ix(t.users, team.manager),
      status: 'ACTIVE',
      ...created,
    });
  }
  const teamMembers: [string, string][] = [
    ...TEAM.members.map((h): [string, string] => ['mum-sales', h]),
    ...EXTRA_TEAMS.flatMap((team) => team.members.map((h): [string, string] => [team.key, h])),
  ];
  teamMembers.forEach(([teamKey, handle], i) =>
    out.add('team_membership', {
      id: idOf(t, 'tm', i + 1),
      tenant_id: t.id,
      team_id: ix(t.teams, teamKey),
      user_id: ix(t.users, handle),
      created_by: t.actor,
    }),
  );

  // Queues: platform.ts queues plus local extras.
  const queueRows = [
    {
      code: 'MUM01-INTAKE',
      name: 'Mumbai Central intake',
      kind: 'INTAKE',
      branch: 'MUM01',
      team: null,
      recordTypes: ['LEAD'],
    },
    {
      code: 'MUM01-UNASSIGNED',
      name: 'Mumbai Central unassigned',
      kind: 'UNASSIGNED',
      branch: 'MUM01',
      team: null,
      recordTypes: ['LEAD', 'TASK'],
    },
    {
      code: 'PUN01-INTAKE',
      name: 'Pune Camp intake',
      kind: 'INTAKE',
      branch: 'PUN01',
      team: null,
      recordTypes: ['LEAD'],
    },
    {
      code: 'PUN01-UNASSIGNED',
      name: 'Pune Camp unassigned',
      kind: 'UNASSIGNED',
      branch: 'PUN01',
      team: null,
      recordTypes: ['LEAD', 'TASK'],
    },
    {
      code: 'MUM01-SALES',
      name: 'MUM01 Sales team',
      kind: 'TEAM',
      branch: 'MUM01',
      team: 'mum-sales',
      recordTypes: ['LEAD', 'TASK'],
    },
    ...EXTRA_QUEUES,
  ];
  for (const q of queueRows) {
    out.add('work_queue', {
      id: ix(t.queues, q.code),
      tenant_id: t.id,
      code: q.code,
      name: q.name,
      kind: q.kind,
      branch_id: ix(t.branches, q.branch),
      team_id: q.team ? ix(t.teams, q.team) : null,
      record_types: q.recordTypes,
      routing_state: { weight: 1, cursor: 0 },
      active: true,
      created_by: t.actor,
      updated_by: t.actor,
    });
  }
  const memberOf: Record<string, { handle: string; assign?: boolean }[]> = {
    ...QUEUE_MEMBERS,
    'BLR01-INTAKE': [{ handle: 'rm1' }, { handle: 'branchmgr', assign: true }],
    'DEL01-INTAKE': [{ handle: 'sales1' }],
    'HYD01-INTAKE': [{ handle: 'rm2' }],
    'CHN01-INTAKE': [{ handle: 'rmpune' }],
    'MUM01-VERIFY': [{ handle: 'teammgr', assign: true }, { handle: 'compliance' }],
    'MUM01-LOANOPS': [{ handle: 'loanops', assign: true }],
    'MUM01-EXCEPTIONS': [{ handle: 'branchmgr', assign: true }],
  };
  let memberSeq = 0;
  for (const [code, members] of Object.entries(memberOf)) {
    for (const m of members) {
      memberSeq += 1;
      out.add('work_queue_member', {
        id: idOf(t, 'wqm', memberSeq),
        tenant_id: t.id,
        queue_id: ix(t.queues, code),
        user_id: ix(t.users, m.handle),
        can_pick: true,
        can_assign: Boolean(m.assign),
        created_by: t.actor,
      });
    }
  }

  // Roles and grants come straight from platform.ts.
  for (const role of ROLES) {
    out.add('role', {
      id: ix(t.roles, role.code),
      tenant_id: t.id,
      code: role.code,
      name: role.name,
      is_template: true,
      version: 1,
      created_by: t.actor,
    });
    for (const perm of [...new Set(role.permissions)]) {
      out.add('role_permission', { tenant_id: t.id, role_id: ix(t.roles, role.code), permission_code: perm });
    }
  }
  let assignmentSeq = 0;
  for (const u of USERS) {
    for (const r of u.roles) {
      assignmentSeq += 1;
      out.add('user_role_assignment', {
        id: idOf(t, 'ura', assignmentSeq),
        tenant_id: t.id,
        user_id: ix(t.users, u.handle),
        role_id: ix(t.roles, r.code),
        scope_type: r.scope,
        scope_branch_ids: r.scope === 'BRANCH' ? (r.branches ?? []).map((b) => ix(t.branches, b)) : [],
        created_by: u.handle === 'admin' ? ix(t.users, 'owner') : t.actor,
      });
    }
  }

  // Business calendar per branch; holidays are fixed dates inside October 2026.
  BRANCH_DEFS.forEach((b, i) =>
    out.add('business_calendar', {
      id: `cal_${t.tag}_${b.code.toLowerCase()}`,
      tenant_id: t.id,
      name: `${b.name} working calendar`,
      timezone: 'Asia/Kolkata',
      weekly_hours: { mon_fri: ['09:30-18:30'], sat: ['10:00-14:00'], sun: [] },
      holidays: [onDate('2026-10-02'), onDate('2026-10-20'), onDate('2026-10-21')].slice(0, 2 + (i % 2)),
      quiet_hours: { start: '21:00', end: '08:00' },
      created_by: t.actor,
      updated_by: t.actor,
    }),
  );

  // Settings: tenant defaults and a branch override.
  const settings: [string, string, string, unknown][] = [
    ['TENANT', t.id, 'leads.autoRoutingEnabled', true],
    ['TENANT', t.id, 'leads.firstContactHours', 4],
    ['TENANT', t.id, 'docs.maxUploadMb', 10],
    ['TENANT', t.id, 'commission.clawbackWindowDays', 90],
    ['TENANT', t.id, 'notify.quietHoursEnabled', true],
    ['TENANT', t.id, 'otp.ttlMinutes', 10],
    ['BRANCH', ix(t.branches, 'MUM01'), 'leads.firstContactHours', 2],
    ['ORGANISATION', ix(t.orgs, 0), 'reports.dailyDigestHour', 8],
  ];
  settings.forEach(([scopeType, scopeId, key, value], i) =>
    out.add('setting', {
      id: idOf(t, 'set', i + 1),
      tenant_id: t.id,
      scope_type: scopeType,
      scope_id: scopeId,
      key,
      value,
      created_by: t.actor,
      updated_by: t.actor,
    }),
  );

  // Feature flags: tenant overrides for the eight TENANT-scoped definitions (crm.lead_auto_qualify comes from the
  // migrations; the other seven are written by governance.buildGlobal).
  const FLAG_KEYS = [
    'crm.lead_auto_qualify',
    'lead.duplicate_detection',
    'lender.api_submission',
    'ledger.manual_posting',
    'partner.api',
    'automation.engine',
    'eligibility.screen',
    'connector.portal',
  ];
  FLAG_KEYS.forEach((key, i) =>
    out.add('tenant_feature_flag', {
      tenant_id: t.id,
      key,
      scope: 'TENANT',
      value: i % 3 !== 2,
      updated_by: t.actor,
    }),
  );

  // Label sets, one per locale the tenant serves.
  ['en-IN', 'hi-IN', 'mr-IN', 'gu-IN', 'ta-IN', 'te-IN', 'kn-IN', 'bn-IN'].forEach((locale, i) =>
    out.add('label_set', {
      id: idOf(t, 'lbl', locale.toLowerCase().replace('-', '_')),
      tenant_id: t.id,
      locale,
      entries: [
        { key: 'lead.title', text: i === 0 ? 'Leads' : `Leads (${locale})` },
        { key: 'app.title', text: i === 0 ? 'Applications' : `Applications (${locale})` },
      ],
      created_by: t.actor,
      updated_by: t.actor,
    }),
  );

  const picklists: [string, string, string][] = [
    ['LEAD_SOURCE', 'WALK_IN', 'Walk-in'],
    ['LEAD_SOURCE', 'PHONE', 'Phone enquiry'],
    ['LEAD_SOURCE', 'REFERRAL', 'Referral'],
    ['LEAD_SOURCE', 'CAMPAIGN', 'Campaign'],
    ['DECLINE_REASON', 'INCOME', 'Income below policy'],
    ['DECLINE_REASON', 'CREDIT_HISTORY', 'Credit history'],
    ['DECLINE_REASON', 'DOCUMENTATION', 'Documentation incomplete'],
    ['EMPLOYER_CATEGORY', 'GOVT', 'Government'],
    ['EMPLOYER_CATEGORY', 'PRIVATE_LISTED', 'Private listed'],
    ['EMPLOYER_CATEGORY', 'SME', 'SME'],
  ];
  picklists.forEach(([category, code, label], i) =>
    out.add('picklist_value', {
      id: idOf(t, 'pick', i + 1),
      tenant_id: t.id,
      category,
      code,
      label,
      active: true,
      created_by: t.actor,
    }),
  );

  const lists = [
    ['SERVICEABLE_PINCODES', 'Serviceable pincodes', 'PINCODE', ['400008', '411001', '560001', '110001']],
    ['IFSC_BANK_CODES', 'IFSC bank codes', 'CODE', ['HDFC', 'ICIC', 'SBIN', 'UTIB']],
    ['CITY_TIERS', 'City tiers', 'STRING', ['TIER1', 'TIER2', 'TIER3']],
    ['STATE_CODES', 'State codes', 'CODE', ['MH', 'KA', 'DL', 'TS', 'GJ', 'TN', 'WB']],
    ['OCCUPATION_CODES', 'Occupation codes', 'CODE', ['SAL', 'SEP', 'SEB', 'NIND']],
    ['PRODUCT_CATEGORIES', 'Product categories', 'CODE', ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL']],
    ['EDUCATION_LEVELS', 'Education levels', 'STRING', ['GRADUATE', 'POST_GRADUATE', 'DIPLOMA']],
    ['PURPOSE_CODES', 'Loan purpose codes', 'CODE', ['MEDICAL', 'EDUCATION', 'VEHICLE', 'WORKING_CAPITAL']],
  ] as const;
  lists.forEach(([code, name, valueType, values], i) => {
    const listId = idOf(t, 'rl', i + 1);
    out.add('reference_list', {
      id: listId,
      tenant_id: t.id,
      code,
      name,
      value_type: valueType,
      created_by: t.actor,
    });
    out.add('reference_list_version', {
      id: idOf(t, 'rlv', i + 1),
      tenant_id: t.id,
      list_id: listId,
      version_no: 1,
      values: [...values],
      value_count: values.length,
      content_hash: sha256Hex(values.join('|')),
      published_by: t.actor,
    });
  });

  const metrics: [string, string, string, string, string][] = [
    ['LEAD_CREATED_COUNT', 'Leads created', 'ACTIVITY', 'COUNT', 'CRM'],
    ['LEAD_QUALIFIED_COUNT', 'Leads qualified', 'OUTCOME', 'COUNT', 'CRM'],
    ['LEAD_CONVERTED_COUNT', 'Leads converted', 'OUTCOME', 'COUNT', 'CRM'],
    ['ACTIVITY_COUNT', 'Activities logged', 'ACTIVITY', 'COUNT', 'CRM'],
    ['SANCTION_COUNT', 'Sanctions received', 'OUTCOME', 'COUNT', 'ORIGINATION'],
    ['SANCTION_AMOUNT', 'Sanctioned amount', 'OUTCOME', 'INR', 'ORIGINATION'],
    ['DISBURSEMENT_COUNT', 'Disbursements recorded', 'OUTCOME', 'COUNT', 'ORIGINATION'],
    ['DISBURSEMENT_AMOUNT', 'Disbursed amount', 'OUTCOME', 'INR', 'ORIGINATION'],
  ];
  metrics.forEach(([code, name, category, unit, domain]) =>
    out.add('metric_definition', {
      tenant_id: t.id,
      code,
      name,
      description: `${name} for the selected period (synthetic demo definition).`,
      category,
      unit,
      aggregation_type: unit === 'INR' ? 'SUM' : 'COUNT',
      source_domain: domain,
      version: 1,
      date_basis: 'CREATED_AT',
      grain: 'MONTHLY',
      owner: 'SYSTEM',
    }),
  );

  // Targets: approved by the owner, one pending for the branch manager. Unit must match the metric (DB check).
  const targets: [string, string, string, string, number, string, string][] = [
    ['2026-10', 'BRANCH', ix(t.branches, 'MUM01'), 'LEAD_COUNT', 120, 'COUNT', 'APPROVED'],
    ['2026-10', 'BRANCH', ix(t.branches, 'PUN01'), 'LEAD_COUNT', 80, 'COUNT', 'APPROVED'],
    ['2026-10', 'BRANCH', ix(t.branches, 'MUM01'), 'DISBURSEMENT_AMOUNT', 25000000, 'INR', 'APPROVED'],
    [
      '2026-10',
      'BRANCH',
      ix(t.branches, 'PUN01'),
      'DISBURSEMENT_AMOUNT',
      12000000,
      'INR',
      'PENDING_APPROVAL',
    ],
    ['2026-10', 'USER', ix(t.users, 'rm1'), 'SANCTION_COUNT', 12, 'COUNT', 'APPROVED'],
    ['2026-10', 'USER', ix(t.users, 'rm2'), 'SANCTION_COUNT', 10, 'COUNT', 'APPROVED'],
    ['2026-10', 'USER', ix(t.users, 'sales1'), 'LEAD_COUNT', 40, 'COUNT', 'REJECTED'],
    ['2026-09', 'BRANCH', ix(t.branches, 'MUM01'), 'SANCTION_COUNT', 30, 'COUNT', 'SUPERSEDED'],
  ];
  targets.forEach(([period, dimType, dimId, metric, value, unit, status], i) => {
    const approved = status === 'APPROVED' || status === 'REJECTED';
    out.add('target', {
      id: idOf(t, 'tgt', i + 1),
      tenant_id: t.id,
      period,
      dimension_type: dimType,
      dimension_id: dimId,
      metric_code: metric,
      target_value: value,
      unit,
      version: 1,
      status,
      created_by: ix(t.users, 'branchmgr'),
      updated_by: ix(t.users, 'branchmgr'),
      approved_by: approved ? ix(t.users, 'owner') : null,
      approved_at: approved ? at(ANCHOR, 3 + i) : null,
      rejection_reason: status === 'REJECTED' ? 'Target above branch capacity (synthetic)' : null,
    });
  });

  // Access reviews (four campaigns per tenant), each with items: certified, revoked or still open.
  const reviewNames = [
    'Q1 role recertification',
    'Q2 role recertification',
    'Q3 role recertification',
    'Q4 role recertification',
    'Branch manager access check',
    'Lender-desk access check',
    'Connector portal access check',
    'Finance desk access check',
  ];
  reviewNames.forEach((name, r) => {
    const reviewId = idOf(t, 'arv', r + 1);
    const closed = r < 4;
    out.add('access_review', {
      id: reviewId,
      tenant_id: t.id,
      name,
      branch_ids: [ix(t.branches, 'MUM01'), ix(t.branches, 'PUN01')],
      status: closed ? 'CLOSED' : 'OPEN',
      due_at: at(ANCHOR, 20 + r),
      item_count: 8,
      closed_at: closed ? at(ANCHOR, 15 + r) : null,
      lock_version: 1,
      created_by: t.actor,
      updated_by: t.actor,
    });
    USERS.slice(0, 8).forEach((u, i) => {
      const decided = i % 3 !== 2 || r < 4;
      out.add('access_review_item', {
        id: idOf(t, 'ari', r * 100 + i + 1),
        tenant_id: t.id,
        review_id: reviewId,
        assignment_id: idOf(t, 'ura', i + 1),
        user_id: ix(t.users, u.handle),
        role_id: ix(t.roles, ix(u.roles, 0).code),
        scope_type: ix(u.roles, 0).scope,
        decision: decided ? (i % 2 === 0 ? 'CERTIFY' : 'REVOKE') : null,
        reason: decided && i % 2 === 1 ? 'Role no longer needed for the branch (synthetic)' : null,
        // A reviewer never certifies their own access (DB rule): the owner's own item is reviewed by the admin.
        decided_by: decided ? (u.handle === 'owner' ? ix(t.users, 'admin') : ix(t.users, 'owner')) : null,
        decided_at: decided ? at(ANCHOR, 5 + r, i) : null,
      });
    });
  });

  // Attendance: one week of records for the branch team; one correction points at the original.
  const attendanceUsers = ['rm1', 'rm2', 'sales1', 'teammgr', 'loanops', 'branchmgr', 'rmpune', 'compliance'];
  attendanceUsers.forEach((h, i) => {
    const day = onDate('2026-10-12', i % 5);
    out.add('attendance_record', {
      id: idOf(t, 'att', i + 1),
      tenant_id: t.id,
      user_id: ix(t.users, h),
      date: day,
      check_in: `${day}T09:${pad(20 + i, 2)}:00+05:30`,
      check_out: `${day}T18:${pad(10 + i, 2)}:00+05:30`,
      status: i === 6 ? 'HALF_DAY' : i === 7 ? 'ON_LEAVE' : 'PRESENT',
      notes: i === 5 ? 'Field visit to Thane branch (synthetic)' : null,
      correction_of: null,
      approved_by: i === 5 ? null : ix(t.users, 'branchmgr'),
      created_by: ix(t.users, h),
      updated_by: ix(t.users, h),
    });
  });

  const delegations: [string, string, number, number, string][] = [
    ['branchmgr', 'teammgr', 2, 9, 'Leave cover for branch manager (synthetic)'],
    ['owner', 'branchmgr', 5, 7, 'Owner travelling to Pune (synthetic)'],
    ['teammgr', 'rm1', 1, 3, 'Team lead cover (synthetic)'],
    ['loanops', 'compliance', 4, 6, 'Sign-off cover (synthetic)'],
    ['admin', 'owner', 10, 12, 'Admin cover during audit (synthetic)'],
    ['rm2', 'sales1', 8, 9, 'RM cover during site visit (synthetic)'],
    ['ruleauthor', 'ruleapprover', 15, 16, 'Rule review hand-off (synthetic)'],
    ['rmpune', 'rm1', 3, 4, 'Cross-branch lead cover (synthetic)'],
  ];
  delegations.forEach(([from, to, start, end, reason], i) =>
    out.add('delegation', {
      id: idOf(t, 'dlg', i + 1),
      tenant_id: t.id,
      delegator_id: ix(t.users, from),
      delegate_id: ix(t.users, to),
      starts_at: at(ANCHOR, start - 1),
      ends_at: at(ANCHOR, end - 1, 8),
      reason,
      status: end < 16 ? 'ENDED' : 'ACTIVE',
      created_by: ix(t.users, from),
      updated_by: ix(t.users, from),
    }),
  );

  // Draft configuration bundles, one per kind of setting the owner might export.
  for (let i = 0; i < 8; i += 1) {
    out.add('config_bundle_draft', {
      id: idOf(t, 'cfg', i + 1),
      tenant_id: t.id,
      bundle: {
        version: 1,
        sections: ['roles', 'queues', 'picklists'].slice(0, 1 + (i % 3)),
        note: `draft ${i + 1}`,
      },
      counts: { roles: 11, queues: 13, picklists: 10 },
      status: i < 5 ? 'DRAFT' : i < 7 ? 'APPLIED' : 'DISCARDED',
      created_by: t.actor,
    });
  }
}

/** Global tenant rows (both demo tenants and pilots) and their offboarding history. */
export function buildTenantRegistry(out: Tables): void {
  for (const pilot of PILOT_TENANTS) {
    out.add('tenant', {
      id: `ten_${pilot.tag}`,
      slug: pilot.slug,
      legal_name: pilot.name,
      tenant_type: pilot.type,
      status: pilot.status,
      status_reason: pilot.reason ?? null,
      status_changed_at: pilot.reason ? at(ANCHOR, 6) : null,
      entitlements: { leads: true, origination: pilot.status === 'ACTIVE' },
      entitlements_version: 1,
      created_by: 'SYSTEM:platform',
    });
    out.add('tenant_offboarding', {
      id: `off_${pilot.tag}`,
      tenant_id: `ten_${pilot.tag}`,
      reason: pilot.reason ?? 'Pilot ended by mutual agreement (synthetic)',
      requested_by: 'platform-operator-ops',
      requested_at: at(ANCHOR, 10),
      approved_by: pilot.status === 'OFFBOARDING' ? 'platform-operator-lead' : null,
      approved_at: pilot.status === 'OFFBOARDING' ? at(ANCHOR, 11) : null,
    });
  }
}

/** Shape used by the other modules to refer to a tenant's cohort, kept here so the counts are in one place. */
export const COHORT = {
  leads: 10,
  customers: 10,
  applications: 10,
  lenders: 8,
  connectors: CONNECTORS,
} as const;

export type Gen = Row;
