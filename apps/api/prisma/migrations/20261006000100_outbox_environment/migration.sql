ALTER TABLE "EmailOutbox" ADD COLUMN "environment" VARCHAR(16) NOT NULL DEFAULT 'development';
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_environment_check" CHECK ("environment" IN ('development', 'test', 'production'));
CREATE INDEX "EmailOutbox_environment_deliveredAt_createdAt_idx" ON "EmailOutbox"("environment", "deliveredAt", "createdAt");
