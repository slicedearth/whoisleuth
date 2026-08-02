// Static prerendering cannot place SvelteKit's page-specific bootstrap hashes
// in one deployment-wide response header. This response policy therefore
// provides an immediate, conservative baseline while the generated HTML meta
// policy applies the stricter per-page script hashes. Browsers enforce both
// policies, so this allowance does not replace the hash restriction.
const HTTP_BASELINE_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export {
  HTTP_BASELINE_CONTENT_SECURITY_POLICY,
};
