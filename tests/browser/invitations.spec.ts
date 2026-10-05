import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import { validateEnvironment } from '../../apps/api/src/config/environment';
import { startEmailWorker } from '../../apps/api/src/modules/queue/email-worker';

test('SMTP invitation, matching-email registration, acceptance and replay rejection', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const suffix = randomUUID();
  const ownerEmail = `invite-browser-owner-${suffix}@example.com`;
  const invitedEmail = `invite-browser-member-${suffix}@example.com`;
  const password = 'browser-invitation-password';
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const mailpit = `http://127.0.0.1:${process.env.MAILPIT_HTTP_PORT ?? '8025'}`;
  const captured: string[] = [];
  const context = await browser.newContext();
  const worker = await startEmailWorker(
    validateEnvironment({
      ...process.env,
      SMTP_URL: `smtp://127.0.0.1:${process.env.MAILPIT_SMTP_PORT ?? '1025'}`,
    }),
  );
  let orgId: string | undefined;
  try {
    const owner = await prisma.user.create({
      data: { name: 'Invitation Owner', email: ownerEmail, passwordHash: await hash(password) },
    });
    const org = await prisma.organization.create({
      data: {
        name: 'Invitation Browser Team',
        slug: `invite-browser-${suffix}`,
        ownerId: owner.id,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    orgId = org.id;
    await page.goto('/login');
    await page.getByLabel('Work email').fill(ownerEmail);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    await page.goto(`/organizations?id=${org.id}`);
    await page.getByLabel('Invite email', { exact: true }).fill(invitedEmail);
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await expect(
      page.getByRole('article', { name: `Invitation ${invitedEmail}`, exact: true }),
    ).toBeVisible();
    let invitationPath = '';
    await expect
      .poll(
        async () => {
          const result = await (
            await fetch(
              `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${invitedEmail}`)}`,
            )
          ).json();
          const message = result.messages?.[0];
          if (!message) return false;
          if (!captured.includes(message.ID)) captured.push(message.ID);
          const details = await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json();
          const token = String(details.Text).match(/token=([a-f0-9]{64})/)?.[1];
          if (token) invitationPath = `/invite?token=${token}`;
          return !!token;
        },
        { timeout: 20000 },
      )
      .toBe(true);
    await page.goto(invitationPath);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Sign in with the invited email',
    );
    const memberPage = await context.newPage();
    await memberPage.goto(`${process.env.WEB_URL}${invitationPath}`);
    await memberPage.getByRole('link', { name: 'Sign in', exact: true }).click();
    await memberPage.getByRole('link', { name: 'Create an account', exact: true }).click();
    await memberPage.getByLabel('Full name').fill('Invited Member');
    await memberPage.getByLabel('Work email').fill(invitedEmail);
    await memberPage.getByLabel('Password').fill(password);
    await memberPage.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(
      memberPage.getByRole('heading', { name: 'Join Invitation Browser Team' }),
    ).toBeVisible();
    await memberPage.screenshot({ path: 'docs/screenshots/invitation.png', fullPage: true });
    await memberPage.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(memberPage).toHaveURL(new RegExp(`/organizations\\?id=${org.id}$`));
    await expect(memberPage.getByText('Your role: MEMBER', { exact: true })).toBeVisible();
    await expect(memberPage.getByLabel('Team name')).toBeDisabled();
    await page.goto(`/organizations?id=${org.id}`);
    await expect(
      page.getByRole('article', { name: `Member ${invitedEmail}`, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('article', { name: `Invitation ${invitedEmail}`, exact: true })
        .getByText(/ACCEPTED/),
    ).toBeVisible();
    await memberPage.goto(`${process.env.WEB_URL}${invitationPath}`);
    await expect(memberPage.getByRole('main').getByRole('alert')).toHaveText(
      'This invitation is no longer pending',
    );
    await expect(
      memberPage.getByRole('button', { name: 'Accept invitation', exact: true }),
    ).toHaveCount(0);
  } finally {
    await worker.stop();
    await context.close();
    if (captured.length)
      await fetch(`${mailpit}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ IDs: captured }),
      });
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, invitedEmail] } } });
    await prisma.$disconnect();
  }
});

test('invalid invitation and external auth destination are rejected', async ({ page }) => {
  await page.goto('/invite?token=invalid');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'This invitation link is invalid',
  );
  await page.goto('/login?next=https%3A%2F%2Fexample.com%2Finvite%3Ftoken%3D' + 'a'.repeat(64));
  await expect(page.getByRole('link', { name: 'Create an account', exact: true })).toHaveAttribute(
    'href',
    '/register',
  );
});
