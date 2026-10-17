// apps/api/src/modules/security/compliance.ts — Module 39: Security (MOD-SEC)
// Regulatory Compliance Engine: CERT-In 6-Hour Reporting Matrix & DPDP Act 2023 Breach Templates

import type { IncidentRecord, IncidentType, IncidentSeverity } from '@dsa/contracts';

/**
 * CERT-In Directions (28 April 2022) Annexure-I Mandatory Reporting Categories
 */
export const CERT_IN_CATEGORIES: Record<IncidentType, { code: string; title: string }> = {
  DATA_BREACH: {
    code: 'CAT-11',
    title: 'Data Breach / Leak of Sensitive Personal or Financial Data',
  },
  UNAUTHORIZED_ACCESS: {
    code: 'CAT-02',
    title: 'Compromise of Critical Systems / Unauthorized System Access',
  },
  MALWARE: {
    code: 'CAT-08',
    title: 'Attacks on Critical Servers, Databases, and Infrastructure',
  },
  DENIAL_OF_SERVICE: {
    code: 'CAT-07',
    title: 'Denial of Service (DoS) and Distributed Denial of Service (DDoS) Attacks',
  },
  PRIVILEGE_ESCALATION: {
    code: 'CAT-03',
    title: 'Unauthorized Access to IT Systems and Privilege Escalation',
  },
  CREDENTIAL_LEAK: {
    code: 'CAT-13',
    title: 'Identity Theft, Spoofing, and Phishing / Credential Leakage',
  },
  OTHER: {
    code: 'CAT-20',
    title: 'Other Security Incident Impacting System Integrity',
  },
};

/**
 * CERT-In 6-Hour SLA Tracking Result
 */
export interface CertInSlaStatus {
  isCritical: boolean;
  mandatoryReportingRequired: boolean;
  category: { code: string; title: string };
  detectedAt: string;
  certInDeadline: string;
  isReported: boolean;
  reportedAt: string | null;
  isOverdue: boolean;
  minutesRemaining: number;
  recipientEmail: string;
}

/**
 * Computes the CERT-In 6-hour reporting window and compliance status.
 */
export function evaluateCertInSla(incident: IncidentRecord, now: Date = new Date()): CertInSlaStatus {
  const isCritical = incident.severity === 'CRITICAL';
  const mandatoryReportingRequired = isCritical || incident.type === 'DATA_BREACH';
  const category = CERT_IN_CATEGORIES[incident.type] ?? CERT_IN_CATEGORIES.OTHER;

  const detectedDate = new Date(incident.detectedAt);
  // 6 hours window from detection (CERT-In Directions Section 2(i))
  const certInDeadline = new Date(detectedDate.getTime() + 6 * 60 * 60 * 1000);

  const authorityNotif = incident.notifications?.authority;
  const isReported = Boolean(authorityNotif?.notified && authorityNotif?.notifiedAt);
  const reportedAt = authorityNotif?.notifiedAt ?? null;

  const diffMs = certInDeadline.getTime() - now.getTime();
  const minutesRemaining = Math.max(0, Math.floor(diffMs / (60 * 1000)));
  const isOverdue = mandatoryReportingRequired && !isReported && now.getTime() > certInDeadline.getTime();

  return {
    isCritical,
    mandatoryReportingRequired,
    category,
    detectedAt: incident.detectedAt,
    certInDeadline: certInDeadline.toISOString(),
    isReported,
    reportedAt,
    isOverdue,
    minutesRemaining,
    recipientEmail: 'incident@cert-in.org.in',
  };
}

/**
 * Generates official CERT-In Incident Notification Report Payload (Annexure-1).
 */
export function generateCertInReport(
  incident: IncidentRecord,
  metadata?: {
    organizationName?: string;
    contactPerson?: string;
    contactEmail?: string;
    contactPhone?: string;
  },
): Record<string, unknown> {
  const sla = evaluateCertInSla(incident);
  return {
    certInReportingForm: 'ANNEXURE-1_INCIDENT_REPORT',
    mandateReference: 'CERT-In Directions under Sub-section (6) of Section 70B of IT Act 2000',
    incidentId: incident.id,
    reportingCategory: `${sla.category.code}: ${sla.category.title}`,
    severityLevel: incident.severity,
    dateTimeOfDetectionUTC: incident.detectedAt,
    statutoryDeadlineUTC: sla.certInDeadline,
    slaComplianceStatus: sla.isReported
      ? 'REPORTED_WITHIN_WINDOW'
      : sla.isOverdue
        ? 'OVERDUE_CRITICAL_ESCALATION'
        : 'PENDING_DISPATCH',
    organization: {
      name: metadata?.organizationName ?? 'DSA CRM Platform Enterprise',
      tenantId: incident.tenantId,
      pointOfContact: metadata?.contactPerson ?? 'Information Security Officer',
      email: metadata?.contactEmail ?? 'infosec@dsacrm.internal',
      phone: metadata?.contactPhone ?? '+91-22-XXXXXXXX',
    },
    incidentDetails: {
      type: incident.type,
      affectedTenantsCount: incident.affectedTenants.length,
      affectedTenants: incident.affectedTenants,
      personalDataCompromised: incident.personalDataInvolved,
      containmentStatus: incident.status,
      postMortemReference: incident.postMortemRef ?? 'IN_PROGRESS',
    },
    officialSubmissionEndpoint: 'incident@cert-in.org.in',
  };
}

/**
 * DPDP Act 2023 Statutory Notice to the Data Protection Board of India (DPBI).
 * Issued pursuant to Section 8(6) of the Digital Personal Data Protection Act, 2023.
 */
export function generateDpbiBreachNotice(
  incident: IncidentRecord,
  opts?: {
    dpoName?: string;
    dpoEmail?: string;
    estimatedAffectedPrincipals?: number;
    compromisedDataCategories?: string[];
  },
): Record<string, unknown> {
  return {
    statutoryNotice: 'DPDP_ACT_2023_SECTION_8_6_DPBI_NOTICE',
    regulatoryAuthority: 'Data Protection Board of India (DPBI)',
    incidentReferenceId: incident.id,
    tenantIdentifier: incident.tenantId,
    timestampOfDetection: incident.detectedAt,
    dataFiduciaryInformation: {
      entityType: 'Non-Banking Financial Company (NBFC) / Lending Partner Service Provider',
      designatedDataProtectionOfficer: {
        name: opts?.dpoName ?? 'Chief Privacy & Compliance Officer',
        email: opts?.dpoEmail ?? 'dpo@dsacrm.internal',
        jurisdiction: 'Republic of India',
      },
    },
    breachAssessment: {
      personalDataInvolved: incident.personalDataInvolved,
      estimatedDataPrincipalsAffected: opts?.estimatedAffectedPrincipals ?? 0,
      categoriesOfPersonalData: opts?.compromisedDataCategories ?? [
        'Borrower Identity (Name, Contact Details, Address)',
        'Financial Information (Application Metadata, Loan Tranche Reference)',
      ],
      severityClassification: incident.severity,
      initialContainmentAction: incident.status,
    },
    remedialMeasuresAdopted: [
      'Revocation and rotation of active session tokens across affected tenant boundaries',
      'Containment and isolation of compromised endpoints / microservices',
      'Forensic audit trail preservation adhering to 180-day jurisdictional logs mandate',
      'Direct individual notice dispatch initiated to affected data principals',
    ],
  };
}

/**
 * DPDP Act 2023 Individual Breach Notification Template for affected Data Principals (Borrowers/DSA Operators).
 */
export function generateIndividualBreachNotice(
  incident: IncidentRecord,
  opts?: {
    borrowerName?: string;
    compromisedCategories?: string[];
    helplinePhone?: string;
    grievanceEmail?: string;
  },
): { subject: string; bodyHtml: string; plainText: string } {
  const categories = (
    opts?.compromisedCategories ?? ['Borrower Contact Profile', 'Loan Application Reference Number']
  ).join(', ');

  const subject = `[Important Security Notice] Notification Regarding Your Personal Data Protection`;

  const plainText = `
Dear ${opts?.borrowerName ?? 'Valued Customer / Partner'},

We are writing to inform you of a recent data security event detected on ${new Date(incident.detectedAt).toLocaleDateString('en-IN')} that may have affected information associated with your loan application profile, pursuant to Section 8(6) of the Digital Personal Data Protection Act, 2023.

WHAT HAPPENED:
Our security operations center identified an unauthorized incident (${incident.type}) affecting select system records. The incident has been contained, and immediate protective safeguards have been deployed.

INFORMATION INVOLVED:
The following categories of information may have been affected: ${categories}.
No raw bank account passwords, PINs, or Aadhaar biometric data were compromised.

WHAT WE HAVE DONE:
1. Implemented instant security isolations and rotated all access credentials.
2. Informed statutory authorities including the Data Protection Board of India.
3. Enhanced multi-factor authentication and continuous real-time monitoring.

RECOMMENDED ACTIONS FOR YOU:
- Remain vigilant against unexpected phone calls, SMS, or emails requesting OTPs or passwords.
- Verify that your communications originate strictly from verified platform addresses.

FOR ASSISTANCE & GRIEVANCES:
If you have questions or require support, please contact our Data Protection & Grievance Officer:
- Email: ${opts?.grievanceEmail ?? 'grievance-officer@dsacrm.internal'}
- Helpline: ${opts?.helplinePhone ?? '1800-XXX-XXXX'} (Toll-Free, 9 AM - 6 PM IST)
`.trim();

  const bodyHtml = `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px;">
  <h2 style="color: #c62828; margin-top: 0;">Notice of Data Security Incident</h2>
  <p>Dear <strong>${opts?.borrowerName ?? 'Valued Customer / Partner'}</strong>,</p>
  <p>We are writing to notify you in accordance with the <strong>Digital Personal Data Protection Act, 2023</strong> regarding a security event detected on <strong>${new Date(incident.detectedAt).toLocaleDateString('en-IN')}</strong>.</p>
  
  <div style="background-color: #f5f5f5; border-left: 4px solid #1976d2; padding: 12px; margin: 16px 0;">
    <h4 style="margin: 0 0 8px 0;">Information Potentially Involved:</h4>
    <p style="margin: 0;">${categories}</p>
  </div>

  <h3>Our Response:</h3>
  <ul>
    <li>The affected environment was contained and secured immediately.</li>
    <li>Notified statutory regulatory bodies including the Data Protection Board of India.</li>
    <li>Enforced mandatory enhanced security controls across all tenant gateways.</li>
  </ul>

  <h3>Recommended Precautionary Steps:</h3>
  <p>Please exercise caution regarding unsolicited communications asking for sensitive information such as OTPs, PINs, or banking passwords. Our representatives will never request your passwords.</p>

  <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
  <p style="font-size: 13px; color: #666;">
    <strong>Data Protection &amp; Grievance Redressal:</strong><br />
    Email: <a href="mailto:${opts?.grievanceEmail ?? 'grievance-officer@dsacrm.internal'}">${opts?.grievanceEmail ?? 'grievance-officer@dsacrm.internal'}</a><br />
    Toll-Free Helpline: ${opts?.helplinePhone ?? '1800-XXX-XXXX'} (Mon–Fri, 9:00 AM – 6:00 PM IST)
  </p>
</div>
`.trim();

  return { subject, bodyHtml, plainText };
}
