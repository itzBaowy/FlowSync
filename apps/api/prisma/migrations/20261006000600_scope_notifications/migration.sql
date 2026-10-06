ALTER TABLE "Notification" ADD COLUMN "projectId" UUID, ADD COLUMN "workspaceId" UUID;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");
CREATE INDEX "Notification_workspaceId_idx" ON "Notification"("workspaceId");
