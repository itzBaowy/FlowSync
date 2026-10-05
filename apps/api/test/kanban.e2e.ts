import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  activitySchema,
  commentSchema,
  attachmentSchema,
  attachmentDownloadSchema,
  boardSnapshotSchema,
  taskDetailSchema,
  taskSchema,
} from '@flowsync/contracts';
import { startTestApi } from './helpers/api-server';
config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const suffix = randomUUID();
const users: { id: string; token: string }[] = [];
let api: Awaited<ReturnType<typeof startTestApi>>;
let organizationId: string;
let workspaceId: string;
let projectId: string;
let boardId: string;
let columns: { id: string; kind: string }[];
async function request(path: string, actor = 0, method = 'GET', body?: unknown) {
  return fetch(`${api.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${users[actor]!.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  api = await startTestApi();
  for (const name of ['Owner', 'Member', 'Colleague', 'Outsider']) {
    const response = await fetch(`${api.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `kanban-${name}-${suffix}@example.com`,
        password: 'kanban-integration-password',
      }),
    });
    if (!response.ok) throw new Error('Could not register fixture');
    const { data } = await response.json();
    users.push({ id: data.user.id, token: data.accessToken });
  }
  const { data: org } = await (
    await request('/organizations', 0, 'POST', {
      name: 'Kanban fixtures',
      slug: `kanban-${suffix}`,
    })
  ).json();
  organizationId = org.id;
  const { data: workspace } = await (
    await request('/workspaces', 0, 'POST', { organizationId, name: 'Product', slug: 'product' })
  ).json();
  workspaceId = workspace.id;
  const { data: project } = await (
    await request('/projects', 0, 'POST', { workspaceId, name: 'Release' })
  ).json();
  projectId = project.id;
  for (const actor of [1, 2]) {
    await prisma.organizationMember.create({ data: { organizationId, userId: users[actor]!.id } });
    await request(`/workspaces/${workspaceId}/members`, 0, 'POST', { userId: users[actor]!.id });
    await request(`/projects/${projectId}/members`, 0, 'POST', { userId: users[actor]!.id });
  }
});
describe.sequential('Private task attachments and object cleanup', () => {
  let taskId: string;
  let attachmentId: string;
  let objectKey: string;
  const bytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  async function upload(actor: number, content = bytes, type = 'application/pdf') {
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(content)], { type }), 'release-notes.pdf');
    return fetch(`${api.baseUrl}/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${users[actor]!.token}` },
      body,
    });
  }
  it('uploads a private object and returns only public attachment metadata', async () => {
    const board = await prisma.board.create({
      data: { projectId, name: 'Files', columns: { create: { name: 'To do', position: 0 } } },
      include: { columns: true },
    });
    taskId = (
      await (
        await request('/tasks', 0, 'POST', {
          columnId: board.columns[0]!.id,
          title: 'File delivery',
        })
      ).json()
    ).data.id;
    const response = await upload(2);
    expect(response.status).toBe(201);
    const { data } = await response.json();
    const row = attachmentSchema.parse(data);
    attachmentId = row.id;
    expect(row).toMatchObject({
      filename: 'release-notes.pdf',
      mimeType: 'application/pdf',
      size: bytes.length,
      uploadedBy: { name: 'Colleague' },
      canDelete: true,
    });
    expect(data).not.toHaveProperty('objectKey');
    objectKey = (await prisma.attachment.findUniqueOrThrow({ where: { id: row.id } })).objectKey;
    expect(await prisma.objectCleanup.count({ where: { objectKey } })).toBe(0);
    const list = await (
      await request(`/tasks/${taskId}/attachments?search=release&limit=1`, 1)
    ).json();
    expect(list.meta.total).toBe(1);
    expect(list.data[0].canDelete).toBe(false);
    expect((await request(`/tasks/${taskId}/attachments`, 3)).status).toBe(404);
  });
  it('requires current scope for signed downloads and forces attachment disposition', async () => {
    const path = `/tasks/${taskId}/attachments/${attachmentId}/download`;
    expect((await request(path, 3)).status).toBe(404);
    const download = attachmentDownloadSchema.parse((await (await request(path, 1)).json()).data);
    expect(download.expiresIn).toBe(300);
    const content = await fetch(download.url);
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(bytes);
    expect(content.headers.get('content-disposition')).toContain('attachment;');
    expect(content.headers.get('content-type')).toBe('application/octet-stream');
    const unsigned = new URL(download.url);
    unsigned.search = '';
    expect((await fetch(unsigned)).status).toBe(403);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const other = await prisma.task.create({
      data: { columnId: task.columnId, title: 'Foreign file child', position: 9999 },
    });
    expect((await request(`/tasks/${other.id}/attachments/${attachmentId}/download`)).status).toBe(
      404,
    );
  });
  it('rejects invalid uploads, compensates failed metadata and removes files durably', async () => {
    expect((await upload(2, Buffer.from('<html>spoofed</html>'))).status).toBe(400);
    expect((await upload(2, Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload(3)).status).toBe(404);
    await prisma.task.update({ where: { id: taskId }, data: { archivedAt: new Date() } });
    expect((await upload(2)).status).toBe(409);
    const compensation = await prisma.objectCleanup.findFirstOrThrow({
      where: { objectKey: { startsWith: `tasks/${taskId}/attachments/`, not: objectKey } },
    });
    expect(compensation.completedAt).not.toBeNull();
    expect((await request(`/tasks/${taskId}`, 0, 'DELETE', { expectedVersion: 0 })).status).toBe(
      409,
    );
    expect(
      (await request(`/tasks/${taskId}/attachments/${attachmentId}`, 1, 'DELETE')).status,
    ).toBe(403);
    const download = attachmentDownloadSchema.parse(
      (await (await request(`/tasks/${taskId}/attachments/${attachmentId}/download`)).json()).data,
    );
    expect(
      (await request(`/tasks/${taskId}/attachments/${attachmentId}`, 2, 'DELETE')).status,
    ).toBe(200);
    expect(
      (await prisma.objectCleanup.findUniqueOrThrow({ where: { objectKey } })).completedAt,
    ).not.toBeNull();
    expect((await fetch(download.url)).status).toBe(404);
    expect(await prisma.attachment.count({ where: { taskId } })).toBe(0);
    await prisma.objectCleanup.deleteMany({
      where: { objectKey: { startsWith: `tasks/${taskId}/attachments/` } },
    });
  });
});
describe.sequential('Comments and private mentions', () => {
  let taskId: string;
  let commentId: string;
  it('lets an unassigned project member comment and deduplicates scoped mentions', async () => {
    const board = await prisma.board.create({
      data: {
        projectId,
        name: 'Conversation',
        columns: { create: { name: 'To do', position: 0 } },
      },
      include: { columns: true },
    });
    const response = await request('/tasks', 0, 'POST', {
      columnId: board.columns[0]!.id,
      title: 'Discuss delivery',
      assigneeIds: [users[1]!.id],
    });
    taskId = (await response.json()).data.id;
    const result = await request(`/tasks/${taskId}/comments`, 2, 'POST', {
      text: `@[Member](${users[1]!.id}) @Member please review`,
    });
    expect(result.status).toBe(201);
    const row = commentSchema.parse((await result.json()).data);
    commentId = row.id;
    expect(row).toMatchObject({
      version: 0,
      author: { name: 'Colleague' },
      canEdit: true,
      canDelete: true,
    });
    expect(row.mentions).toHaveLength(1);
    expect(
      await prisma.notification.count({ where: { taskId, userId: users[1]!.id, type: 'MENTION' } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { taskId, userId: users[1]!.id, type: 'TASK_COMMENT' },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: { taskId, userId: users[0]!.id, type: 'TASK_COMMENT' },
      }),
    ).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).version).toBe(0);
    const listing = await (
      await request(`/tasks/${taskId}/comments?search=review&limit=1`, 1)
    ).json();
    expect(listing.meta.total).toBe(1);
    expect(listing.data[0]).toMatchObject({ canEdit: false, canDelete: false });
    expect((await request(`/tasks/${taskId}/comments`, 3)).status).toBe(404);
  });
  it('rejects foreign mentions and forged author IDs without side effects', async () => {
    const before = await prisma.activity.count({ where: { taskId } });
    expect(
      (
        await request(`/tasks/${taskId}/comments`, 2, 'POST', {
          text: `@[Outsider](${users[3]!.id}) private`,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/tasks/${taskId}/comments`, 2, 'POST', {
          text: 'Hi',
          authorId: users[0]!.id,
        })
      ).status,
    ).toBe(400);
    expect((await request(`/tasks/${taskId}/comments`, 3, 'POST', { text: 'Hi' })).status).toBe(
      404,
    );
    expect(await prisma.comment.count({ where: { taskId } })).toBe(1);
    expect(await prisma.activity.count({ where: { taskId } })).toBe(before);
  });
  it('serializes author edits and does not notify unchanged mentions twice', async () => {
    const path = `/tasks/${taskId}/comments/${commentId}`;
    expect(
      (await request(path, 0, 'PATCH', { text: 'Manager editing', expectedVersion: 0 })).status,
    ).toBe(403);
    const edits = await Promise.all([
      request(path, 2, 'PATCH', { text: '@Member updated one', expectedVersion: 0 }),
      request(path, 2, 'PATCH', { text: '@Member updated two', expectedVersion: 0 }),
    ]);
    expect(edits.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: commentId } })).version).toBe(1);
    expect(
      await prisma.notification.count({ where: { taskId, userId: users[1]!.id, type: 'MENTION' } }),
    ).toBe(1);
    expect(
      (await request(path, 2, 'PATCH', { text: '@Owner new mention', expectedVersion: 1 })).status,
    ).toBe(200);
    expect(
      await prisma.notification.count({ where: { taskId, userId: users[0]!.id, type: 'MENTION' } }),
    ).toBe(1);
  });
  it('checks child IDs, permits moderation and blocks comments on archived tasks', async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const other = await prisma.task.create({
      data: { columnId: task.columnId, title: 'Other discussion', position: 9999 },
    });
    expect(
      (
        await request(`/tasks/${other.id}/comments/${commentId}`, 0, 'DELETE', {
          expectedVersion: 2,
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(`/tasks/${taskId}/comments/${commentId}`, 1, 'DELETE', { expectedVersion: 2 }))
        .status,
    ).toBe(403);
    expect(
      (await request(`/tasks/${taskId}/comments/${commentId}`, 0, 'DELETE', { expectedVersion: 1 }))
        .status,
    ).toBe(409);
    expect(
      (await request(`/tasks/${taskId}/comments/${commentId}`, 0, 'DELETE', { expectedVersion: 2 }))
        .status,
    ).toBe(200);
    expect(await prisma.mention.count({ where: { commentId } })).toBe(0);
    expect(await prisma.activity.count({ where: { taskId, action: 'COMMENT_DELETED' } })).toBe(1);
    await prisma.task.update({ where: { id: taskId }, data: { archivedAt: new Date() } });
    expect(
      (await request(`/tasks/${taskId}/comments`, 2, 'POST', { text: 'Archived' })).status,
    ).toBe(409);
    expect((await request(`/tasks/${taskId}/comments`, 1)).status).toBe(200);
  });
});
describe.sequential('Transactional project and task activity', () => {
  let taskId: string;
  let activityBoardId: string;
  it('records task creation with a public actor and scoped pagination', async () => {
    const board = await prisma.board.create({
      data: {
        projectId,
        name: 'Activity',
        columns: {
          create: [
            { name: 'Start', kind: 'TODO', position: 0 },
            { name: 'Finish', kind: 'DONE', position: 1 },
          ],
        },
      },
      include: { columns: { orderBy: { position: 'asc' } } },
    });
    activityBoardId = board.id;
    const response = await request('/tasks', 0, 'POST', {
      columnId: board.columns[0]!.id,
      title: 'Activity delivery',
    });
    expect(response.status).toBe(201);
    taskId = (await response.json()).data.id;
    const responseList = await request(`/tasks/${taskId}/activities?order=desc&limit=1`, 1);
    expect(responseList.status).toBe(200);
    const list = await responseList.json();
    expect(list.meta.total).toBe(1);
    const row = activitySchema.parse(list.data[0]);
    expect(row).toMatchObject({
      action: 'TASK_CREATED',
      taskId,
      projectId,
      actor: { name: 'Owner' },
      metadata: { title: 'Activity delivery' },
    });
    expect(list.data[0].actor).not.toHaveProperty('email');
    expect((await request(`/tasks/${taskId}/activities`, 3)).status).toBe(404);
    expect((await request(`/projects/${projectId}/activities`, 3)).status).toBe(404);
    expect((await request(`/projects/${projectId}/activities?taskId=${randomUUID()}`)).status).toBe(
      404,
    );
  });
  it('records status transitions and rolls history back with stale mutations', async () => {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { column: { include: { board: true } } },
    });
    const done = await prisma.column.findFirstOrThrow({
      where: { boardId: task.column.boardId, kind: 'DONE' },
    });
    const body = {
      columnId: done.id,
      beforeTaskId: null,
      expectedVersion: 0,
      expectedRevision: task.column.board.revision,
    };
    expect((await request(`/tasks/${taskId}/move`, 0, 'PATCH', body)).status).toBe(200);
    expect((await request(`/tasks/${taskId}/move`, 0, 'PATCH', body)).status).toBe(409);
    const list = await (await request(`/tasks/${taskId}/activities?order=desc`)).json();
    expect(list.meta.total).toBe(2);
    expect(list.data[0]).toMatchObject({
      action: 'TASK_MOVED',
      metadata: { fromStatus: 'TODO', toStatus: 'DONE' },
    });
  });
  it('retains deletion history on the project without dangling task references', async () => {
    expect((await request(`/tasks/${taskId}`, 0, 'DELETE', { expectedVersion: 1 })).status).toBe(
      200,
    );
    const rows = await prisma.activity.findMany({ where: { projectId, action: 'TASK_DELETED' } });
    expect(
      rows.some(
        (row) => row.taskId === null && (row.metadata as { taskId?: string })?.taskId === taskId,
      ),
    ).toBe(true);
    expect((await request(`/tasks/${taskId}/activities`)).status).toBe(404);
    await prisma.column.deleteMany({ where: { boardId: activityBoardId } });
    await prisma.board.delete({ where: { id: activityBoardId } });
    expect((await request(`/projects/${projectId}`, 0, 'DELETE')).status).toBe(409);
  });
});
afterAll(async () => {
  api?.stop();
  if (organizationId) {
    const projects = { workspace: { organizationId } };
    await prisma.activity.deleteMany({ where: { organizationId } });
    await prisma.task.deleteMany({ where: { column: { board: { project: projects } } } });
    await prisma.column.deleteMany({ where: { board: { project: projects } } });
    await prisma.board.deleteMany({ where: { project: projects } });
    await prisma.project.deleteMany({ where: projects });
    await prisma.workspace.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
});
describe.sequential('Kanban board boundaries and atomic ordering', () => {
  it('creates four default columns and protects management and private scope', async () => {
    const body = { projectId, name: 'Delivery' };
    expect((await request('/boards', 1, 'POST', body)).status).toBe(403);
    expect((await request('/boards', 3, 'POST', body)).status).toBe(404);
    const response = await request('/boards', 0, 'POST', body);
    expect(response.status).toBe(201);
    boardId = (await response.json()).data.id;
    const snapshot = boardSnapshotSchema.parse(
      (await (await request(`/boards/${boardId}`, 1)).json()).data,
    );
    columns = snapshot.columns;
    expect(columns.map((column) => column.kind)).toEqual(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
    expect(snapshot.canManage).toBe(false);
    expect((await request(`/boards/${boardId}`, 3)).status).toBe(404);
    expect((await request(`/boards/${boardId}`, 1, 'PATCH', { name: 'No' })).status).toBe(403);
    const list = await (
      await request(`/boards?projectId=${projectId}&search=Delivery&limit=1`)
    ).json();
    expect(list.meta.total).toBe(1);
    expect((await request('/boards?projectId=invalid')).status).toBe(400);
    const foreignColumn = await request('/tasks', 3, 'POST', {
      columnId: columns[0]!.id,
      title: 'No',
    });
    const missingColumn = await request('/tasks', 3, 'POST', {
      columnId: randomUUID(),
      title: 'No',
    });
    expect((await foreignColumn.json()).message).toBe((await missingColumn.json()).message);
    const docs = await (await fetch(`${api.baseUrl}/docs-json`)).json();
    const move =
      docs.paths['/api/tasks/{id}/move'].patch.requestBody.content['application/json'].schema;
    expect(move.required).toEqual(
      expect.arrayContaining(['columnId', 'expectedVersion', 'expectedRevision']),
    );
    expect(move.additionalProperties).toBe(false);
  });
  it('adds, edits and removes scoped columns without resetting their kind', async () => {
    expect(
      (await request(`/boards/${boardId}/columns`, 1, 'POST', { name: 'Blocked' })).status,
    ).toBe(403);
    const response = await request(`/boards/${boardId}/columns`, 0, 'POST', {
      name: 'Blocked',
      kind: 'REVIEW',
    });
    expect(response.status).toBe(201);
    const { data: column } = await response.json();
    const edited = await (
      await request(`/boards/${boardId}/columns/${column.id}`, 0, 'PATCH', { name: 'Waiting' })
    ).json();
    expect(edited.data.kind).toBe('REVIEW');
    expect(
      (await request(`/boards/${boardId}/columns/${randomUUID()}`, 0, 'PATCH', { name: 'No' }))
        .status,
    ).toBe(404);
    expect((await request(`/boards/${boardId}/columns/${column.id}`, 0, 'DELETE')).status).toBe(
      200,
    );
  });
  it('swaps positions atomically and rejects concurrent or malformed reorders', async () => {
    const snapshot = (await (await request(`/boards/${boardId}`)).json()).data;
    const ids = columns.map((column) => column.id).reverse();
    const body = { columnIds: ids, expectedRevision: snapshot.revision };
    const responses = await Promise.all([
      request(`/boards/${boardId}/columns/order`, 0, 'PATCH', body),
      request(`/boards/${boardId}/columns/order`, 0, 'PATCH', body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = boardSnapshotSchema.parse(
      (await (await request(`/boards/${boardId}`)).json()).data,
    );
    expect(saved.columns.map((column) => column.id)).toEqual(ids);
    expect(saved.columns.map((column) => column.position)).toEqual([0, 1, 2, 3]);
    expect(
      (
        await request(`/boards/${boardId}/columns/order`, 0, 'PATCH', {
          columnIds: ids.slice(1),
          expectedRevision: saved.revision,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/boards/${boardId}/columns/order`, 0, 'PATCH', {
          columnIds: [randomUUID(), ...ids.slice(1)],
          expectedRevision: saved.revision,
        })
      ).status,
    ).toBe(400);
    expect((await (await request(`/boards/${boardId}`)).json()).data.revision).toBe(saved.revision);
  });
  it('prevents deleting retained tasks, including archived tasks', async () => {
    const task = await prisma.task.create({
      data: { columnId: columns[0]!.id, title: 'Retained', position: 1024, archivedAt: new Date() },
    });
    expect(
      (await request(`/boards/${boardId}/columns/${columns[0]!.id}`, 0, 'DELETE')).status,
    ).toBe(409);
    expect((await request(`/boards/${boardId}`, 0, 'DELETE')).status).toBe(409);
    await prisma.task.delete({ where: { id: task.id } });
    const extra = await (
      await request('/boards', 0, 'POST', { projectId, name: 'Temporary' })
    ).json();
    expect((await request(`/boards/${extra.data.id}`, 0, 'DELETE')).status).toBe(200);
    expect((await request(`/boards/${extra.data.id}`)).status).toBe(404);
  });
});
let taskId: string;
async function currentTask() {
  return taskDetailSchema.parse((await (await request(`/tasks/${taskId}`, 1)).json()).data);
}
async function revision() {
  return (await (await request(`/boards/${boardId}`)).json()).data.revision as number;
}
describe.sequential('Task permissions, optimistic concurrency and ranking', () => {
  it('allows project members to create tasks and validates all referenced scopes', async () => {
    const input = {
      columnId: columns[0]!.id,
      title: 'Ship release',
      priority: 'HIGH',
      description: 'Careful rollout',
      dueDate: '2026-10-10T00:00:00.000Z',
      assigneeIds: [users[1]!.id],
    };
    expect((await request('/tasks', 3, 'POST', input)).status).toBe(404);
    expect((await request('/tasks', 1, 'POST', { ...input, position: 1 })).status).toBe(400);
    expect(
      (await request('/tasks', 1, 'POST', { ...input, assigneeIds: [users[3]!.id] })).status,
    ).toBe(400);
    const other = await prisma.project.create({
      data: { workspaceId, ownerId: users[0]!.id, name: 'Other private project' },
    });
    const foreignLabel = await prisma.label.create({
      data: { projectId: other.id, name: 'Foreign', color: '#123456' },
    });
    expect(
      (await request('/tasks', 1, 'POST', { ...input, labelIds: [foreignLabel.id] })).status,
    ).toBe(400);
    const response = await request('/tasks', 1, 'POST', input);
    expect(response.status).toBe(201);
    const task = taskSchema.parse((await response.json()).data);
    taskId = task.id;
    expect(task.canEdit).toBe(true);
    expect(task.version).toBe(0);
    expect(task.assignees.map((user) => user.id)).toEqual([users[1]!.id]);
    expect(JSON.stringify(task)).not.toContain('passwordHash');
    expect((await request(`/tasks/${taskId}`, 3)).status).toBe(404);
    const list = await (
      await request(
        `/tasks?boardId=${boardId}&priority=HIGH&assigneeId=${users[1]!.id}&search=rollout&limit=1`,
        2,
      )
    ).json();
    expect(list.meta.total).toBe(1);
    expect(list.data[0].canEdit).toBe(false);
  });
  it('protects edits and detects simultaneous writes without resetting unspecified fields', async () => {
    expect(
      (await request(`/tasks/${taskId}`, 2, 'PATCH', { title: 'No', expectedVersion: 0 })).status,
    ).toBe(403);
    const responses = await Promise.all([
      request(`/tasks/${taskId}`, 1, 'PATCH', { title: 'Release v2', expectedVersion: 0 }),
      request(`/tasks/${taskId}`, 1, 'PATCH', { title: 'Release v3', expectedVersion: 0 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const task = await currentTask();
    expect(task.version).toBe(1);
    expect(task.priority).toBe('HIGH');
    expect(task.dueDate).toBe('2026-10-10T00:00:00.000Z');
    expect(task.description).toBe('Careful rollout');
    expect(
      (
        await request(`/tasks/${taskId}`, 1, 'PATCH', {
          assigneeIds: [users[1]!.id, users[2]!.id],
          expectedVersion: task.version,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/tasks/${taskId}`, 2, 'PATCH', { priority: 'URGENT', expectedVersion: 2 }))
        .status,
    ).toBe(200);
    expect(
      (
        await request(`/tasks/${taskId}/archive`, 2, 'PATCH', {
          archived: true,
          expectedVersion: 3,
        })
      ).status,
    ).toBe(403);
  });
  it('moves across columns once for simultaneous clients and maintains relative order', async () => {
    const task = await currentTask();
    const destination = await prisma.task.create({
      data: { columnId: columns[1]!.id, title: 'Destination', position: 1024 },
    });
    const body = {
      columnId: columns[1]!.id,
      beforeTaskId: destination.id,
      expectedVersion: task.version,
      expectedRevision: await revision(),
    };
    const responses = await Promise.all([
      request(`/tasks/${taskId}/move`, 1, 'PATCH', body),
      request(`/tasks/${taskId}/move`, 2, 'PATCH', body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await currentTask();
    expect(saved.columnId).toBe(columns[1]!.id);
    expect(saved.status).toBe('IN_PROGRESS');
    const list = await (
      await request(`/tasks?boardId=${boardId}&columnId=${columns[1]!.id}`)
    ).json();
    expect(list.data.map((row: { id: string }) => row.id)).toEqual([taskId, destination.id]);
    const foreignBoard = await prisma.board.create({
      data: {
        projectId,
        name: 'Another board',
        columns: { create: { name: 'Other', position: 0 } },
      },
      include: { columns: true },
    });
    expect(
      (
        await request(`/tasks/${taskId}/move`, 1, 'PATCH', {
          ...body,
          expectedVersion: saved.version,
          expectedRevision: await revision(),
          columnId: foreignBoard.columns[0]!.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/tasks/${taskId}/move`, 1, 'PATCH', {
          ...body,
          expectedVersion: saved.version,
          expectedRevision: await revision(),
          beforeTaskId: taskId,
        })
      ).status,
    ).toBe(400);
    await prisma.task.delete({ where: { id: destination.id } });
  });
  it('rebalances exhausted fractional gaps while retaining archived task positions', async () => {
    const first = await prisma.task.create({
      data: {
        columnId: columns[2]!.id,
        title: 'Archived rank',
        position: '0.0000000001',
        archivedAt: new Date(),
      },
    });
    const next = await prisma.task.create({
      data: { columnId: columns[2]!.id, title: 'Tiny gap', position: '0.0000000002' },
    });
    const task = await currentTask();
    const response = await request(`/tasks/${taskId}/move`, 1, 'PATCH', {
      columnId: columns[2]!.id,
      beforeTaskId: next.id,
      expectedVersion: task.version,
      expectedRevision: await revision(),
    });
    expect(response.status).toBe(200);
    const rows = await prisma.task.findMany({
      where: { columnId: columns[2]!.id },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((row) => row.id)).toEqual([first.id, taskId, next.id]);
    expect(new Set(rows.map((row) => row.position.toString())).size).toBe(3);
    const snapshot = boardSnapshotSchema.parse(
      (await (await request(`/boards/${boardId}`)).json()).data,
    );
    expect(snapshot.columns.find((column) => column.id === columns[2]!.id)!.totalTasks).toBe(2);
    await prisma.task.deleteMany({ where: { id: { in: [first.id, next.id] } } });
  });
  it('archives, restores and deletes with version checks and scope permissions', async () => {
    let task = await currentTask();
    expect(
      (
        await request(`/tasks/${taskId}/archive`, 1, 'PATCH', {
          archived: true,
          expectedVersion: task.version,
        })
      ).status,
    ).toBe(200);
    task = await currentTask();
    expect(task.archivedAt).not.toBeNull();
    expect(
      (
        await request(`/tasks/${taskId}`, 1, 'PATCH', {
          title: 'No',
          expectedVersion: task.version,
        })
      ).status,
    ).toBe(409);
    const list = await (await request(`/tasks?boardId=${boardId}&archived=true`)).json();
    expect(list.meta.total).toBe(1);
    expect(
      (
        await request(`/tasks/${taskId}/archive`, 0, 'PATCH', {
          archived: false,
          expectedVersion: task.version,
        })
      ).status,
    ).toBe(200);
    task = await currentTask();
    expect(
      (await request(`/tasks/${taskId}`, 2, 'DELETE', { expectedVersion: task.version })).status,
    ).toBe(403);
    expect(
      (await request(`/tasks/${taskId}`, 1, 'DELETE', { expectedVersion: task.version - 1 }))
        .status,
    ).toBe(409);
    expect(
      (await request(`/tasks/${taskId}`, 1, 'DELETE', { expectedVersion: task.version })).status,
    ).toBe(200);
    expect((await request(`/tasks/${taskId}`, 1)).status).toBe(404);
  });
});
describe.sequential('Project labels and versioned task checklists', () => {
  it('scopes label management and assigns multiple labels atomically', async () => {
    const path = `/projects/${projectId}/labels`;
    expect((await request(path, 1, 'POST', { name: 'Bug', color: '#AABBCC' })).status).toBe(403);
    expect((await request(path, 3)).status).toBe(404);
    expect((await request(path, 0, 'POST', { name: 'Bad', color: 'red' })).status).toBe(400);
    const label = (await (await request(path, 0, 'POST', { name: 'Bug', color: '#AABBCC' })).json())
      .data;
    expect(label.color).toBe('#aabbcc');
    expect((await request(path, 0, 'POST', { name: 'Bug', color: '#112233' })).status).toBe(409);
    const task = (
      await (
        await request('/tasks', 1, 'POST', {
          columnId: columns[0]!.id,
          title: 'Checklist task',
          assigneeIds: [users[1]!.id, users[2]!.id],
          labelIds: [label.id],
        })
      ).json()
    ).data;
    taskId = task.id;
    expect(task.labels[0].name).toBe('Bug');
    expect(
      (await request(`${path}/${label.id}`, 0, 'PATCH', { name: 'Issue', color: '#123456' }))
        .status,
    ).toBe(200);
    expect((await currentTask()).labels[0]!.name).toBe('Issue');
    expect((await request(`${path}/${label.id}`, 0, 'DELETE')).status).toBe(200);
    expect((await currentTask()).labels).toHaveLength(0);
    expect((await request(`${path}/${label.id}`, 0, 'DELETE')).status).toBe(404);
  });
  it('increments task versions for checklist changes and rejects foreign child IDs', async () => {
    const path = `/tasks/${taskId}/checklists`;
    expect((await request(path, 3, 'POST', { title: 'Ship', expectedVersion: 0 })).status).toBe(
      404,
    );
    const added = await request(path, 1, 'POST', { title: 'Ship', expectedVersion: 0 });
    expect(added.status).toBe(201);
    const task = taskDetailSchema.parse((await added.json()).data);
    const checklist = task.checklists[0]!;
    expect(task.version).toBe(1);
    expect(
      (
        await request(`${path}/${checklist.id}/items`, 2, 'POST', {
          text: 'Review',
          expectedVersion: 0,
        })
      ).status,
    ).toBe(409);
    const itemResponse = await request(`${path}/${checklist.id}/items`, 2, 'POST', {
      text: 'Review',
      expectedVersion: 1,
    });
    expect(itemResponse.status).toBe(201);
    const saved = taskDetailSchema.parse((await itemResponse.json()).data);
    const item = saved.checklists[0]!.items[0]!;
    const foreign = await prisma.task.create({
      data: {
        columnId: columns[0]!.id,
        title: 'Foreign child',
        position: 2048,
        checklists: {
          create: {
            title: 'Other',
            position: 0,
            items: { create: { text: 'Other', position: 0 } },
          },
        },
      },
      include: { checklists: { include: { items: true } } },
    });
    expect(
      (
        await request(
          `/tasks/${taskId}/checklist-items/${foreign.checklists[0]!.items[0]!.id}`,
          1,
          'PATCH',
          { completed: true, expectedVersion: 2 },
        )
      ).status,
    ).toBe(404);
    expect((await currentTask()).version).toBe(2);
    expect(
      (
        await request(`/tasks/${taskId}/checklist-items/${item.id}`, 2, 'PATCH', {
          completed: true,
          expectedVersion: 2,
        })
      ).status,
    ).toBe(200);
    expect((await currentTask()).checklists[0]!.items[0]!.completed).toBe(true);
    expect(
      (
        await request(`/tasks/${taskId}/checklist-items/${item.id}`, 1, 'DELETE', {
          expectedVersion: 3,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`${path}/${checklist.id}`, 1, 'DELETE', { expectedVersion: 4 })).status,
    ).toBe(200);
    expect((await currentTask()).checklists).toHaveLength(0);
    await prisma.task.delete({ where: { id: foreign.id } });
  });
});
