/** Real local identity and APIs: visible service links must resolve without an LLM or a hidden fixture fallback. */
import { test, expect } from '../stack.ts';

test('service navigation prepares each advertised page and survives reload', async ({ resident: page, stack }, info) => {
  for (const [label, serviceId] of [['Mobility', 'parking'], ['Utilities', 'utilities'], ['Payments', 'wallet'], ['Telecom', 'etisalat'], ['Housing', 'housing'], ['My profile', 'profile']]) {
    const drawer = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await drawer.isVisible()) await drawer.click();
    const prepared = page.waitForResponse(response => response.url() === `${stack.coreUrl}/api/manual/prepare` && response.request().postDataJSON().serviceId === serviceId);
    await page.getByRole('button', { name: label, exact: true }).click();
    const response = await prepared;
    expect(response.status(), `${label} is a supported service page`).toBe(200);
    const data = await response.json();
    expect(data.inference.provider).toBe('manual-service');
    expect(data.surface.revision).toBeTruthy();
    await expect(page).toHaveURL(`${stack.appUrl}/services/${serviceId}`);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message Rashid', exact: true })).toBeInViewport({ ratio: 1 });
    if (await page.getByRole('button', { name: /^Service details/ }).isVisible()) await page.getByRole('button', { name: /Service details/ }).click();
    await expect(page.getByRole('complementary', { name: 'Service details', exact: true })).toBeVisible();
    await expect(page.getByText('Not found', { exact: true })).toHaveCount(0);
    if (await page.getByRole('button', { name: 'Chat', exact: true }).isVisible()) await page.getByRole('button', { name: 'Chat', exact: true }).click();
  }
  await page.screenshot({ path: info.outputPath('service-navigation.png'), fullPage: true });
});
