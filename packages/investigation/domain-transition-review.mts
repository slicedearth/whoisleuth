/** Review prompts for changes already admitted by a source-aware comparator. */
export function domainTransitionReview(field: string, before: unknown, after: unknown): string | null {
  if (before == null || after == null) return null;
  switch (field) {
    case 'createdDate':
      return 'Reassess earlier relevance, exceptions and response baselines against the changed registration date. Keep the prior history; the date alone does not establish a new owner or confirmed re-registration.';
    case 'availability':
      return before === 'available' || after === 'available'
        ? 'Review the dated registration observations before carrying earlier decisions into this context. An availability change does not by itself establish who controls the domain.'
        : 'Review the registration state in its source context; sale and expiry labels do not establish deletion or a change of owner.';
    case 'expiryDate':
      return 'Check the reported renewal timeline. Expiry, deletion and re-registration are different events; this change does not reset earlier decisions.';
    case 'registrar':
    case 'registrarName':
      return 'Review the registration source and any expected transfer. A registrar change is not evidence of new ownership.';
    case 'nameservers':
      return 'Compare the delegation change with expected hosting or DNS maintenance before revising relationships or response routes.';
    case 'hasMx':
    case 'hasNullMx':
    case 'hasSpf':
    case 'hasDmarc':
      return 'Review the changed mail configuration against the watch reason. DNS configuration does not show whether messages were sent or an account was compromised.';
    case 'hasPasswordField':
      return after === true
        ? 'Review the newly observed password form and its destination against the recorded concern. A login form alone is not credential theft.'
        : 'Review the current page evidence before changing the assessment; removal of one form does not establish that the incident is resolved.';
    case 'hasExternalFormAction':
      return 'Check the observed form destination and legitimate service use before updating the assessment. No form was submitted by this review.';
    case 'hasExternalPasswordForm':
      return 'Review the password form’s declared destination against the recorded concern and expected identity provider. A changed declaration is not an observed submission.';
    case 'faviconMatch':
    case 'faviconNearMatch':
    case 'reusesOfficialAssets':
    case 'pageBaselineMatch':
      return 'Review the retained Brand comparison and legitimate shared assets. An identity match or its disappearance is not an infringement or resolution verdict.';
    case 'activityStatus':
      return after === 'unreachable' || after === 'no_site'
        ? 'The website observation is inconclusive; do not treat it as disappearance or resolution. Recheck deliberately within the existing collection scope.'
        : 'Review the changed site activity against the watch reason. A legitimate launch can change the same fields as an incident.';
    case 'pageTitle':
    case 'httpFinalOrigin':
    case 'httpCrossOriginRedirect':
    case 'faviconHash':
      return 'Review the changed page or destination against the retained concern and expected site changes. Preserve the exact observation scope before making a Case or priority decision.';
    default:
      return null;
  }
}
