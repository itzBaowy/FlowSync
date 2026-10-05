import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';
test('two users receive board and task updates, recover on reconnect and lose revoked access', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
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
    await expect(page.getByLabel('Online board members')).toContainText('2 online');
    await expect(page.getByLabel('Online board members')).toContainText('Realtime Member');
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
    await expect(
      memberPage.getByRole('button', { name: 'Notifications (1 unread)', exact: true }),
    ).toBeVisible();
    await memberPage.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click();
    const inbox = memberPage.getByRole('dialog', { name: 'Notifications', exact: true });
    await expect(inbox).toContainText('assigned you to "Live delivery"');
    await inbox.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(
      memberPage.getByRole('button', { name: 'Notifications (0 unread)', exact: true }),
    ).toBeVisible();
    await inbox.getByRole('button', { name: 'Mark unread', exact: true }).click();
    await expect(
      memberPage.getByRole('button', { name: 'Notifications (1 unread)', exact: true }),
    ).toBeVisible();
    await inbox.getByRole('link', { name: 'Open task', exact: true }).click();
    await expect(memberPage).toHaveURL(/taskId=/);
    const memberPanel = memberPage.getByRole('dialog', { name: 'Task details', exact: true });
    await expect(memberPanel.getByLabel('Task title', { exact: true })).toBeEnabled();
    const memberComments = memberPanel.getByRole('region', { name: 'Task comments', exact: true });
    await memberComments
      .getByLabel('Comment text', { exact: true })
      .fill('Please review this release');
    await memberComments.getByRole('button', { name: 'Mention a member', exact: true }).click();
    await memberComments
      .getByRole('button', { name: 'Mention Realtime Owner', exact: true })
      .click();
    await memberComments.getByRole('button', { name: 'Post comment', exact: true }).click();
    const ownerComments = ownerPanel.getByRole('region', { name: 'Task comments', exact: true });
    await expect(ownerComments).toContainText('Please review this release');
    await expect(ownerComments).toContainText('@Realtime Owner');
    const reply = memberComments.getByRole('article', {
      name: 'Comment by Realtime Member',
      exact: true,
    });
    await reply.getByRole('button', { name: 'Edit comment', exact: true }).click();
    await reply.getByLabel('Edit comment text').fill('Revised release feedback');
    await reply.getByRole('button', { name: 'Save comment', exact: true }).click();
    await expect(ownerComments).toContainText('Revised release feedback');
    await expect(
      ownerPanel.getByRole('region', { name: 'Task activity', exact: true }),
    ).toContainText('comment updated');
    await ownerComments.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(reply).toHaveCount(0);
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
    await expect(
      page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Notifications', exact: true })).toContainText(
      'mentioned you in "Live delivery"',
    );
    await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
    await context.setOffline(true);
    await expect(memberPage.getByLabel('Realtime status')).toContainText('disconnected');
    await expect(page.getByLabel('Online board members')).toContainText('1 online', {
      timeout: 20000,
    });
    await page
      .getByLabel('Kanban columns', { exact: true })
      .getByRole('button', { name: 'Live delivery updated', exact: true })
      .click();
    await ownerPanel.getByLabel('Task title', { exact: true }).fill('Changed while offline');
    await ownerPanel.getByRole('button', { name: 'Save task', exact: true }).click();
    await ownerPanel.getByRole('button', { name: 'Close task', exact: true }).click();
    await context.setOffline(false);
    await expect(memberPage.getByLabel('Realtime status')).toHaveText('Live updates connected');
    await expect(page.getByLabel('Online board members')).toContainText('2 online');
    await expect(
      memberCanvas.getByRole('button', { name: 'Changed while offline', exact: true }),
    ).toBeVisible();
    await memberPage.getByRole('button', { name: /Notifications \(/ }).click();
    await inbox.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await expect(
      memberPage.getByRole('button', { name: 'Notifications (0 unread)', exact: true }),
    ).toBeVisible();
    await memberPage.goto('/dashboard');
    const refreshedTask = page.waitForResponse(
      (response) =>
        /\/api\/tasks\/[0-9a-f-]+$/.test(response.url()) && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Changed while offline', exact: true }).click();
    await refreshedTask;
    await expect(ownerPanel.getByLabel('Task title', { exact: true })).toHaveValue(
      'Changed while offline',
    );
    await ownerPanel.getByLabel('Task title', { exact: true }).fill('Dashboard delivery');
    await ownerPanel.getByRole('button', { name: 'Save task', exact: true }).click();
    await expect(ownerPanel.getByLabel('Task title', { exact: true })).toHaveValue(
      'Dashboard delivery',
    );
    await expect(
      memberPage.getByRole('button', { name: 'Notifications (1 unread)', exact: true }),
    ).toBeVisible();
    await memberPage.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click();
    await expect(inbox).toContainText('updated "Dashboard delivery"');
    await inbox.getByRole('link', { name: 'Open task', exact: true }).first().click();
    await expect(memberPanel.getByLabel('Task title', { exact: true })).toHaveValue(
      'Dashboard delivery',
    );
    await memberPanel.getByRole('button', { name: 'Close task', exact: true }).click();
    await expect(memberPage).not.toHaveURL(/taskId=/);
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
      await prisma.activity.deleteMany({ where: { organizationId } });
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
