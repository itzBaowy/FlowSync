CREATE TABLE "ObjectCleanup" (
  "id" UUID NOT NULL,
  "objectKey" TEXT NOT NULL,
  "environment" VARCHAR(20) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "lastError" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectCleanup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ObjectCleanup_objectKey_key" ON "ObjectCleanup"("objectKey");
CREATE INDEX "ObjectCleanup_environment_completedAt_nextAttemptAt_idx" ON "ObjectCleanup"("environment", "completedAt", "nextAttemptAt");
