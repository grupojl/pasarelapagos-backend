// src/common/types/express.d.ts
// Extiende el tipo Request de Express para los campos que inyectamos
// en FirebaseAuthGuard y TenantGuard. Sin esto TypeScript emite TS2352.
import type { DecodedIdToken } from 'firebase-admin/auth';

declare global {
  namespace Express {
    interface Request {
      firebaseUser?: DecodedIdToken;
      user?: {
        uid:                string;
        email:              string;
        productPermissions: Record<string, { canRead: boolean; canWrite: boolean }>;
        organizations:      string[];
      };
      organizationId?: string;
      tenantContext?: {
        organizationId: string;
        userId:         string;
        canRead:        boolean;
        canWrite:       boolean;
      };
    }
  }
}

export {};
