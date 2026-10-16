import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';

test('authentication form exposes validation and password visibility on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByLabel('Full name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Full name').fill('Alex Tran');
  await page.getByLabel('Work email').fill('alex@example.com');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Use at least 12 characters')).toBeVisible();
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(
    page.getByRole('heading', { name: 'Back in your flow.', exact: true }),
  ).toBeVisible();
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      json: {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      },
    }),
  );
  await page.getByLabel('Work email').fill('alex@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Email or password is incorrect',
  );
  await page.screenshot({ path: 'docs/screenshots/login-mobile.png', fullPage: true });
});

test('populated workspace filters, pagination, task links, keyboard tabs, and navigation remain usable', async ({
  page,
}) => {
  test.setTimeout(60000);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const suffix = randomUUID();
  const email = `design-${suffix}@example.com`;
  const password = 'browser-design-password';
  let organizationId: string | undefined;
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Alex Tran');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const org = await prisma.organization.create({
      data: {
        name: 'Product Studio',
        slug: `design-${suffix}`,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    organizationId = org.id;
    const workspace = await prisma.workspace.create({
      data: {
        organizationId,
        name: 'Product & Design',
        slug: 'product',
        members: { create: { userId: user.id } },
      },
    });
    const projects = [];
    for (const [index, name] of [
      'FlowSync launch',
      'Design system',
      'Mobile experience',
    ].entries()) {
      projects.push(
        await prisma.project.create({
          data: {
            workspaceId: workspace.id,
            name,
            ownerId: user.id,
            status: index === 2 ? 'PLANNING' : 'ACTIVE',
            members: { create: { userId: user.id } },
          },
        }),
      );
    }
    const project = projects[0]!;
    const board = await prisma.board.create({
      data: {
        projectId: project.id,
        name: 'Launch board',
        columns: {
          create: [
            { name: 'To do', kind: 'TODO', position: 0 },
            { name: 'In progress', kind: 'IN_PROGRESS', position: 1 },
            { name: 'Review', kind: 'REVIEW', position: 2 },
            { name: 'Done', kind: 'DONE', position: 3 },
          ],
        },
      },
      include: { columns: { orderBy: { position: 'asc' } } },
    });
    const titles = [
      'Review onboarding wireframes',
      'Polish the new workspace navigation',
      'Document the release checklist',
      'Validate the mobile task drawer',
      'Align design tokens across screens',
      'Plan next week’s team review',
      'Ship the project overview',
      'Connect task activity updates',
    ];
    const tasks = [];
    for (const [index, title] of titles.entries()) {
      const dueDate =
        index >= 6
          ? null
          : new Date(Date.now() + (index === 0 ? -2 : index <= 3 ? index : index + 6) * 86400000);
      tasks.push(
        await prisma.task.create({
          data: {
            columnId: board.columns[index >= 6 ? 3 : index === 1 ? 1 : index === 3 ? 2 : 0]!.id,
            title,
            description: 'Bring the team’s feedback together and make the next step clear.',
            priority: index < 2 ? 'HIGH' : index < 4 ? 'MEDIUM' : 'LOW',
            position: index,
            dueDate,
            createdById: user.id,
            assignees: { create: { userId: user.id } },
          },
        }),
      );
    }
    await prisma.activity.createMany({
      data: [
        {
          organizationId,
          projectId: project.id,
          taskId: tasks[6]!.id,
          actorId: user.id,
          action: 'TASK_UPDATED',
          metadata: { title: titles[6] },
        },
        {
          organizationId,
          projectId: project.id,
          taskId: tasks[1]!.id,
          actorId: user.id,
          action: 'TASK_CREATED',
          metadata: { title: titles[1] },
        },
      ],
    });
    await page.reload();
    const myTasks = page.getByRole('region', { name: 'My tasks', exact: true });
    await expect(myTasks.getByRole('link')).toHaveCount(6);
    await expect(page.getByLabel('Task completion percentage')).toHaveAttribute('value', '25');
    await page.screenshot({
      path: 'docs/screenshots/dashboard-populated.png',
      fullPage: true,
      style: '[data-sonner-toaster] { visibility: hidden !important; }',
    });
    await page.getByRole('button', { name: 'Toggle color theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({
      path: 'docs/screenshots/dashboard-populated-dark.png',
      fullPage: true,
      style: '[data-sonner-toaster] { visibility: hidden !important; }',
    });
    await page.getByRole('button', { name: 'Toggle color theme' }).click();
    await myTasks.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(myTasks).toContainText('Page 2 of 2');
    await expect(myTasks.getByRole('link')).toHaveCount(2);
    await myTasks.getByRole('button', { name: 'Overdue', exact: true }).click();
    await expect(myTasks).toContainText('Page 1 of 1');
    await expect(myTasks.getByRole('link')).toHaveCount(1);
    await expect(myTasks).toContainText(titles[0]!);
    await myTasks.getByRole('button', { name: 'Due soon', exact: true }).click();
    await expect(myTasks.getByRole('link')).toHaveCount(3);
    await page.getByLabel('My task priority').selectOption('HIGH');
    await expect(myTasks.getByRole('link')).toHaveCount(1);
    await expect(myTasks).toContainText(titles[1]!);
    await page.getByLabel('Search my tasks').fill('no matching work');
    await expect(myTasks.getByText('You’re all caught up')).toBeVisible();
    await page.getByLabel('Search my tasks').clear();
    await expect(myTasks.getByRole('link')).toHaveCount(1);
    await page.keyboard.press('Control+k');
    const search = page.getByRole('dialog', { name: 'Search your workspace' });
    await expect(search).toBeVisible();
    await search.getByLabel('Search everything').fill('wireframes');
    await search.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(search.getByRole('link', { name: /Review onboarding wireframes/ })).toBeVisible();
    await page.keyboard.press('Escape');
    let dashboardRequestsOnBoard = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/dashboard') dashboardRequestsOnBoard++;
    });
    await myTasks.getByRole('link').click();
    const panel = page.getByRole('dialog', { name: 'Task details', exact: true });
    await expect(panel.getByLabel('Task title', { exact: true })).toHaveValue(titles[1]!);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/tasks/${tasks[1]!.id}`) &&
        response.request().method() === 'PATCH',
    );
    await panel.getByRole('button', { name: 'Save task', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(panel.getByRole('button', { name: 'Save task', exact: true })).toBeEnabled();
    expect(dashboardRequestsOnBoard).toBe(0);
    await expect
      .poll(() =>
        panel.evaluate((node) => Math.abs(node.getBoundingClientRect().right - innerWidth)),
      )
      .toBeLessThan(2);
    await page.screenshot({
      path: 'docs/screenshots/task-drawer.png',
      style: '[data-sonner-toaster] { visibility: hidden !important; }',
    });
    await panel.getByRole('button', { name: 'Close task', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Recent project navigation' })
      .getByRole('link', { name: project.name, exact: true })
      .click();
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('Project name', { exact: true })).not.toBeVisible();
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeFocused();
    await expect(page.getByLabel('Project name', { exact: true })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
    await page.screenshot({ path: 'docs/screenshots/project-overview-mobile.png', fullPage: true });
  } finally {
    if (organizationId) {
      const scope = { workspace: { organizationId } };
      await prisma.activity.deleteMany({ where: { organizationId } });
      await prisma.task.deleteMany({ where: { column: { board: { project: scope } } } });
      await prisma.column.deleteMany({ where: { board: { project: scope } } });
      await prisma.board.deleteMany({ where: { project: scope } });
      await prisma.project.deleteMany({ where: scope });
      await prisma.workspace.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});
