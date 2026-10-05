CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'FAILED');
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" VARCHAR(200);
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE TABLE "NotificationDelivery" (
  "notificationId" UUID NOT NULL,
  "environment" VARCHAR(20) NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "enqueuedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lastError" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("notificationId"),
  CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NotificationDelivery_environment_status_createdAt_idx" ON "NotificationDelivery"("environment", "status", "createdAt");
CREATE TABLE "DueReminder" (
  "id" UUID NOT NULL,
  "taskId" UUID NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "runAt" TIMESTAMP(3) NOT NULL,
  "environment" VARCHAR(20) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DueReminder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DueReminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DueReminder_taskId_key" ON "DueReminder"("taskId");
CREATE INDEX "DueReminder_environment_status_runAt_idx" ON "DueReminder"("environment", "status", "runAt");
