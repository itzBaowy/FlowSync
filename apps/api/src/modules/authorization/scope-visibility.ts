import type { Prisma } from '../../generated/prisma/client';
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
