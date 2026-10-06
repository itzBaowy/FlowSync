import type { Prisma } from '../../generated/prisma/client';
export function visibleWorkspaces(userId: string): Prisma.WorkspaceWhereInput {
  return {
    organization: { members: { some: { userId } } },
    OR: [
      { organization: { members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } } } },
      { members: { some: { userId } } },
    ],
  };
}
export function visibleProjects(userId: string): Prisma.ProjectWhereInput {
  return {
    workspace: { organization: { members: { some: { userId } } } },
    OR: [
      {
        workspace: {
          organization: { members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } } },
        },
      },
      { members: { some: { userId } }, workspace: { members: { some: { userId } } } },
    ],
  };
}
export function visibleTasks(userId: string): Prisma.TaskWhereInput {
  return { column: { board: { project: visibleProjects(userId) } } };
}
export function visibleNotifications(userId: string): Prisma.NotificationWhereInput {
  return {
    userId,
    OR: [
      { task: { is: visibleTasks(userId) } },
      { type: 'PROJECT_INVITE', project: { is: visibleProjects(userId) } },
      { type: 'WORKSPACE_INVITE', workspace: { is: visibleWorkspaces(userId) } },
    ],
  };
}
