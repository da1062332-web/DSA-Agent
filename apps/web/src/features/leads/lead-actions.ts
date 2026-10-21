// Which action buttons the lead page shows (audit F-12): the lead's state decides which actions make sense, and the permission the API
// requires for that action decides whether this user is offered it. The permission for each action is the one the lead service checks
// (apps/api/src/modules/crm/leads: state-machine.ts requiredPermission per transition, lead-service.ts for assign and convert). The API
// refuses the request without it either way; hiding the button only stops the screen from offering something that cannot work.
export interface LeadActions {
  attemptContact: boolean; // T-LEAD-01, needs lead.update
  markInProgress: boolean; // T-LEAD-02, needs lead.update
  qualify: boolean; // T-LEAD-04, needs lead.qualify
  disqualify: boolean; // T-LEAD-05, needs lead.qualify
  convert: boolean; // conversion to an application, needs application.create
  assign: boolean; // assignment, needs lead.assign
}

export function leadActions(state: string, can: (code: string) => boolean): LeadActions {
  return {
    attemptContact: state === 'NEW' && can('lead.update'),
    markInProgress: (state === 'NEW' || state === 'CONTACT_ATTEMPTED') && can('lead.update'),
    qualify: state === 'IN_PROGRESS' && can('lead.qualify'),
    disqualify: state === 'IN_PROGRESS' && can('lead.qualify'),
    convert: state === 'QUALIFIED' && can('application.create'),
    assign: state !== 'CONVERTED' && state !== 'ARCHIVED' && can('lead.assign'),
  };
}
