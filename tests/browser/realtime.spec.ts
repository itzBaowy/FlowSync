import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';
test('two users receive board and task updates, recover on reconnect and lose revoked access', async ({
  page,
  browser,
}) => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const context = await browser.newContext();
  const users: string[] = [];
  let organizationId: string | undefined;
  try {
    const suffix = randomUUID();
    const password = 'browser-realtime-password';
    const passwordHash = await hash(password);
    const owner = await prisma.user.create({
      data: { name: 'Realtime Owner', email: `rt-owner-${suffix}@example.com`, passwordHash },
    });
    const member = await prisma.user.create({
      data: { name: 'Realtime Member', email: `rt-member-${suffix}@example.com`, passwordHash },
    });
    users.push(owner.id, member.id);
    const org = await prisma.organization.create({
      data: {
        name: 'Realtime Team',
        slug: `realtime-${suffix}`,
        ownerId: owner.id,
        members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: member.id }] },
      },
    });
    organizationId = org.id;
    const workspace = await prisma.workspace.create({
      data: {
        organizationId,
        name: 'Live Studio',
        slug: 'live',
        members: { create: users.map((userId) => ({ userId })) },
      },
    });
    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        ownerId: owner.id,
        name: 'Live Release',
        members: { create: users.map((userId) => ({ userId })) },
      },
    });
    const board = await prisma.board.create({
      data: {
        projectId: project.id,
        name: 'Live Board',
        columns: {
          create: [
            { name: 'To do', kind: 'TODO', position: 0 },
            { name: 'Done', kind: 'DONE', position: 1 },
          ],
        },
      },
    });
    const memberPage = await context.newPage();
    for (const [target, email] of [
      [page, owner.email],
      [memberPage, member.email],
    ] as const) {
      await target.goto(`${process.env.WEB_URL}/login`);
      await target.getByLabel('Work email').fill(email);
      await target.getByLabel('Password').fill(password);
      await target.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(target).toHaveURL(/\/dashboard$/);
      await target.goto(`${process.env.WEB_URL}/boards?projectId=${project.id}&id=${board.id}`);
      await expect(target.getByLabel('Realtime status')).toHaveText('Live updates connected');
    }
    await expect(memberPage.getByText('Board settings', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByLabel('Task title', { exact: true }).fill('Live delivery');
    await page.getByRole('checkbox', { name: /Realtime Member/ }).check();
    await page.getByRole('button', { name: 'Create task now' }).click();
    const ownerPanel = page.getByRole('dialog', { name: 'Task details', exact: true });
    await expect(ownerPanel).toBeVisible();
    const memberCanvas = memberPage.getByLabel('Kanban columns', { exact: true });
    await expect(
      memberCanvas.getByRole('button', { name: 'Live delivery', exact: true }),
    ).toBeVisible();
    await memberCanvas.getByRole('button', { name: 'Live delivery', exact: true }).click();
    const memberPanel = memberPage.getByRole('dialog', { name: 'Task details', exact: true });
    await expect(memberPanel.getByLabel('Task title', { exact: true })).toBeEnabled();
    await ownerPanel.getByLabel('Task title', { exact: true }).fill('Live delivery updated');
    await ownerPanel.getByRole('button', { name: 'Save task', exact: true }).click();
    await expect(memberPanel.getByLabel('Task title', { exact: true })).toHaveValue(
      'Live delivery updated',
    );
    await ownerPanel.getByLabel('Move to column').selectOption({ label: 'Done' });
    await ownerPanel.getByRole('button', { name: 'Move task to end' }).click();
    await expect(memberPanel.getByText(/DONE \/ Version/)).toBeVisible();
    await ownerPanel.getByRole('button', { name: 'Close task', exact: true }).click();
    await memberPanel.getByRole('button', { name: 'Close task', exact: true }).click();
    await context.setOffline(true);
    await expect(memberPage.getByLabel('Realtime status')).toContainText('disconnected');
    await page
      .getByLabel('Kanban columns', { exact: true })
      .getByRole('button', { name: 'Live delivery updated', exact: true })
      .click();
    await ownerPanel.getByLabel('Task title', { exact: true }).fill('Changed while offline');
    await ownerPanel.getByRole('button', { name: 'Save task', exact: true }).click();
    await ownerPanel.getByRole('button', { name: 'Close task', exact: true }).click();
    await context.setOffline(false);
    await expect(memberPage.getByLabel('Realtime status')).toHaveText('Live updates connected');
    await expect(
      memberCanvas.getByRole('button', { name: 'Changed while offline', exact: true }),
    ).toBeVisible();
    await page.goto(`/projects?workspaceId=${workspace.id}&id=${project.id}`);
    await page
      .getByRole('article', { name: `Space member ${member.email}`, exact: true })
      .getByRole('button', { name: 'Remove from space', exact: true })
      .click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(memberPage.getByRole('main').getByRole('alert')).toContainText('not found');
    await expect(memberCanvas).toHaveCount(0);
  } finally {
    await context.close();
    if (organizationId) {
      const projects = { workspace: { organizationId } };
      await prisma.task.deleteMany({ where: { column: { board: { project: projects } } } });
      await prisma.column.deleteMany({ where: { board: { project: projects } } });
      await prisma.board.deleteMany({ where: { project: projects } });
      await prisma.project.deleteMany({ where: projects });
      await prisma.workspace.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
