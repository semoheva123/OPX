import { test, expect } from '@playwright/test';

const baseUrl = (process.env.OPERIX_BASE_URL || process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000').replace(/\/$/, '');
const randomSuffix = Date.now();
const smokeEmail = `feature-scan-${randomSuffix}@example.com`;
const smokePassword = 'StrongTestPass123!';

async function parseJsonSafely(response: any) {
  const text = await response.text();
  if (!text || !text.trim().startsWith('{')) return null;
  try { return JSON.parse(text); } catch { return null; }
}

test.describe('OPERIX online feature scan', () => {
  test('loads the public landing page and admin login screen', async ({ page }) => {
    await page.goto(baseUrl, { waituntil: 'domcontentloaded', timeout: 15000 });
    await expect(page.locator('body')).toContainText('OPERIX');

    await page.goto(`${baseUrl}/admin-login.html`, { waituntil: 'domcontentloaded', timeout: 15000 });
    await expect(page.locator('#adminLoginForm')).toBeVisible();
    await expect(page.getByText('دخول لوحة الإدارة')).toBeVisible();
  });

  test('health and public service contract respond as JSON', async ({ request }) => {
    const healthResponse = await request.get(`${baseUrl}/api/health`);
    const health = await parseJsonSafely(healthResponse);

    if (!health || healthResponse.headers()['content-type']?.includes('text/html')) {
      test.skip(true, 'Target base URL is not the OPERIX app JSON health endpoint');
    }

    expect(healthResponse.ok()).toBeTruthy();
    expect(health.database).toBe('supabase');
    expect(Boolean(health.supabase?.reachable)).toBeTruthy();

    const vipResponse = await request.get(`${baseUrl}/api/public/vip-levels`);
    const vip = await parseJsonSafely(vipResponse);
    expect(vipResponse.ok()).toBeTruthy();
    expect(Array.isArray(vip)).toBeTruthy();

    const marketResponse = await request.get(`${baseUrl}/api/public/opx-market`);
    const market = await parseJsonSafely(marketResponse);
    expect(marketResponse.ok()).toBeTruthy();
    expect(market?.source || market?.symbol || market?.candles).toBeTruthy();
  });

  test('register and login API contract are reachable through the app endpoints', async ({ request }) => {
    const registerResponse = await request.post(`${baseUrl}/api/auth/register`, {
      data: {
        email: smokeEmail,
        password: smokePassword,
        referralCode: '',
        acceptTerms: true
      },
      headers: { 'Content-Type': 'application/json' }
    });

    const registerBody = await parseJsonSafely(registerResponse);
    expect(registerResponse.ok()).toBeTruthy();
    expect(registerBody?.token || registerBody?.message || registerBody?.user || registerBody?.success).toBeTruthy();

    const loginResponse = await request.post(`${baseUrl}/api/auth/login`, {
      data: {
        email: smokeEmail,
        password: smokePassword
      },
      headers: { 'Content-Type': 'application/json' }
    });

    const loginBody = await parseJsonSafely(loginResponse);
    expect(loginResponse.ok()).toBeTruthy();
    expect(loginBody?.token || loginBody?.message || loginBody?.user).toBeTruthy();
  });

  test('admin login page accepts the admin-login API contract route', async ({ request }) => {
    const adminLoginResponse = await request.post(`${baseUrl}/api/auth/admin-login`, {
      data: {
        email: 'admin@operix.app',
        password: 'admin123',
        twoFactorCode: '000000'
      },
      headers: { 'Content-Type': 'application/json' }
    });

    expect(adminLoginResponse.status()).toBeGreaterThanOrEqual(200);
    expect(adminLoginResponse.status()).toBeLessThan(500);
  });
});
