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
