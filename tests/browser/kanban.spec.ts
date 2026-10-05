import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';
test('board creation and scoped column management', async ({ page }) => {
  const suffix = randomUUID();
  const email = `kanban-browser-${suffix}@example.com`;
  const password = 'browser-kanban-password';
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let organizationId: string | undefined;
  let userId: string | undefined;
  try {
    const user = await prisma.user.create({
      data: { name: 'Board Owner', email, passwordHash: await hash(password) },
    });
    userId = user.id;
    const org = await prisma.organization.create({
      data: {
        name: 'Delivery Team',
        slug: `board-${suffix}`,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    organizationId = org.id;
    const workspace = await prisma.workspace.create({
      data: {
        organizationId,
        name: 'Product',
        slug: 'product',
        members: { create: { userId: user.id } },
      },
    });
    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        ownerId: user.id,
        name: 'Release',
        members: { create: { userId: user.id } },
      },
    });
    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    await page.goto(`/projects?workspaceId=${workspace.id}&id=${project.id}`);
    await page.getByRole('link', { name: 'Open boards' }).click();
    await page.getByRole('button', { name: 'Create board', exact: true }).click();
    await page.getByLabel('Board name', { exact: true }).fill('Launch Board');
    await page.getByRole('button', { name: 'Create board now' }).click();
    await expect(page.getByRole('heading', { name: 'Launch Board', exact: true })).toBeVisible();
    const canvas = page.getByLabel('Kanban columns', { exact: true });
    await expect(canvas.getByRole('heading', { name: 'To do 0' })).toBeVisible();
    await page.getByText('Board settings', { exact: true }).click();
    await page.getByLabel('New column name').fill('Blocked');
    await page.getByLabel('New column status').selectOption('REVIEW');
    await page.getByRole('button', { name: 'Add column', exact: true }).click();
    await expect(canvas.getByRole('heading', { name: 'Blocked 0' })).toBeVisible();
    await page.getByRole('button', { name: 'Move Blocked left', exact: true }).click();
    await expect
      .poll(async () => (await canvas.getByRole('heading').allTextContents()).slice(-2))
      .toEqual(['Blocked 0', 'Done 0']);
    await page.reload();
    await expect(canvas.getByRole('heading', { name: 'Blocked 0' })).toBeVisible();
    await page.getByText('Project labels', { exact: true }).click();
    await page.getByLabel('New label name').fill('Bug');
    await page.getByLabel('New label color').fill('#dc2626');
    await page.getByRole('button', { name: 'Add label', exact: true }).click();
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByLabel('Task title', { exact: true }).fill('Fix launch checklist');
    await page.getByLabel('Task description').fill('Review the rollout plan.');
    await page.getByLabel('Task priority', { exact: true }).selectOption('HIGH');
    await page.getByLabel('Task due date').fill('2026-10-20');
    await page.getByRole('checkbox', { name: /Board Owner/ }).check();
    await page.getByRole('checkbox', { name: 'Bug', exact: true }).check();
    await page.getByRole('button', { name: 'Create task now' }).click();
    const panel = page.getByRole('dialog', { name: 'Task details', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Task title', { exact: true })).toHaveValue(
      'Fix launch checklist',
    );
    await panel.getByLabel('New checklist title').fill('Release checks');
    await panel.getByRole('button', { name: 'Add checklist', exact: true }).click();
    await panel.getByLabel('New item in Release checks').fill('Review API');
    await panel.getByRole('button', { name: 'Add item', exact: true }).click();
    await panel.getByRole('checkbox', { name: 'Review API', exact: true }).check();
    await expect(panel.getByText('1 / 1 completed')).toBeVisible();
    await panel.getByLabel('Move to column').selectOption({ label: 'In progress' });
    await panel.getByRole('button', { name: 'Move task to end' }).click();
    await expect(panel.getByText(/IN_PROGRESS \/ Version/)).toBeVisible();
    await panel.getByRole('button', { name: 'Close task', exact: true }).click();
    await expect(canvas.getByRole('heading', { name: 'In progress 1' })).toBeVisible();
    await page.reload();
    await canvas.getByRole('button', { name: /Fix launch checklist/ }).click();
    await expect(panel.getByRole('checkbox', { name: 'Review API', exact: true })).toBeChecked();
    await expect(panel.getByLabel('Task due date')).toHaveValue('2026-10-20');
    await panel.getByRole('button', { name: 'Archive task', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Restore task', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Close task', exact: true }).click();
    await expect(canvas.getByRole('heading', { name: 'In progress 0' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Archived tasks', exact: true }).check();
    await page
      .getByLabel('Task results', { exact: true })
      .getByRole('button', { name: /Fix launch checklist/ })
      .click();
    await panel.getByRole('button', { name: 'Restore task', exact: true }).click();
    await panel.getByRole('button', { name: 'Close task', exact: true }).click();
    await page.getByRole('button', { name: 'Back to board', exact: true }).click();
    await expect(canvas.getByRole('heading', { name: 'In progress 1' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  } finally {
    if (organizationId) {
      const projects = { workspace: { organizationId } };
      await prisma.task.deleteMany({ where: { column: { board: { project: projects } } } });
      await prisma.column.deleteMany({ where: { board: { project: projects } } });
      await prisma.board.deleteMany({ where: { project: projects } });
      await prisma.project.deleteMany({ where: projects });
      await prisma.workspace.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
