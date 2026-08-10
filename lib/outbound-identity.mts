import { WHOISLEUTH_APPLICATION_VERSION } from './application-version.mts';
import {
  WHOISLEUTH_PROJECT_URL,
  WHOISLEUTH_REQUEST_POLICY_URL,
} from './project-metadata.mts';

export { WHOISLEUTH_PROJECT_URL, WHOISLEUTH_REQUEST_POLICY_URL };

export const WHOISLEUTH_USER_AGENT_VERSION = WHOISLEUTH_APPLICATION_VERSION;
export const WHOISLEUTH_USER_AGENT = `WHOISleuth/${WHOISLEUTH_USER_AGENT_VERSION} (+${WHOISLEUTH_REQUEST_POLICY_URL})`;

export function whoisleuthRequestHeaders(
  headers: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...headers, 'User-Agent': WHOISLEUTH_USER_AGENT };
}
