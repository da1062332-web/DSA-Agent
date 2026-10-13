// apps/api/src/modules/crm/leads/state-machine.ts — owner: Dev 5 (SUB-LEAD.06)
import { AppError } from '@dsa/contracts';
import type { LeadRow } from './repository';
import type { LeadTransitionInput } from './types';

export interface TransitionOutcome {
  targetState: LeadRow['state'];
  transitionCode: 'T-LEAD-01' | 'T-LEAD-02' | 'T-LEAD-04' | 'T-LEAD-05' | 'T-LEAD-06';
  requiredPermission: 'lead.update' | 'lead.qualify' | 'lead.reopen' | 'application.create';
  updates: Partial<LeadRow>;
}

export function validateLeadTransition(
  lead: LeadRow,
  input: LeadTransitionInput,
): TransitionOutcome {
  const currentState = lead.state;

  switch (input.transitionCode) {
    case 'T-LEAD-01': {
      // T-LEAD-01: Log contact attempt
      if (currentState !== 'NEW' && currentState !== 'CONTACT_ATTEMPTED') {
        throw AppError.of(
          'INVALID_TRANSITION',
          `Cannot execute T-LEAD-01 from state '${currentState}'. Only NEW or CONTACT_ATTEMPTED allowed.`,
        );
      }
      return {
        targetState: 'CONTACT_ATTEMPTED',
        transitionCode: 'T-LEAD-01',
        requiredPermission: 'lead.update',
        updates: {
          state: 'CONTACT_ATTEMPTED',
          contact_attempts: (lead.contact_attempts ?? 0) + 1,
          ...(input.nextFollowUpAt !== undefined
            ? { next_follow_up_at: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null }
            : {}),
        },
      };
    }

    case 'T-LEAD-02': {
      // T-LEAD-02: Move to IN_PROGRESS when engaged
      if (currentState !== 'NEW' && currentState !== 'CONTACT_ATTEMPTED') {
        throw AppError.of(
          'INVALID_TRANSITION',
          `Cannot execute T-LEAD-02 from state '${currentState}'. Only NEW or CONTACT_ATTEMPTED allowed.`,
        );
      }
      return {
        targetState: 'IN_PROGRESS',
        transitionCode: 'T-LEAD-02',
        requiredPermission: 'lead.update',
        updates: {
          state: 'IN_PROGRESS',
        },
      };
    }

    case 'T-LEAD-04': {
      // T-LEAD-04: Qualify lead
      if (
        currentState !== 'IN_PROGRESS' &&
        currentState !== 'NEW' &&
        currentState !== 'CONTACT_ATTEMPTED'
      ) {
        throw AppError.of(
          'INVALID_TRANSITION',
          `Cannot execute T-LEAD-04 from state '${currentState}'. Lead must be in an open state.`,
        );
      }

      const applicantType = input.qualification?.applicantType ?? lead.qual_applicant_type;
      const requestedAmount = input.qualification?.requestedAmount?.amount ?? lead.qual_requested_amount;

      if (!applicantType || !requestedAmount) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'T-LEAD-04 requires qualification details: applicantType and requestedAmount',
          [
            { field: 'qualification.applicantType', issue: 'REQUIRED_FOR_QUALIFIED' },
            { field: 'qualification.requestedAmount', issue: 'REQUIRED_FOR_QUALIFIED' },
          ],
        );
      }

      return {
        targetState: 'QUALIFIED',
        transitionCode: 'T-LEAD-04',
        requiredPermission: 'lead.qualify',
        updates: {
          state: 'QUALIFIED',
          qual_applicant_type: applicantType,
          qual_requested_amount: requestedAmount,
          qual_tenure_months:
            input.qualification?.tenureMonths !== undefined
              ? input.qualification.tenureMonths
              : lead.qual_tenure_months,
          qual_purpose_code:
            input.qualification?.purposeCode !== undefined
              ? input.qualification.purposeCode
              : lead.qual_purpose_code,
        },
      };
    }

    case 'T-LEAD-05': {
      // T-LEAD-05: Disqualify lead
      if (
        currentState === 'CONVERTED' ||
        currentState === 'DISQUALIFIED' ||
        currentState === 'MERGED' ||
        currentState === 'ARCHIVED'
      ) {
        throw AppError.of(
          'INVALID_TRANSITION',
          `Cannot execute T-LEAD-05 from terminal/closed state '${currentState}'.`,
        );
      }

      const disqReason = input.disqualificationReason ?? lead.disqualification_reason;
      if (!disqReason) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'T-LEAD-05 requires disqualificationReason',
          [{ field: 'disqualificationReason', issue: 'REQUIRED_FOR_DISQUALIFIED' }],
        );
      }

      return {
        targetState: 'DISQUALIFIED',
        transitionCode: 'T-LEAD-05',
        requiredPermission: 'lead.qualify',
        updates: {
          state: 'DISQUALIFIED',
          disqualification_reason: disqReason,
        },
      };
    }

    case 'T-LEAD-06': {
      // T-LEAD-06: Reopen disqualified or unreachable lead to NEW
      if (currentState !== 'DISQUALIFIED' && currentState !== 'NOT_CONTACTABLE') {
        throw AppError.of(
          'INVALID_TRANSITION',
          `Cannot execute T-LEAD-06 from state '${currentState}'. Only DISQUALIFIED or NOT_CONTACTABLE leads can be reopened.`,
        );
      }

      if (!input.reasonCode) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'T-LEAD-06 requires a reopening reasonCode',
          [{ field: 'reasonCode', issue: 'REQUIRED_FOR_REOPEN' }],
        );
      }

      return {
        targetState: 'NEW',
        transitionCode: 'T-LEAD-06',
        requiredPermission: 'lead.reopen',
        updates: {
          state: 'NEW',
          disqualification_reason: null,
        },
      };
    }

    default:
      throw AppError.of(
        'INVALID_TRANSITION',
        `Unsupported or deferred lead transition code: '${(input as { transitionCode: string }).transitionCode}'`,
      );
  }
}
