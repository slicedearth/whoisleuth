import { MESSAGE_INTAKE_KINDS, MAX_MESSAGE_INTAKE_BYTES, type MessageIntakeKind, type MessageIntakeResult } from '../../../packages/contracts/message-intake.mts';
import { reviewMessageInput } from '../../../packages/investigation/message-intake.mts';
import { reviewQrInput } from '../../../packages/investigation/qr-intake.mts';

export type MessageIntakeRequest = Readonly<{ kind: MessageIntakeKind; file: Blob; reviewedAt: string }>;
export type MessageIntakeResponse = Readonly<{ kind: 'review'; result: MessageIntakeResult }> | Readonly<{ kind: 'error' }>;

export async function runMessageIntakeOperation(request: MessageIntakeRequest): Promise<MessageIntakeResponse> {
  let bytes: Uint8Array | null = null;
  try {
    if (!request || !MESSAGE_INTAKE_KINDS.includes(request.kind) || !(request.file instanceof Blob) || request.file.size < 1 || request.file.size > MAX_MESSAGE_INTAKE_BYTES) return { kind: 'error' };
    bytes = new Uint8Array(await request.file.arrayBuffer());
    const result = request.kind === 'qr' ? await reviewQrInput(bytes, request.reviewedAt) : await reviewMessageInput(bytes, request.kind, request.reviewedAt);
    return { kind: 'review', result };
  } catch { return { kind: 'error' }; }
  finally { bytes?.fill(0); }
}
