import { isValidEmailAddress } from './analysis/utils.ts';

export interface Contact{name?:string|null;org?:string|null;email?:string|null;[key:string]:unknown}
export interface AbuseEvidence{abuseEmail?:string|null}
function validEmail(value:unknown){const email=typeof value==='string'?value.trim():'';return isValidEmailAddress(email)?email:null;}
export function buildOutreachDraft(domain:string,contact:Contact){const greeting=contact.name||contact.org||'there';return[`Hi ${greeting},`,'',`I came across ${domain} and wanted to ask whether you would be open to discussing a potential sale.`,'','Would you be willing to share an asking price, or are you open to receiving an offer?','','Best regards,'].join('\n');}
export function outreachAction(domain:string,contact:Contact|null|undefined){const email=validEmail(contact?.email);if(!email||!contact)return null;const body=buildOutreachDraft(domain,contact);return{email,body,mailto:`mailto:${email}?${new URLSearchParams({subject:`Inquiry about ${domain}`,body})}`};}
