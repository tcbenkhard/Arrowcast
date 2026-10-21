import { test as base, expect } from '@playwright/test';
import { testAdminToken } from './admin';

// Feature tests assert English UI text. Reset the shared account after language
// tests, and set the visitor preference before the first page loads.
export const test = base.extend<{ appLanguage: void }>({
  appLanguage: [
    async ({ context, request }, use) => {
      const response = await request.patch('/api/v1/admin/me/language', {
        headers: { Authorization: `Bearer ${testAdminToken()}` },
        data: { language: 'en' },
      });
      expect(response.ok()).toBeTruthy();
      await context.addInitScript(() => localStorage.setItem('arrowcast.language', 'en'));
      await use();
    },
    { auto: true },
  ],
});

export { expect };
