import type { MessageActionHint } from '../contracts/message-intake.mts';

const HINTS: Readonly<Record<MessageActionHint, RegExp>> = {
  clipboard_instruction: /(?:clipboard|copy.{0,40}(?:paste|command)|paste.{0,40}(?:terminal|run|console))/iu,
  shell_instruction: /(?:powershell|cmd\.exe|curl\s|wget\s|terminal|windows\s*\+\s*r)/iu,
  verification_prompt: /(?:verify.{0,40}(?:human|browser)|not a robot|captcha|browser.{0,40}(?:repair|update))/iu,
  device_code_instruction: /(?:device[ -]code|enter.{0,40}code.{0,40}(?:sign|login|log in))/iu,
  consent_instruction: /(?:grant.{0,40}(?:access|permission)|consent|approve.{0,40}(?:application|permission))/iu,
};

/** Wording matches are review leads, never a conclusion about intent or execution. */
export function requestedActionHints(value: string): MessageActionHint[] {
  return (Object.entries(HINTS) as [MessageActionHint, RegExp][]).filter(([, expression]) => expression.test(value)).map(([hint]) => hint);
}
