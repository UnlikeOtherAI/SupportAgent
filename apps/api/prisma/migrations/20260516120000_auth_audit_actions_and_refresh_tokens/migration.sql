-- Drafted (not applied) by the auth/sso/uoa security hardening pass.
-- Apply with `pnpm -F api prisma migrate deploy` once reviewed.

-- 1. Extend AuditAction with SSO / identity lifecycle actions.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'login_succeeded';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'login_failed';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'identity_attached';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'tenant_changed';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'account_created';

-- 2. Persist federated identity refresh tokens.
-- `ciphertext` will hold AEAD ciphertext once the secrets-encryption sibling
-- ships the shared cipher primitive. Today writes land unencrypted with a
-- TODO inside `auth-callback.ts`.
CREATE TABLE IF NOT EXISTS "federated_identity_refresh_tokens" (
    "id" TEXT NOT NULL,
    "federatedIdentityLinkId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "federated_identity_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "federated_identity_refresh_tokens_federatedIdentityLinkId_idx"
ON "federated_identity_refresh_tokens"("federatedIdentityLinkId");

ALTER TABLE "federated_identity_refresh_tokens"
ADD CONSTRAINT "federated_identity_refresh_tokens_federatedIdentityLinkId_fkey"
FOREIGN KEY ("federatedIdentityLinkId") REFERENCES "federated_identity_links"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
