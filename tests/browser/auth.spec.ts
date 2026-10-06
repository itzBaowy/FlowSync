import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client';

config({ path: '.env', quiet: true });
test('account creation, reload, responsive dashboard, theme, and logout', async ({ page }) => {
  const email = `browser-${randomUUID()}@example.com`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/login');
    await page.screenshot({ path: 'docs/screenshots/login.png', fullPage: true });
    await page.getByRole('link', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Full name').fill('Long Nguyen');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill('browser-test-password-only');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome, Long.' })).toBeVisible();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome, Long.' })).toBeVisible();
    const context = page.context();
    const tabs = await Promise.all([context.newPage(), context.newPage()]);
    let activeRefreshes = 0;
    let maximumRefreshes = 0;
    let refreshCount = 0;
    await context.route('**/api/auth/refresh', async (route) => {
      activeRefreshes++;
      refreshCount++;
      maximumRefreshes = Math.max(maximumRefreshes, activeRefreshes);
      try {
        // Hold the request long enough for all three tabs to request the shared cookie.
        await new Promise((resolve) => setTimeout(resolve, 200));
        const response = await route.fetch();
        await route.fulfill({ response });
      } finally {
        activeRefreshes--;
      }
    });
    try {
      await Promise.all([page.reload(), ...tabs.map((tab) => tab.goto('/dashboard'))]);
      for (const tab of [page, ...tabs])
        await expect(tab.getByRole('heading', { name: 'Welcome, Long.' })).toBeVisible();
      expect(refreshCount).toBe(3);
      expect(maximumRefreshes).toBe(1);
      for (const tab of tabs) await tab.reload();
      for (const tab of tabs)
        await expect(tab.getByRole('heading', { name: 'Welcome, Long.' })).toBeVisible();
    } finally {
      await context.unroute('**/api/auth/refresh');
      await Promise.all(tabs.map((tab) => tab.close()));
    }
    await page.screenshot({ path: 'docs/screenshots/dashboard.png', fullPage: true });
    await page.getByRole('button', { name: 'Toggle color theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: 'docs/screenshots/dashboard-dark.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await expect(page.getByRole('link', { name: 'Overview' })).not.toBeVisible();
    await page.screenshot({
      path: 'docs/screenshots/dashboard-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill('browser-test-password-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome, Long.' })).toBeVisible();
  } finally {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});
