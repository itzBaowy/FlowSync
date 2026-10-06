import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';
test('meeting-note preview requires selection and confirmation before creating real tasks', async ({
  page,
}) => {
  const suffix = randomUUID();
  const email = `ai-browser-${suffix}@example.com`;
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let organizationId: string | undefined;
  let projectId: string | undefined;
  let runId: string | undefined;
  try {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('AI Owner');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill('browser-ai-test-password');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const organization = await db.organization.create({
      data: {
        name: 'AI Team',
        slug: `ai-browser-${suffix}`,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    organizationId = organization.id;
    const workspace = await db.workspace.create({
      data: {
        organizationId,
        name: 'AI Studio',
        slug: 'ai',
        members: { create: { userId: user.id } },
      },
    });
    const project = await db.project.create({
      data: {
        workspaceId: workspace.id,
        ownerId: user.id,
        name: 'AI Release',
        members: { create: { userId: user.id } },
      },
    });
    projectId = project.id;
    const board = await db.board.create({
      data: { projectId, name: 'Delivery', columns: { create: { name: 'To do', position: 0 } } },
      include: { columns: true },
    });
    await page.goto(`/projects?workspaceId=${workspace.id}&id=${projectId}`);
    const assistant = page.getByRole('region', { name: 'Project assistant' });
    await expect(
      assistant.getByText('The assistant is unavailable. Contact your workspace admin.'),
    ).toBeVisible();
    await expect(assistant.getByRole('button', { name: 'Ask assistant' })).toBeDisabled();
    // Inference is a deterministic fixture; the confirmation uses the real private HTTP API and database.
    await page.route(`**/projects/${projectId}/ai/availability`, (route) =>
      route.fulfill({ json: { data: { enabled: true }, meta: {} } }),
    );
    await page.route(`**/projects/${projectId}/ai/requests`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const input = route.request().postDataJSON();
      const run = await db.aIRun.create({
        data: {
          environment: 'test',
          kind: input.kind,
          conversation: {
            create: {
              userId: user.id,
              projectId: project.id,
              title: 'Meeting notes',
              messages: { create: { role: 'USER', content: input.prompt } },
            },
          },
        },
      });
      runId = run.id;
      await route.fulfill({
        status: 201,
        json: {
          data: {
            id: run.id,
            projectId,
            kind: run.kind,
            prompt: input.prompt,
            status: 'PENDING',
            output: null,
            error: null,
            confirmedTaskIds: [],
            confirmedAt: null,
            createdAt: run.createdAt.toISOString(),
          },
          meta: {},
        },
      });
    });
    await page.reload();
    await assistant.getByLabel('Assistant mode').selectOption('MEETING_NOTES');
    await assistant
      .getByLabel('Meeting notes')
      .fill('Review the release checklist and write a launch note.');
    await assistant.getByRole('button', { name: 'Suggest tasks' }).click();
    await expect(assistant.getByText('The assistant is reviewing this project...')).toBeVisible();
    expect(await db.task.count({ where: { columnId: board.columns[0]!.id } })).toBe(0);
    await db.aIRun.update({
      where: { id: runId! },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        output: {
          headline: 'Release follow-up',
          bullets: ['Two tasks suggested from your notes'],
          risks: [],
          references: [],
          suggestions: [
            {
              title: 'Review release checklist',
              description: 'Review items together',
              priority: 'HIGH',
              dueDate: null,
              assigneeIds: [user.id],
            },
            {
              title: 'Write launch note',
              description: null,
              priority: 'MEDIUM',
              dueDate: null,
              assigneeIds: [],
            },
          ],
        },
      },
    });
    await expect(assistant.getByRole('heading', { name: 'Release follow-up' })).toBeVisible();
    await expect(assistant.getByRole('button', { name: 'Create 0 selected tasks' })).toBeDisabled();
    await assistant.getByLabel('Review release checklist', { exact: true }).check();
    await assistant.getByLabel('Destination board').selectOption(board.id);
    await assistant.getByLabel('Destination column').selectOption(board.columns[0]!.id);
    await assistant.getByRole('button', { name: 'Create 1 selected task', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Create suggested tasks?' })
      .getByRole('button', { name: 'Cancel' })
      .click();
    expect(await db.task.count({ where: { columnId: board.columns[0]!.id } })).toBe(0);
    await assistant.getByRole('button', { name: 'Create 1 selected task', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Create suggested tasks?' })
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();
    await expect(assistant.getByText('1 task created.', { exact: false })).toBeVisible();
    expect(
      await db.task.count({
        where: { columnId: board.columns[0]!.id, title: 'Review release checklist' },
      }),
    ).toBe(1);
    expect(
      await db.task.count({
        where: { columnId: board.columns[0]!.id, title: 'Write launch note' },
      }),
    ).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: 'docs/screenshots/ai-assistant-mobile.png', fullPage: true });
    await assistant.getByRole('link', { name: 'Open boards' }).click();
    await expect(page.getByRole('heading', { name: 'Delivery', exact: true })).toBeVisible();
    await expect(page.getByText('Review release checklist', { exact: true }).first()).toBeVisible();
  } finally {
    if (organizationId) {
      const scope = { workspace: { organizationId } };
      await db.aIConversation.deleteMany({ where: { project: scope } });
      await db.activity.deleteMany({ where: { organizationId } });
      await db.task.deleteMany({ where: { column: { board: { project: scope } } } });
      await db.column.deleteMany({ where: { board: { project: scope } } });
      await db.board.deleteMany({ where: { project: scope } });
      await db.project.deleteMany({ where: scope });
      await db.workspace.deleteMany({ where: { organizationId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
    }
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  }
});
