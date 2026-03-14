import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Run every WCAG 2.0 / 2.1 / 2.2 rule at A, AA, and AAA conformance levels
// plus axe best-practices that go beyond the WCAG spec.
const WCAG_TAGS = [
  'wcag2a', 'wcag2aa',
  'wcag21a', 'wcag21aa',
  'wcag22aa',
  'best-practice',
];

function formatIssues(items: { impact?: string | null; id: string; help: string }[]) {
  return items.map((v) => `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help}`).join('\n');
}

async function expectFullWcagCompliance(page: Page, pagePath: string) {
  await page.goto(pagePath);
  await expect(page.locator('main')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();

  // Definite failures — must be zero.
  expect(results.violations, formatIssues(results.violations)).toEqual([]);

  // Incomplete items require manual review but are surfaced as test failures
  // so they're never silently ignored during CI.
  expect(results.incomplete, formatIssues(results.incomplete)).toEqual([]);
}

test('index page passes full WCAG compliance check', async ({ page }) => {
  // '.' resolves relative to baseURL (which includes the base path)
  await expectFullWcagCompliance(page, '.');
});

test('first RFD page passes full WCAG compliance check', async ({ page }) => {
  await page.goto('.');

  const firstRfdLink = page.locator('.rfd-row .rfd-title-link').first();
  await expect(firstRfdLink).toBeVisible();
  const href = await firstRfdLink.getAttribute('href');

  if (!href) {
    throw new Error('Unable to locate first RFD URL from index table.');
  }

  await expectFullWcagCompliance(page, href);
});
