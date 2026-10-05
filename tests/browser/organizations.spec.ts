import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import sharp from 'sharp';

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
