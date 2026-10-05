import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';
test('workspace and project CRUD, date validation, overview and responsive layout', async ({
  page,
}) => {
  const suffix = randomUUID();
  const email = `scope-browser-${suffix}@example.com`;
  const password = 'browser-scope-password';
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let orgId: string | undefined;
  try {
    const user = await prisma.user.create({
      data: { name: 'Scope Owner', email, passwordHash: await hash(password) },
    });
    const org = await prisma.organization.create({
      data: {
        name: 'Product Team',
        slug: `scopes-${suffix}`,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    orgId = org.id;
    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    await page.goto(`/organizations?id=${org.id}`);
    await page.getByRole('link', { name: 'Open workspaces', exact: true }).click();
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByLabel('Workspace name', { exact: true }).fill('Product Studio');
    await page.getByLabel('Workspace slug', { exact: true }).fill('product');
    await page
      .getByLabel('Workspace description', { exact: true })
      .fill('A focused home for delivery');
    await page.getByLabel('Workspace icon', { exact: true }).fill('P');
    await page.getByRole('button', { name: 'Create workspace now' }).click();
    await expect(page.getByRole('heading', { name: 'Product Studio', exact: true })).toBeVisible();
    await page.getByLabel('Workspace name', { exact: true }).fill('Product Studio Updated');
    await page.getByRole('button', { name: 'Save workspace' }).click();
    await expect(
      page.getByRole('heading', { name: 'Product Studio Updated', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/workspaces.png', fullPage: true });
    await page.getByRole('link', { name: 'Open projects', exact: true }).click();
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Launch Plan');
    await page.getByLabel('Project description', { exact: true }).fill('Ship the release');
    await page.getByLabel('Project status').selectOption('ACTIVE');
    await page.getByLabel('Start date').fill('2026-10-06');
    await page.getByLabel('Due date').fill('2026-10-05');
    await page.getByRole('button', { name: 'Create project now' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Start date must be on or before due date',
    );
    await page.getByLabel('Due date').fill('2026-10-20');
    await page.getByRole('button', { name: 'Create project now' }).click();
    await expect(page.getByRole('heading', { name: 'Launch Plan', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible();
    await expect(page.getByText('No activity recorded yet.')).toBeVisible();
    await page.getByLabel('Project status').selectOption('ON_HOLD');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.reload();
    await expect(page.getByLabel('Project status')).toHaveValue('ON_HOLD');
    await expect(page.getByLabel('Start date')).toHaveValue('2026-10-06');
    await page.screenshot({ path: 'docs/screenshots/projects.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: 'docs/screenshots/projects-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Delete project' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('No projects found.', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Product Studio Updated', exact: true }).click();
    await page.getByRole('button', { name: 'Delete workspace' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('No workspaces found.', { exact: false })).toBeVisible();
  } finally {
    if (orgId) {
      await prisma.project.deleteMany({ where: { workspace: { organizationId: orgId } } });
      await prisma.workspace.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});

test('workspace and project membership gates, ownership transfer and access revocation', async ({
  page,
  browser,
}) => {
  const suffix = randomUUID();
  const emails = [`scope-owner-${suffix}@example.com`, `scope-member-${suffix}@example.com`];
  const password = 'browser-membership-scope-password';
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const context = await browser.newContext();
  let orgId: string | undefined;
  try {
    const passwordHash = await hash(password);
    const owner = await prisma.user.create({
      data: { name: 'Owner', email: emails[0]!, passwordHash },
    });
    const member = await prisma.user.create({
      data: { name: 'Member', email: emails[1]!, passwordHash },
    });
    const org = await prisma.organization.create({
      data: {
        name: 'Scoped Team',
        slug: `scope-members-${suffix}`,
        ownerId: owner.id,
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    });
    orgId = org.id;
    const workspace = await prisma.workspace.create({
      data: {
        organizationId: org.id,
        name: 'Private Studio',
        slug: 'private',
        members: { create: { userId: owner.id } },
      },
    });
    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        name: 'Private Release',
        ownerId: owner.id,
        members: { create: { userId: owner.id } },
      },
    });
    await page.goto('/login');
    await page.getByLabel('Work email').fill(emails[0]!);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    await page.goto(`/workspaces?organizationId=${org.id}&id=${workspace.id}`);
    await page.getByLabel('Find eligible people').fill(emails[1]!);
    await page
      .getByRole('article', { name: `Eligible person ${emails[1]}`, exact: true })
      .getByRole('button', { name: 'Add to space' })
      .click();
    await expect(
      page.getByRole('article', { name: `Space member ${emails[1]}`, exact: true }),
    ).toBeVisible();
    const memberPage = await context.newPage();
    await memberPage.goto(`${process.env.WEB_URL}/login`);
    await memberPage.getByLabel('Work email').fill(emails[1]!);
    await memberPage.getByLabel('Password').fill(password);
    await memberPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(memberPage).toHaveURL(/\/dashboard$/);
    await memberPage.goto(
      `${process.env.WEB_URL}/workspaces?organizationId=${org.id}&id=${workspace.id}`,
    );
    await expect(memberPage.getByLabel('Workspace name')).toBeDisabled();
    await memberPage.getByRole('link', { name: 'Open projects' }).click();
    await expect(memberPage.getByText('No projects found.', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Open projects' }).click();
    await page.getByRole('link', { name: 'Private Release', exact: false }).click();
    await page.getByLabel('Find eligible people').fill(emails[1]!);
    await page
      .getByRole('article', { name: `Eligible person ${emails[1]}`, exact: true })
      .getByRole('button', { name: 'Add to space' })
      .click();
    await memberPage.reload();
    await memberPage.getByRole('link', { name: 'Private Release', exact: false }).click();
    await expect(memberPage.getByLabel('Project name')).toBeDisabled();
    await page
      .getByRole('article', { name: `Space member ${emails[1]}`, exact: true })
      .getByRole('button', { name: 'Make project owner' })
      .click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(
      page
        .getByRole('article', { name: `Space member ${emails[1]}`, exact: true })
        .getByText('Owner', { exact: true }),
    ).toBeVisible();
    await memberPage.reload();
    await expect(memberPage.getByLabel('Project name')).toBeEnabled();
    await expect(
      memberPage.getByRole('button', { name: 'Create project', exact: true }),
    ).toHaveCount(0);
    await memberPage
      .getByRole('article', { name: `Space member ${emails[0]}`, exact: true })
      .getByRole('button', { name: 'Make project owner' })
      .click();
    await memberPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(memberPage.getByLabel('Project name')).toBeDisabled();
    await page.goto(`/workspaces?organizationId=${org.id}&id=${workspace.id}`);
    await page
      .getByRole('article', { name: `Space member ${emails[1]}`, exact: true })
      .getByRole('button', { name: 'Remove from space' })
      .click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(
      page.getByRole('article', { name: `Space member ${emails[1]}`, exact: true }),
    ).toHaveCount(0);
    await memberPage.reload();
    await expect(memberPage.getByRole('main').getByRole('alert').first()).toContainText(
      'Workspace not found',
    );
    await expect(memberPage.getByLabel('Project name')).toHaveCount(0);
  } finally {
    await context.close();
    if (orgId) {
      await prisma.project.deleteMany({ where: { workspace: { organizationId: orgId } } });
      await prisma.workspace.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  }
});
