import { CASE_RESPONSE_PACKET_SCHEMA } from '../packages/cases/case-response-packet.mts';
import { INVESTIGATION_CAPSULE_SCHEMA } from '../packages/investigation/investigation-capsule.mts';
import { LOOKUP_EVIDENCE_SCHEMA } from '../lib/evidence-export.mts';
import { validateCaseResponsePacket } from './artifact-validation/case-response.mts';
import { validateInvestigationCapsuleStructure } from './artifact-validation/investigation-capsule.mts';
import { validateLookupEvidenceArtifactStructure } from './artifact-validation/lookup-evidence.mts';
import { validateSignedDigestArtifactStructure } from './artifact-validation/signed-review.mts';
import { type UnknownRecord } from './artifact-validation/structure-primitives.mts';

export { validateInvestigationCapsuleStructure, validateLookupEvidenceArtifactStructure, validateSignedDigestArtifactStructure };

export function validateOfflineArtifactStructure(schema: string, value: UnknownRecord): void {
  if (schema === CASE_RESPONSE_PACKET_SCHEMA) validateCaseResponsePacket(value);
  else if (schema === INVESTIGATION_CAPSULE_SCHEMA) validateInvestigationCapsuleStructure(value);
  else if (schema === LOOKUP_EVIDENCE_SCHEMA) validateLookupEvidenceArtifactStructure(value);
  else validateSignedDigestArtifactStructure(schema, value);
}
