import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import sharp from 'sharp';
import { hash } from 'argon2';

test('organization creation, settings, private logo and confirmed deletion', async ({ page }) => {
  const suffix = randomUUID();
  const email = `organization-browser-${suffix}@example.com`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Team Owner');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill('browser-organization-password');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    await page.getByRole('link', { name: 'Organizations', exact: true }).click();
    await page.getByRole('button', { name: 'Create organization', exact: true }).click();
    await page.getByLabel('Organization name', { exact: true }).fill('Browser Team');
    await page.getByLabel('Organization slug', { exact: true }).fill(`browser-${suffix}`);
    await page.getByRole('button', { name: 'Create team', exact: true }).click();
    await expect(page.getByLabel('Team name')).toHaveValue('Browser Team');
    await page.getByLabel('Team name').fill('Browser Team Updated');
    await page.getByLabel('Allow admins to invite members').uncheck();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(
      page.getByRole('heading', { name: 'Browser Team Updated', exact: true }),
    ).toBeVisible();
    const buffer = await sharp({
      create: { width: 16, height: 16, channels: 4, background: '#6155d9' },
    })
      .png()
      .toBuffer();
    await page
      .getByLabel('Organization logo', { exact: true })
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer });
    await page.getByRole('button', { name: 'Upload logo' }).click();
    const logo = page.getByRole('img', { name: 'Browser Team Updated logo' });
    await expect(logo).toBeVisible();
    await expect
      .poll(() => logo.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByLabel('Allow admins to invite members')).not.toBeChecked();
    await page.screenshot({ path: 'docs/screenshots/organizations.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: 'docs/screenshots/organizations-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Delete organization' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('Team name')).toBeVisible();
    await page.getByRole('button', { name: 'Delete organization' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page).toHaveURL('/organizations');
    await expect(
      page.getByText('Create your first team, or accept an email invitation.'),
    ).toBeVisible();
  } finally {
    await prisma.organization.deleteMany({ where: { owner: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});

test('member roles, removal, invitation revocation and ownership controls', async ({
  page,
  browser,
}) => {
  const suffix = randomUUID();
  const email = `roles-owner-${suffix}@example.com`;
  const memberEmail = `roles-member-${suffix}@example.com`;
  const password = 'browser-membership-password';
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let organizationId: string | undefined;
  const userIds: string[] = [];
  const memberContext = await browser.newContext();
  try {
    const passwordHash = await hash(password);
    for (const [name, email] of [
      ['Owner', `roles-owner-${suffix}@example.com`],
      ['Member', memberEmail],
      ['Removed Member', `removed-${suffix}@example.com`],
    ]) {
      const user = await prisma.user.create({ data: { name: name!, email: email!, passwordHash } });
      userIds.push(user.id);
    }
    const org = await prisma.organization.create({
      data: {
        name: 'Member Controls',
        slug: `roles-${suffix}`,
        ownerId: userIds[0]!,
        members: {
          create: userIds.map((userId, index) => ({
            userId,
            role: index === 0 ? 'OWNER' : 'MEMBER',
          })),
        },
      },
    });
    organizationId = org.id;
    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    await page.goto(`/organizations?id=${org.id}`);
    const removed = page.getByRole('article', {
      name: `Member removed-${suffix}@example.com`,
      exact: true,
    });
    await removed.getByRole('button', { name: 'Remove member' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(removed).toHaveCount(0);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`${process.env.WEB_URL}/login`);
    await memberPage.getByLabel('Work email').fill(memberEmail);
    await memberPage.getByLabel('Password').fill(password);
    await memberPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(memberPage).toHaveURL(/\/dashboard$/);
    await memberPage.goto(`${process.env.WEB_URL}/organizations?id=${org.id}`);
    await expect(memberPage.getByLabel('Team name')).toBeDisabled();
    await expect(memberPage.getByRole('button', { name: 'Make owner' })).toHaveCount(0);
    await expect(memberPage.getByLabel('Invite email')).toHaveCount(0);
    const member = page.getByRole('article', { name: `Member ${memberEmail}`, exact: true });
    await member.getByLabel(`Role for ${memberEmail}`, { exact: true }).selectOption('ADMIN');
    await member.getByRole('button', { name: 'Save role' }).click();
    await expect(member.getByText('ADMIN', { exact: true })).toBeVisible();
    const invited = `invited-${suffix}@example.com`;
    await page.getByLabel('Invite email', { exact: true }).fill(invited);
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    const invitation = page.getByRole('article', { name: `Invitation ${invited}`, exact: true });
    await expect(invitation.getByText(/PENDING/)).toBeVisible();
    await invitation.getByRole('button', { name: 'Revoke invitation' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(invitation.getByText(/REVOKED/)).toBeVisible();
    await member.getByRole('button', { name: 'Make owner' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Your role: ADMIN', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Team name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete organization' })).toHaveCount(0);
    await expect(page.getByLabel('Invite role').locator('option')).toHaveCount(1);
    await memberPage.reload();
    await expect(memberPage.getByText('Your role: OWNER', { exact: true })).toBeVisible();
    await expect(memberPage.getByLabel('Team name')).toBeEnabled();
  } finally {
    await memberContext.close();
    if (organizationId) await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
