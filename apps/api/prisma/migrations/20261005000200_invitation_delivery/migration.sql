CREATE TABLE "EmailOutbox" (
  "id" UUID NOT NULL,
  "invitationId" UUID NOT NULL,
  "encryptedPayload" TEXT,
  "enqueuedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailOutbox_invitationId_key" ON "EmailOutbox"("invitationId");
CREATE INDEX "EmailOutbox_deliveredAt_createdAt_idx" ON "EmailOutbox"("deliveredAt", "createdAt");
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Pending invitations must be unique; revoked/accepted/expired history is retained.
CREATE UNIQUE INDEX "Invitation_pending_email_key" ON "Invitation"("organizationId", "email") WHERE "status" = 'PENDING';
