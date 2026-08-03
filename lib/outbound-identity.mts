export const WHOISLEUTH_PROJECT_URL = 'https://whoisleuth.com/';
export const WHOISLEUTH_REQUEST_POLICY_URL = 'https://whoisleuth.com/request-policy';
export const WHOISLEUTH_USER_AGENT_VERSION = '1.36.0';
export const WHOISLEUTH_USER_AGENT = `WHOISleuth/${WHOISLEUTH_USER_AGENT_VERSION} (+${WHOISLEUTH_REQUEST_POLICY_URL})`;

export function whoisleuthRequestHeaders(
  headers: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...headers, 'User-Agent': WHOISLEUTH_USER_AGENT };
}
