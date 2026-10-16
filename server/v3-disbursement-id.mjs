import { createHash } from 'node:crypto';

export const v3DisbursementId = (kind, settlementSignature) => createHash('sha256')
  .update(`funded.v3.${kind}-funding.v1:${settlementSignature}`).digest();
