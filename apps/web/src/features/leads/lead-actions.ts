// Which action buttons the lead page shows (audit F-12): the lead's state decides which actions make sense, and the permission the API
// requires for that action decides whether this user is offered it. States and permissions mirror the lead service
// (apps/api/src/modules/crm/leads: state-machine.ts per transition, lead-service.ts for assign and convert, lead-extras.ts for
// reroute and restore). The API refuses the request without it either way; hiding the button only stops the screen from offering
// something that cannot work.
export interface LeadActions {
  attemptContact: boolean; // T-LEAD-01 from NEW or CONTACT_ATTEMPTED, needs lead.update
  markInProgress: boolean; // T-LEAD-02 from NEW or CONTACT_ATTEMPTED, needs lead.update
  qualify: boolean; // T-LEAD-04 from an open, unqualified state, needs lead.qualify
  disqualify: boolean; // T-LEAD-05 from any state that is not closed, needs lead.qualify
  reopen: boolean; // T-LEAD-06 from DISQUALIFIED or NOT_CONTACTABLE, needs lead.reopen
  archive: boolean; // T-LEAD-07, needs lead.archive (SUB-LEAD.10)
  restore: boolean; // API-LEAD-014 from ARCHIVED, needs lead.archive
  convert: boolean; // API-LEAD-007 from QUALIFIED, needs application.create
  assign: boolean; // API-LEAD-006 on a lead that is still worked, needs lead.assign
  reroute: boolean; // API-LEAD-012 re-runs DK-lead.assignment on an open lead, needs lead.assign
}

const CLOSED = ['CONVERTED', 'MERGED', 'ARCHIVED'];
const OPEN = ['NEW', 'CONTACT_ATTEMPTED', 'IN_PROGRESS', 'QUALIFIED'];

export function leadActions(state: string, can: (code: string) => boolean): LeadActions {
  const early = state === 'NEW' || state === 'CONTACT_ATTEMPTED';
  return {
    attemptContact: early && can('lead.update'),
    markInProgress: early && can('lead.update'),
    qualify: (early || state === 'IN_PROGRESS') && can('lead.qualify'),
    disqualify: !CLOSED.includes(state) && state !== 'DISQUALIFIED' && can('lead.qualify'),
    reopen: (state === 'DISQUALIFIED' || state === 'NOT_CONTACTABLE') && can('lead.reopen'),
    archive: !CLOSED.includes(state) && can('lead.archive'),
    restore: state === 'ARCHIVED' && can('lead.archive'),
    convert: state === 'QUALIFIED' && can('application.create'),
    assign: !CLOSED.includes(state) && can('lead.assign'),
    reroute: OPEN.includes(state) && can('lead.assign'),
  };
}
