CREATE TYPE "AIRequestKind" AS ENUM ('SUMMARY', 'OVERDUE', 'MEETING_NOTES');
CREATE TYPE "AIRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TABLE "AIRun" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "environment" VARCHAR(20) NOT NULL,
  "kind" "AIRequestKind" NOT NULL,
  "status" "AIRunStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseId" UUID,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "output" JSONB,
  "lastError" VARCHAR(80),
  "confirmedAt" TIMESTAMP(3),
  "confirmedTaskIds" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AIRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AIRun_conversationId_key" ON "AIRun"("conversationId");
CREATE INDEX "AIRun_environment_status_createdAt_idx" ON "AIRun"("environment", "status", "createdAt");
