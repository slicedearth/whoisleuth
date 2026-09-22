import { array, enumeration, exact } from '../evidence/artifact-structure.mts';
import { IDENTITY_ACTIONS, type IdentityAction, type IdentityReviewStep } from '../contracts/message-intake.mts';

/** Reported actions select recovery guidance; they do not establish compromise. */
export function reviewIdentityIncident(value: unknown): Readonly<{ reportedActions: readonly IdentityAction[]; nextSteps: readonly IdentityReviewStep[] }> {
  const input = exact(value, ['reportedActions'], 'Identity incident review');
  const allowed = IDENTITY_ACTIONS.map(action => action.id);
  const reportedActions = [...new Set(array(input.reportedActions, 'Reported actions', allowed.length)
    .map(item => enumeration(item, allowed, 'Reported action')))];
  const has = (...actions: IdentityAction[]) => actions.some(action => reportedActions.includes(action));
  const nextSteps: IdentityReviewStep[] = [];
  const add = (id: string, title: string, detail: string) => nextSteps.push({ id, title, detail });
  if (reportedActions.length) add('preserve', 'Preserve the message and sign-in timeline', 'Record the reported time and action, retain relevant account audit events and keep the original privately. Use an independently known account portal, not the supplied link.');
  if (has('entered_password', 'approved_signin', 'entered_device_code')) {
    add('sessions', 'Review and revoke suspicious account sessions', 'Use the identity provider’s documented response process. Review recent sign-ins, new authentication methods and registered devices; resetting a password alone may not invalidate existing sessions.');
  }
  if (has('entered_password')) add('password', 'Change exposed and reused credentials', 'Change the affected password through a trusted route. Review other accounts where the same credential was used, without testing the supplied site.');
  if (has('granted_consent', 'entered_device_code')) add('grants', 'Review application grants and tokens', 'Identify the application/client ID in account audit records. Revoke unwanted consent and refresh tokens using the provider’s controls; check accessed mail and files and newly created inbox rules.');
  if (has('executed_command')) add('endpoint', 'Escalate for endpoint containment', 'Stop using the affected device for account recovery. Follow the organisation’s endpoint incident process, preserve the command as inert evidence and use a separate trusted device.');
  if (has('entered_password', 'approved_signin', 'entered_device_code', 'granted_consent')) add('persistence', 'Check persistence and downstream access', 'Review forwarding rules, delegates, newly authorised applications and affected data. Record the findings independently of public domain evidence.');
  if (reportedActions.length) add('followup', 'Record recovery actions and a follow-up', 'Track account recovery separately from provider reports and domain availability. A removed page does not show that an account session or application grant was revoked.');
  return { reportedActions, nextSteps };
}
