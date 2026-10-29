import type { Page, Locator } from '@playwright/test';
import crypto from 'node:crypto';

export interface PersonaConfig {
  userId: string;
  email: string;
  displayName: string;
  roleCode: string;
  permissions: string[];
  primaryBranchId?: string;
  tenantId?: string;
}

// Grants follow the Notion "Roles, Workflows & Permissions Architecture" page: §6 core permissions per role, plus the §7
// mapping table where it names the role as a primary holder. Where §6 is silent, the "Permission Catalogue, Access Matrix &
// Qloax Tenant Reference" page (DB snapshot of qloax-dsa) is the source. Keep these in step with both pages.
export const PERSONAS: Record<string, PersonaConfig> = {
  // 01 — Platform Superadmin (§6.1; platform.tenant.* and user.manage from the Qloax reference snapshot)
  platformSuperAdmin: {
    userId: 'usr_platform_admin_01',
    email: 'vaibhav.qloax@gmail.com',
    displayName: 'Vaibhav Super Admin',
    roleCode: 'ROLE-PLATFORM-SUPERADMIN',
    permissions: [
      'platform.console',
      'platform.flags',
      'platform.jobs',
      'platform.master_data',
      'platform.release',
      'platform.support_access',
      'platform.tenant.create',
      'platform.tenant.entitlements',
      'platform.tenant.offboard',
      'platform.tenant.suspend',
      'user.manage',
    ],
    tenantId: 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG',
  },
  // 02 — Tenant Administrator (§6.2 core; §7 rows naming ROLE-TENANT-ADMIN)
  tenantAdmin: {
    userId: 'usr_admin_01',
    email: 'admin@qloax.com',
    displayName: 'Asha Admin',
    roleCode: 'ROLE-TENANT-ADMIN',
    permissions: [
      'config.manage',
      'user.manage',
      'role.manage',
      'audit.read',
      'audit.export_evidence',
      'api.manage',
      'integration.manage',
      'data_correction.approve',
      'connector.attribution_change',
      'lead.read',
      'lead.assign',
      'customer.read',
      'consent.record',
      'application.read',
      'application.create',
      'application.review',
      'document.review',
      'lender_case.submit',
      'sanction.record',
      'disbursement.record',
      'disbursement.verify',
      'rule.author',
      'rule.approve',
      'rule.publish',
      'payout.request',
    ],
    primaryBranchId: 'MUM01',
  },
  // 03 — DSA Owner (§6.2 core; connector.* for "strategic connector agreements", /connectors in the Qloax reference).
  // No payout.approve: §7 gives it to ROLE-COMMISSION-APPROVER only (SOD-03).
  orgOwner: {
    userId: 'usr_owner_01',
    email: 'owner@qloax.com',
    displayName: 'Omkar Owner',
    roleCode: 'ROLE-ORG-OWNER',
    permissions: [
      'lead.read',
      'application.read',
      'finance.view',
      'report.read',
      'target.manage',
      'audit.read',
      'connector.read',
      'connector.manage',
    ],
    primaryBranchId: 'MUM01',
  },
  // 04 — Branch Manager (§6.3 core; §7 lead.qualify, customer.read, application.review; the rest from the Qloax snapshot:
  // tasks, rule simulation, connector viewing, complaints)
  branchMgr: {
    userId: 'usr_branchmgr_01',
    email: 'branchmgr@qloax.com',
    displayName: 'Bhavna Branch Mgr',
    roleCode: 'ROLE-BRANCH-MGR',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.assign',
      'lead.qualify',
      'customer.read',
      'application.read',
      'application.update',
      'application.review',
      'application.assign',
      'task.read',
      'task.create',
      'task.update',
      'task.assign',
      'activity.create',
      'activity.update',
      'report.read',
      'target.manage',
      'rule.simulate',
      'connector.read',
      'complaint.manage',
    ],
    primaryBranchId: 'MUM01',
  },
  // 05 — Team Manager (no §6 list; §7 lead.assign, the rest from the Qloax snapshot: team tasks and reports)
  teamMgr: {
    userId: 'usr_teammgr_01',
    email: 'teammgr@qloax.com',
    displayName: 'Tarun Team Mgr',
    roleCode: 'ROLE-TEAM-MGR',
    permissions: [
      'lead.read',
      'lead.assign',
      'application.read',
      'task.read',
      'task.assign',
      'task.create',
      'task.update',
      'activity.create',
      'report.read',
    ],
    primaryBranchId: 'MUM01',
  },
  // 06 — Relationship Manager (§6.3 core; application.read, task.read/create and activity.create for its /applications,
  // /tasks and /activities screens)
  rm: {
    userId: 'usr_rm_01',
    email: 'rm@qloax.com',
    displayName: 'Riya RM',
    roleCode: 'ROLE-RM',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.qualify',
      'customer.create',
      'customer.update',
      'customer.read',
      'consent.record',
      'application.create',
      'application.update',
      'application.read',
      'share.create',
      'document.upload',
      'message.send',
      'task.read',
      'task.create',
      'task.update',
      'activity.create',
    ],
    primaryBranchId: 'MUM01',
  },
  // 07 — Sales Executive (§6.3 core). task.create is not in §6.3, but QA plan Module 07 step 4 has this role create a
  // follow-up task; the two Notion pages disagree, and the QA plan is followed here.
  salesExec: {
    userId: 'usr_sales_01',
    email: 'sales@qloax.com',
    displayName: 'Sameer Sales',
    roleCode: 'ROLE-SALES-EXEC',
    permissions: [
      'lead.create',
      'lead.read',
      'lead.update',
      'activity.create',
      'activity.update',
      'task.read',
      'task.create',
      'task.update',
    ],
    primaryBranchId: 'MUM01',
  },
  // 08 — Loan Operations (§6.4, exact)
  loanOps: {
    userId: 'usr_loanops_01',
    email: 'loanops@qloax.com',
    displayName: 'Lata Loan Ops',
    roleCode: 'ROLE-LOAN-OPS',
    permissions: [
      'application.read',
      'application.review',
      'lender_case.submit',
      'lender_case.update_status',
      'sanction.record',
      'disbursement.record',
    ],
    primaryBranchId: 'MUM01',
  },
  // 09 — Document Verifier (§6.4, exact)
  docVerifier: {
    userId: 'usr_verifier_01',
    email: 'verifier@qloax.com',
    displayName: 'Vikas Verifier',
    roleCode: 'ROLE-DOC-VERIFIER',
    permissions: [
      'verification.read',
      'verification.perform',
      'verification.create',
      'verification.update',
      'verification.complete',
      'document.review',
      'application.read',
    ],
    primaryBranchId: 'MUM01',
  },
  // 10 — Compliance Officer (§6.6 core; privacy.manage from the Qloax snapshot: legal holds and privacy management)
  compliance: {
    userId: 'usr_compliance_01',
    email: 'compliance@qloax.com',
    displayName: 'Chetan Compliance',
    roleCode: 'ROLE-COMPLIANCE',
    permissions: [
      'audit.read',
      'audit.export_evidence',
      'customer.read',
      'security.incident',
      'security.vuln',
      'report.read',
      'privacy.manage',
    ],
    primaryBranchId: 'MUM01',
  },
  // 11 — Rule Author (§6.4, exact)
  ruleAuthor: {
    userId: 'usr_ruleauthor_01',
    email: 'ruleauthor@qloax.com',
    displayName: 'Rekha Author',
    roleCode: 'ROLE-RULE-AUTHOR',
    permissions: ['rule.author', 'rule.simulate'],
    primaryBranchId: 'MUM01',
  },
  // 12 — Rule Approver (§6.4, exact)
  ruleApprover: {
    userId: 'usr_ruleapprover_01',
    email: 'ruleapprover@qloax.com',
    displayName: 'Ravi Approver',
    roleCode: 'ROLE-RULE-APPROVER',
    permissions: ['rule.approve', 'rule.publish', 'rule.suspend', 'rule.simulate'],
    primaryBranchId: 'MUM01',
  },
  // 13 — Finance Executive (§6.5 core; commission.plan.edit as the SOD-02 maker and disbursement.verify as the SOD-04
  // checker, §4 and §7)
  financeExec: {
    userId: 'usr_finance_01',
    email: 'finance@qloax.com',
    displayName: 'Farhan Finance',
    roleCode: 'ROLE-FINANCE-EXEC',
    permissions: [
      'finance.view',
      'finance.reconcile',
      'finance.dispute',
      'adjustment.create',
      'payout.request',
      'invoice.manage',
      'commission.plan.edit',
      'disbursement.verify',
    ],
    primaryBranchId: 'MUM01',
  },
  // 13 — Commission Approver (§6.5, exact)
  commissionApprover: {
    userId: 'usr_cfo_01',
    email: 'commission@qloax.com',
    displayName: 'Charu Approver',
    roleCode: 'ROLE-COMMISSION-APPROVER',
    permissions: [
      'finance.view',
      'commission.plan.approve',
      'payout.approve',
      'payout.record_payment',
      'adjustment.approve',
    ],
    primaryBranchId: 'MUM01',
  },
};

/**
 * Vaibhav Finserv active organization personas (Tenant: ten_01M5V9DW51908MVT3D6P4M7NDA, slug: vaibhav-finserv)
 * Matches live Supabase Auth and database configuration with password 'Vaibhav@1234'.
 */
export const VAIBHAV_PERSONAS: Record<string, PersonaConfig> = {
  platformSuperAdmin: {
    userId: 'usr_platform_admin_01',
    email: 'vaibhav.qloax@gmail.com',
    displayName: 'Vaibhav Super Admin',
    roleCode: 'ROLE-PLATFORM-SUPERADMIN',
    permissions: [
      'platform.console',
      'platform.flags',
      'platform.jobs',
      'platform.master_data',
      'platform.release',
      'platform.support_access',
      'platform.tenant.create',
      'platform.tenant.entitlements',
      'platform.tenant.offboard',
      'platform.tenant.suspend',
      'user.manage',
    ],
    tenantId: 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG',
  },
  tenantAdmin: {
    userId: 'usr_vaibhav_admin_01',
    email: 'vaibhav+admin@qloax.com',
    displayName: 'Vaibhav Admin',
    roleCode: 'ROLE-TENANT-ADMIN',
    permissions: [
      'config.manage',
      'user.manage',
      'role.manage',
      'audit.read',
      'audit.export_evidence',
      'api.manage',
      'integration.manage',
      'data_correction.approve',
      'connector.attribution_change',
      'lead.read',
      'lead.assign',
      'customer.read',
      'consent.record',
      'application.read',
      'application.create',
      'application.review',
      'document.review',
      'lender_case.submit',
      'sanction.record',
      'disbursement.record',
      'disbursement.verify',
      'rule.author',
      'rule.approve',
      'rule.publish',
      'payout.request',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  orgOwner: {
    userId: 'usr_vaibhav_owner_01',
    email: 'vaibhav+owner@qloax.com',
    displayName: 'Vaibhav Owner',
    roleCode: 'ROLE-ORG-OWNER',
    permissions: [
      'lead.read',
      'application.read',
      'finance.view',
      'report.read',
      'target.manage',
      'audit.read',
      'connector.read',
      'connector.manage',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  branchMgr: {
    userId: 'usr_vaibhav_branchmgr_01',
    email: 'vaibhav+branchmgr@qloax.com',
    displayName: 'Vaibhav Branch Mgr',
    roleCode: 'ROLE-BRANCH-MGR',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.assign',
      'lead.qualify',
      'customer.read',
      'application.read',
      'application.update',
      'application.review',
      'application.assign',
      'task.read',
      'task.create',
      'task.update',
      'task.assign',
      'activity.create',
      'activity.update',
      'report.read',
      'target.manage',
      'rule.simulate',
      'connector.read',
      'complaint.manage',
      'disbursement.verify',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  teamMgr: {
    userId: 'usr_vaibhav_teammgr_01',
    email: 'vaibhav+teammgr@qloax.com',
    displayName: 'Vaibhav Team Mgr',
    roleCode: 'ROLE-TEAM-MGR',
    permissions: [
      'lead.read',
      'lead.assign',
      'application.read',
      'task.read',
      'task.assign',
      'task.create',
      'task.update',
      'activity.create',
      'report.read',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  rm1: {
    userId: 'usr_vaibhav_rm1_01',
    email: 'vaibhav+rm1@qloax.com',
    displayName: 'Vaibhav RM 1',
    roleCode: 'ROLE-RM',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.qualify',
      'customer.create',
      'customer.update',
      'customer.read',
      'consent.record',
      'application.create',
      'application.update',
      'application.read',
      'share.create',
      'document.upload',
      'message.send',
      'task.read',
      'task.create',
      'task.update',
      'activity.create',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  rm2: {
    userId: 'usr_vaibhav_rm2_01',
    email: 'vaibhav+rm2@qloax.com',
    displayName: 'Vaibhav RM 2',
    roleCode: 'ROLE-RM',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.qualify',
      'customer.create',
      'customer.update',
      'customer.read',
      'consent.record',
      'application.create',
      'application.update',
      'application.read',
      'share.create',
      'document.upload',
      'message.send',
      'task.read',
      'task.create',
      'task.update',
      'activity.create',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  rmpune: {
    userId: 'usr_vaibhav_rmpune_01',
    email: 'vaibhav+rmpune@qloax.com',
    displayName: 'Vaibhav RM Pune',
    roleCode: 'ROLE-RM',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.qualify',
      'customer.create',
      'customer.update',
      'customer.read',
      'consent.record',
      'application.create',
      'application.update',
      'application.read',
      'share.create',
      'document.upload',
      'message.send',
      'task.read',
      'task.create',
      'task.update',
      'activity.create',
    ],
    primaryBranchId: 'PUN01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  salesExec: {
    userId: 'usr_vaibhav_sales_01',
    email: 'vaibhav+sales@qloax.com',
    displayName: 'Vaibhav Sales',
    roleCode: 'ROLE-SALES-EXEC',
    permissions: [
      'lead.create',
      'lead.read',
      'lead.update',
      'task.create',
      'task.read',
      'activity.create',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  loanOps: {
    userId: 'usr_vaibhav_loanops_01',
    email: 'vaibhav+loanops@qloax.com',
    displayName: 'Vaibhav Loan Ops',
    roleCode: 'ROLE-LOAN-OPS',
    permissions: [
      'application.read',
      'application.review',
      'document.review',
      'share.create',
      'lender_case.submit',
      'lender_case.update_status',
      'sanction.record',
      'disbursement.record',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  docVerifier: {
    userId: 'usr_vaibhav_verifier_01',
    email: 'vaibhav+verifier@qloax.com',
    displayName: 'Vaibhav Verifier',
    roleCode: 'ROLE-DOC-VERIFIER',
    permissions: [
      'verification.read',
      'verification.perform',
      'verification.create',
      'verification.update',
      'verification.complete',
      'document.review',
      'application.read',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  compliance: {
    userId: 'usr_vaibhav_compliance_01',
    email: 'vaibhav+compliance@qloax.com',
    displayName: 'Vaibhav Compliance',
    roleCode: 'ROLE-COMPLIANCE',
    permissions: [
      'audit.read',
      'audit.export_evidence',
      'customer.read',
      'security.incident',
      'security.vuln',
      'report.read',
      'privacy.manage',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  ruleAuthor: {
    userId: 'usr_vaibhav_ruleauthor_01',
    email: 'vaibhav+ruleauthor@qloax.com',
    displayName: 'Vaibhav Rule Author',
    roleCode: 'ROLE-RULE-AUTHOR',
    permissions: ['rule.author', 'rule.simulate'],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  ruleApprover: {
    userId: 'usr_vaibhav_ruleapprover_01',
    email: 'vaibhav+ruleapprover@qloax.com',
    displayName: 'Vaibhav Rule Approver',
    roleCode: 'ROLE-RULE-APPROVER',
    permissions: ['rule.approve', 'rule.publish', 'rule.suspend', 'rule.simulate'],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  financeExec: {
    userId: 'usr_vaibhav_finance_01',
    email: 'vaibhav+finance@qloax.com',
    displayName: 'Vaibhav Finance',
    roleCode: 'ROLE-FINANCE-EXEC',
    permissions: [
      'finance.view',
      'finance.reconcile',
      'finance.dispute',
      'adjustment.create',
      'payout.request',
      'invoice.manage',
      'commission.plan.edit',
      'disbursement.verify',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
  commissionApprover: {
    userId: 'usr_vaibhav_commission_01',
    email: 'vaibhav+commission@qloax.com',
    displayName: 'Vaibhav Commission',
    roleCode: 'ROLE-COMMISSION-APPROVER',
    permissions: [
      'finance.view',
      'commission.plan.approve',
      'payout.approve',
      'payout.record_payment',
      'adjustment.approve',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M5V9DW51908MVT3D6P4M7NDA',
  },
};

/**
 * Persona configurations matching the official Notion Manual Testing Suite:
 * Tenant: demo-alpha (ten_01M4SXZ9E66W8T6DNJYBVNS3FA)
 */
export const ALPHA_PERSONAS: Record<string, PersonaConfig> = {
  tenantAdmin: {
    userId: 'usr_01M4X5JZS3T5ZCCGQ6SDVKTAB8',
    email: 'admin@alpha.com',
    displayName: 'Asha Admin',
    roleCode: 'ROLE-TENANT-ADMIN',
    permissions: [
      'config.manage',
      'user.manage',
      'role.manage',
      'audit.read',
      'audit.export_evidence',
      'api.manage',
      'integration.manage',
      'data_correction.approve',
      'connector.attribution_change',
      'lead.read',
      'lead.assign',
      'customer.read',
      'consent.record',
      'application.read',
      'application.create',
      'application.review',
      'document.review',
      'lender_case.submit',
      'sanction.record',
      'disbursement.record',
      'disbursement.verify',
      'rule.author',
      'rule.approve',
      'rule.publish',
      'payout.request',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  orgOwner: {
    userId: 'usr_01M4SXZ9Y2T8YN1J73D6YJ39EC',
    email: 'owner@alpha.com',
    displayName: 'Omkar Owner',
    roleCode: 'ROLE-ORG-OWNER',
    permissions: [
      'lead.read',
      'application.read',
      'finance.view',
      'report.read',
      'target.manage',
      'audit.read',
      'connector.read',
      'connector.manage',
      'disbursement.verify',
      'payout.approve',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  branchMgr: {
    userId: 'usr_01M4SXZA4ER10DACBJXBV35S13',
    email: 'branchmgr@alpha.com',
    displayName: 'Bhavna Branch',
    roleCode: 'ROLE-BRANCH-MGR',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.assign',
      'lead.qualify',
      'application.read',
      'application.update',
      'application.review',
      'task.read',
      'task.create',
      'task.update',
      'task.assign',
      'report.read',
      'target.manage',
      'customer.read',
      'activity.create',
      'disbursement.verify',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  teamMgr: {
    userId: 'usr_01M4SXZAABT2W016BQZMT9ASWF',
    email: 'teammgr@alpha.com',
    displayName: 'Tarun Team',
    roleCode: 'ROLE-TEAM-MGR',
    permissions: [
      'lead.read',
      'lead.assign',
      'application.read',
      'task.read',
      'task.assign',
      'task.create',
      'task.update',
      'activity.create',
      'report.read',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  rm1: {
    userId: 'usr_01M4SXZAEZ0S1EXSQP1HYTGV6T',
    email: 'rm1@alpha.com',
    displayName: 'Riya RM',
    roleCode: 'ROLE-RM',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.qualify',
      'customer.create',
      'customer.update',
      'customer.read',
      'consent.record',
      'application.create',
      'application.update',
      'application.read',
      'share.create',
      'document.upload',
      'message.send',
      'task.read',
      'task.create',
      'task.update',
      'activity.create',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  salesExec: {
    userId: 'usr_01M4SXZASSXCF41QA4WP14NGAV',
    email: 'sales1@alpha.com',
    displayName: 'Sameer Sales',
    roleCode: 'ROLE-SALES-EXEC',
    permissions: [
      'lead.create',
      'lead.read',
      'lead.update',
      'activity.create',
      'activity.update',
      'task.read',
      'task.create',
      'task.update',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  loanOps: {
    userId: 'usr_01M4SXZAYZHQFJQHY939VRHGQB',
    email: 'loanops@alpha.com',
    displayName: 'Lata Loan Ops',
    roleCode: 'ROLE-LOAN-OPS',
    permissions: [
      'application.read',
      'application.review',
      'lender_case.submit',
      'lender_case.update_status',
      'sanction.record',
      'disbursement.record',
      'document.review',
      'share.create',
      'verification.perform',
      'verification.read',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  compliance: {
    userId: 'usr_01M4SXZB7DARQG8AGMQ9EJ93P2',
    email: 'compliance@alpha.com',
    displayName: 'Chetan Compliance',
    roleCode: 'ROLE-COMPLIANCE',
    permissions: [
      'audit.read',
      'audit.export_evidence',
      'customer.read',
      'security.incident',
      'security.vuln',
      'report.read',
      'privacy.manage',
    ],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  ruleAuthor: {
    userId: 'usr_01M4SXZBDNB21GJVKFNZ8HFEP5',
    email: 'ruleauthor@alpha.com',
    displayName: 'Rekha Author',
    roleCode: 'ROLE-RULE-AUTHOR',
    permissions: ['rule.author', 'rule.simulate'],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
  ruleApprover: {
    userId: 'usr_01M4SXZBJTK2PY78WYQG58XC9S',
    email: 'ruleapprover@alpha.com',
    displayName: 'Ravi Approver',
    roleCode: 'ROLE-RULE-APPROVER',
    permissions: ['rule.approve', 'rule.publish', 'rule.suspend', 'rule.simulate'],
    primaryBranchId: 'MUM01',
    tenantId: 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA',
  },
};

/** A Contracts §6 error envelope, so mocked failures look exactly like the API's. */
export function apiErrorBody(code: string, httpStatus: number, message: string): string {
  return JSON.stringify({
    error: { code, message, httpStatus, correlationId: 'corr_e2e_mock', details: [], retryable: false },
  });
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createMockJwt(persona: PersonaConfig, aal: 'aal1' | 'aal2' = 'aal2'): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://mlpkwwhnagxzinaohdxg.supabase.co/auth/v1',
    sub: persona.userId,
    role: 'authenticated',
    aud: 'authenticated',
    email: persona.email,
    exp: now + 86400,
    iat: now,
    aal,
    amr: [
      { method: 'password', timestamp: now },
      ...(aal === 'aal2' ? [{ method: 'totp', timestamp: now }] : []),
    ],
    app_metadata: { tenant_id: persona.tenantId || 'ten_01M595WCNH6H3ZMCVS70XH9GAN' },
    user_metadata: { display_name: persona.displayName },
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const bypassSecret = process.env.BYPASS_JWT_SECRET || 'dsa-crm-test-bypass-jwt-secret-key-2026';
  const signature = crypto
    .createHmac('sha256', bypassSecret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${signature}`;
}

export async function setupPersonaSession(
  page: Page,
  persona: PersonaConfig,
  aal: 'aal1' | 'aal2' = 'aal2',
  seedStorage = true,
) {
  const token = createMockJwt(persona, aal);
  const tenantId = persona.tenantId || 'ten_01M595WCNH6H3ZMCVS70XH9GAN';
  const sessionData = {
    access_token: token,
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    refresh_token: 'mock-refresh-token',
    user: {
      id: persona.userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: persona.email,
      app_metadata: { tenant_id: tenantId },
      user_metadata: { display_name: persona.displayName },
      factors: [
        {
          id: 'factor_totp_1',
          friendly_name: 'Authenticator',
          factor_type: 'totp',
          status: 'verified',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };

  // Seed localStorage if requested
  if (seedStorage) {
    await page.addInitScript(
      ({ session }) => {
        localStorage.setItem('sb-mlpkwwhnagxzinaohdxg-auth-token', JSON.stringify(session));
      },
      { session: sessionData },
    );
  }

  // Mock Supabase token endpoint (signInWithPassword)
  await page.route('**/auth/v1/token*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sessionData),
      });
    } else {
      await route.continue();
    }
  });

  // Mock Supabase sign-out
  await page.route('**/auth/v1/logout*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });

  // Mock test-login endpoint for fast bypass fallback
  const aal2Token = createMockJwt(persona, 'aal2');
  const aal2SessionData = {
    ...sessionData,
    access_token: aal2Token,
  };
  await page.route('**/public/v1/auth/test-login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          access_token: aal2Token,
          session: aal2SessionData,
        },
      }),
    });
  });

  // Mock Supabase Auth routes
  await page.route('**/auth/v1/user', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessionData.user),
    });
  });

  await page.route('**/auth/v1/factors', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        all: [{ id: 'factor_totp_1', factor_type: 'totp', status: 'verified' }],
        totp: [{ id: 'factor_totp_1', status: 'verified' }],
      }),
    });
  });

  // Mock MFA challenge/verify so the client immediately detects MFA as disabled and signs in without 2-step verification
  await page.route('**/auth/v1/factors/**/challenge*', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'mfa_totp_verify_not_enabled',
        message: 'Two-step verification is not enabled for this project',
      }),
    });
  });

  await page.route('**/auth/v1/factors/*/verify*', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'mfa_totp_verify_not_enabled',
        message: 'Two-step verification is not enabled for this project',
      }),
    });
  });

  // Mock /v1/me endpoint
  await page.route('**/v1/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: persona.userId,
        email: persona.email,
        displayName: persona.displayName,
        tenantId: tenantId,
        primaryBranchId: persona.primaryBranchId || 'MUM01',
        queueIds: ['queue_01'],
        roles: [persona.roleCode],
        grants: persona.permissions.map((p) => ({
          code: p,
          scope: 'TENANT',
          branchIds: ['MUM01'],
        })),
        mfaVerifiedAt: new Date().toISOString(),
        lockVersion: 1,
      }),
    });
  });

  const isVaibhav = Object.values(VAIBHAV_PERSONAS).some((p) => p.userId === persona.userId);

  // Mock /v1/tenant endpoint
  await page.route('**/v1/tenant', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: tenantId,
        slug: isVaibhav ? 'vaibhav-finserv' : 'qloax-dsa',
        legalName: isVaibhav ? 'Vaibhav Finserv Private Limited' : 'Qloax Finserv Private Limited',
        tenantType: 'DSA',
        dataRegion: 'ap-south-1',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
  });

  // Mock /v1/notifications
  await page.route('**/v1/notifications**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { unreadCount: 0 } }),
    });
  });

  // Mock /v1/branches
  await page.route('**/v1/branches**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { id: 'MUM01', code: 'MUM01', name: 'Mumbai Central' },
          { id: 'PUN01', code: 'PUN01', name: 'Pune Camp' },
        ],
      }),
    });
  });

  // Auxiliary background endpoints to prevent unauthenticated fallthrough warnings in backend logs
  await page.route('**/v1/connectors**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    });
  });

  await page.route('**/v1/timeline**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/platform/v1/master-data**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/platform/v1/support-access-requests**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    });
  });

  await page.route('**/platform/v1/releases**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    });
  });

  await page.route('**/v1/users**', async (route) => {
    const url = route.request().url();
    const idMatch = url.match(/\/v1\/users\/([^?]+)/);
    if (idMatch) {
      const userId = idMatch[1];
      const matched = Object.values(VAIBHAV_PERSONAS).find((p) => p.userId === userId) ||
        Object.values(ALPHA_PERSONAS).find((p) => p.userId === userId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: userId,
          email: matched?.email || 'staff@example.com',
          displayName: matched?.displayName || 'Staff Member',
          primaryBranchId: 'MUM01',
          roles: [matched?.roleCode || 'ROLE-STAFF'],
          assignedRoles: [matched?.roleCode || 'ROLE-STAFF'],
          status: 'ACTIVE',
        }),
      });
    } else {
      const personaSource = isVaibhav ? VAIBHAV_PERSONAS : ALPHA_PERSONAS;
      const usersList = Object.values(personaSource).map((p) => ({
        id: p.userId,
        email: p.email,
        displayName: p.displayName,
        emailMasked: p.email.replace(/(.{2})(.*)(@.*)/, '$1••••$3'),
        mobileMasked: '+91 ••••• ••234',
        primaryBranchId: p.primaryBranchId || 'MUM01',
        roles: [p.roleCode],
        assignedRoles: [p.roleCode],
        status: 'ACTIVE',
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: usersList, meta: { total: usersList.length, limit: 50, nextCursor: null } }),
      });
    }
  });

  await page.route('**/v1/customers**', async (route) => {
    const url = route.request().url();
    if (url.includes('/cus_demo_kavya_001')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'cus_demo_kavya_001',
          fullName: 'Kavya Deshmukh',
          mobileMasked: '+91 ••••• ••234',
          emailMasked: 'kavya.deshmukh@example.com',
          pincode: '400008',
          status: 'ACTIVE',
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'cus_demo_kavya_001',
              fullName: 'Kavya Deshmukh',
              mobileMasked: '+91 ••••• ••234',
              emailMasked: 'kavya.deshmukh@example.com',
              pincode: '400008',
              status: 'ACTIVE',
            },
          ],
          meta: { total: 1 },
        }),
      });
    }
  });
}

export async function performRoleLogin(
  page: Page,
  persona: PersonaConfig,
  targetPath = '/',
  password = 'Qloax@DSA#2026',
): Promise<void> {
  // 1. Setup API route mocks for the persona with direct aal2 session (no 2-step verification)
  await setupPersonaSession(page, persona, 'aal2', false);

  // Pre-seed storage flags so two-step verification is recognized as disabled
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dsa_bypass_active', 'true');
      sessionStorage.setItem('dsa_bypass_active', 'true');
      sessionStorage.setItem('dsa_mfa_project', 'disabled');
      localStorage.setItem('dsa_mfa_project', 'disabled');
    } catch {}
  });

  // 2. Navigate to /login
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  const emailInput = page.locator('[data-testid="auth.email"]');
  const isLoginPage = await emailInput.isVisible({ timeout: 4000 }).catch(() => false);

  if (isLoginPage) {
    await showDemoBanner(
      page,
      'Authentication Gate',
      `Signing in as ${persona.displayName} (${persona.roleCode})`,
    );

    const passwordInput = page.locator('[data-testid="auth.password"]');
    const submitBtn = page.locator('[data-testid="auth.submit"]');

    await humanType(emailInput, persona.email, 30);
    await humanType(passwordInput, password, 30);
    await pauseForDemo(page, 500);
    await humanClick(submitBtn, 800);

    // Wait until login completes and navigates away from /login
    const navigatedAway = await page
      .waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 8000 })
      .then(() => true)
      .catch(() => false);

    // Safety fallback: if dialog is still displayed, auto-verify silently
    if (!navigatedAway) {
      const mfaInput = page.locator('[data-testid="mfa.code"], [data-testid="auth.mfa.code"]');
      if (await mfaInput.isVisible({ timeout: 1500 }).catch(() => false)) {
        const mfaSubmit = page.locator('[data-testid="mfa.submit"], [data-testid="auth.mfa.submit"]');
        await mfaInput.fill('000000');
        await mfaSubmit.click();
        await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 8000 }).catch(() => {});
      }
    }
  }

  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // 3. Ensure destination is reached
  if (targetPath && targetPath !== '/' && !page.url().includes(targetPath)) {
    await pauseForDemo(page, 400);
    try {
      await page.goto(targetPath, { waitUntil: 'domcontentloaded' });
    } catch {
      if (!page.url().includes(targetPath)) {
        await page.waitForTimeout(600);
        await page.goto(targetPath, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }
  }

  // Ensure the page is never stuck bouncing back to /login
  if (page.url().includes('/login')) {
    const aal2Token = createMockJwt(persona, 'aal2');
    const tenantId = persona.tenantId || 'ten_01M595WCNH6H3ZMCVS70XH9GAN';
    const fallbackSession = {
      access_token: aal2Token,
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      refresh_token: 'mock-refresh-token',
      user: {
        id: persona.userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: persona.email,
        app_metadata: { tenant_id: tenantId },
        user_metadata: { display_name: persona.displayName },
        created_at: '2026-01-01T00:00:00.000Z',
      },
    };
    await page.evaluate(({ session }) => {
      localStorage.setItem('sb-mlpkwwhnagxzinaohdxg-auth-token', JSON.stringify(session));
      localStorage.setItem('dsa_bypass_active', 'true');
      sessionStorage.setItem('dsa_bypass_active', 'true');
      sessionStorage.setItem('dsa_mfa_project', 'disabled');
      localStorage.setItem('dsa_mfa_project', 'disabled');
    }, { session: fallbackSession });
    await page.goto(targetPath || '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await pauseForDemo(page, 1000);
}

export async function performRoleLogout(page: Page): Promise<void> {
  await showDemoBanner(page, 'Session Sign-Out', 'Signing out of role session');
  const accountBtn = page.locator('[data-testid="shell.account"]');
  if (await accountBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await humanClick(accountBtn, 400);
    const signoutBtn = page.locator('[data-testid="shell.signout"]');
    if (await signoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await humanClick(signoutBtn, 800);
    }
  } else {
    // If shell header is not visible (e.g. 403 or non-shell screen), clear storage and return to login
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/login');
  }
  const submitBtn = page.locator('[data-testid="auth.submit"]');
  await submitBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await showDemoBanner(page, 'Signed Out', 'Returned cleanly to Sign-In gate');
  await pauseForDemo(page, 800);
}

export const isHeaded = process.env.HEADED === 'true' || process.argv.includes('--headed');

export async function showDemoBanner(page: Page, title: string, subtitle?: string): Promise<void> {
  if (!isHeaded) return;
  try {
    await page.evaluate(({ title, subtitle }) => {
      let host = document.getElementById('demo-step-banner-host') as any;
      if (!host) {
        host = document.createElement('div');
        host.id = 'demo-step-banner-host';
        host.style.position = 'fixed';
        host.style.top = '12px';
        host.style.left = '50%';
        host.style.transform = 'translateX(-50%)';
        host.style.zIndex = '999999';
        host.style.pointerEvents = 'none';

        // Use closed shadow DOM so that Playwright test locators (getByText, etc.)
        // never collide with demo banner text during headed runs.
        const shadow = host.attachShadow({ mode: 'closed' });
        host._demoShadow = shadow;
        document.body.appendChild(host);
      }

      const shadow = host._demoShadow;
      if (shadow) {
        shadow.innerHTML = `
          <div style="
            background-color: rgba(15, 23, 42, 0.94);
            color: #ffffff;
            padding: 8px 18px;
            border-radius: 9999px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(59, 130, 246, 0.5);
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 13px;
            font-weight: 600;
            border: 1px solid rgba(96, 165, 250, 0.6);
            backdrop-filter: blur(10px);
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            <span style="background:#2563eb;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:9999px;text-transform:uppercase;letter-spacing:0.05em;">Step</span>
            <span>${title}</span>
            ${subtitle ? `<span style="color:#94a3b8;font-weight:400;">— ${subtitle}</span>` : ''}
          </div>
        `;
      }
    }, { title, subtitle });
    await page.waitForTimeout(600);
  } catch {
    // Ignore in case page is navigating
  }
}

export async function pauseForDemo(page: Page, ms = 1400): Promise<void> {
  if (isHeaded) {
    const demoMs = Math.min(Math.max(ms, 400), 3500);
    await page.waitForTimeout(demoMs);
  }
}

async function showSpotlight(locator: Locator, action: 'click' | 'type'): Promise<void> {
  if (!isHeaded) return;
  try {
    await locator.evaluate((el: HTMLElement, { action }) => {
      // Find or create host with closed shadow DOM to prevent Playwright locator collisions
      let host = document.getElementById('demo-spotlight-host') as any;
      if (!host) {
        host = document.createElement('div');
        host.id = 'demo-spotlight-host';
        host.style.position = 'fixed';
        host.style.top = '0';
        host.style.left = '0';
        host.style.width = '0';
        host.style.height = '0';
        host.style.zIndex = '999998';
        host.style.pointerEvents = 'none';
        const shadow = host.attachShadow({ mode: 'closed' });
        host._shadow = shadow;
        document.body.appendChild(host);
      }

      const rect = el.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      // Extract a short readable label from the element (button text, placeholder, or aria-label)
      let label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.innerText ||
        el.getAttribute('name') ||
        el.getAttribute('data-testid') ||
        el.tagName
      ).trim().split('\n')[0].trim();
      if (label.length > 26) label = label.slice(0, 23) + '...';

      const isClick = action === 'click';
      const color = isClick ? '#f59e0b' : '#3b82f6';
      const bg = isClick ? '#b45309' : '#1d4ed8';
      const icon = isClick ? '👉 Click:' : '✍️ Fill:';

      const shadow = host._shadow;
      if (shadow) {
        shadow.innerHTML = `
          <div style="
            position: fixed;
            left: ${Math.max(0, rect.left - 4)}px;
            top: ${Math.max(0, rect.top - 4)}px;
            width: ${rect.width + 8}px;
            height: ${rect.height + 8}px;
            border-radius: 8px;
            border: 3px solid ${color};
            box-shadow: 0 0 18px 4px ${color}, inset 0 0 8px ${color};
            pointer-events: none;
            box-sizing: border-box;
            transition: all 0.15s ease-out;
          ">
            <div style="
              position: absolute;
              bottom: calc(100% + 5px);
              left: 50%;
              transform: translateX(-50%);
              background: ${bg};
              color: #ffffff;
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.02em;
              padding: 3px 8px;
              border-radius: 6px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.5);
              white-space: nowrap;
              border: 1px solid rgba(255,255,255,0.4);
            ">
              ${icon} ${label}
            </div>
            ${isClick ? `
            <div style="
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: #ef4444;
              border: 2px solid #ffffff;
              box-shadow: 0 0 12px 4px #ef4444;
              pointer-events: none;
            "></div>
            ` : ''}
          </div>
        `;
      }
    }, { action });
  } catch {
    // Ignore in case element is navigating or unmounted
  }
}

async function clearSpotlight(locator: Locator): Promise<void> {
  if (!isHeaded) return;
  try {
    await locator.page().evaluate(() => {
      const host = document.getElementById('demo-spotlight-host') as any;
      if (host?._shadow) {
        host._shadow.innerHTML = '';
      }
    });
  } catch {
    // Clearing storage is best effort; a blocked storage area is not an error for the test.
  }
}

export async function humanType(locator: Locator, text: string, charDelay = 35): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  if (isHeaded) {
    await showSpotlight(locator, 'type');
    await locator.page().waitForTimeout(200);
    await clearSpotlight(locator);
  }
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: charDelay });
  const actual = await locator.inputValue().catch(() => '');
  if (actual !== text) {
    await locator.fill(text);
  }
  if (isHeaded) {
    await locator.page().waitForTimeout(300);
  }
}

export async function humanClick(locator: Locator, pauseAfter = 500): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  if (isHeaded) {
    await showSpotlight(locator, 'click').catch(() => {});
    await locator.hover().catch(() => {});
    await locator.page().waitForTimeout(250); // Visual pause so observer registers the target
    await clearSpotlight(locator).catch(() => {});
  }
  await locator.click();
  if (isHeaded) {
    const tunedPause = Math.max(pauseAfter, 400);
    await locator.page().waitForTimeout(tunedPause);
  }
}
