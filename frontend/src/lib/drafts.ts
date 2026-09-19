import { emailRecipient, recipientMailto } from '../../../packages/evidence/email-recipient.mts';

export interface Contact{name?:string|null;org?:string|null;email?:string|null;[key:string]:unknown}
export function buildOutreachDraft(domain:string,contact:Contact){const greeting=contact.name||contact.org||'there';return[`Hi ${greeting},`,'',`I came across ${domain} and wanted to ask whether you would be open to discussing a potential sale.`,'','Would you be willing to share an asking price, or are you open to receiving an offer?','','Best regards,'].join('\n');}
export function outreachAction(domain:string,contact:Contact|null|undefined){const email=emailRecipient(contact?.email);if(!email||!contact)return null;const body=buildOutreachDraft(domain,contact);const mailto=recipientMailto(email,{subject:`Inquiry about ${domain}`,body});return mailto?{email,body,mailto}:null;}
