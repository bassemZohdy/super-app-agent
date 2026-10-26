/** Resident intent: use the app with a finger, a keyboard or reduced motion (P2-14). Measured in the real shell on the running
 *  stack: every control is at least 44px, control text is at least the control size, keyboard focus is visible, and reduced
 *  motion stops animation. Desktop only until the phone layout is delivered (QA-06). */
import type { Page } from 'playwright/test';
import { expect, test } from '../stack.ts';

const CONTROLS = "button, select, input:not([type='checkbox']):not([type='radio']):not([type='hidden']), textarea, summary, [role='button']";

const controlsBelowTarget = (page: Page) => page.evaluate((selector) => {
  const visible = (el: Element) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
  return [...document.querySelectorAll(selector)].filter(visible).flatMap(el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el), text = ((el as HTMLElement).innerText || '').trim() !== '' || /^(select|input|textarea)$/i.test(el.tagName);
    const problems = [];
    if (r.width < 43.5 || r.height < 43.5) problems.push(`target ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (text && Number.parseFloat(s.fontSize) < 14) problems.push(`font ${s.fontSize}`);
    return problems.length ? [`${name(el)}: ${problems.join(', ')}`] : [];
  });
}, CONTROLS);

/** Whether the focused element, or an ancestor that contains focus, draws an outline of at least 2px. */
const focusIsVisible = (page: Page) => page.evaluate(() => {
  for (let node = document.activeElement as Element | null; node; node = node.parentElement) {
    const s = getComputedStyle(node);
    if (s.outlineStyle !== 'none' && Number.parseFloat(s.outlineWidth) >= 2 && node.matches(':focus-within')) return true;
  }
  return false;
});

const screens: Array<[string, (page: Page) => Promise<void>]> = [
  ['home', async () => {}],
  ['payment accounts', async page => { await page.getByRole('button', { name: 'Payment accounts', exact: true }).click(); await page.getByRole('button', { name: 'Show kill switch', exact: true }).waitFor(); }],
  ['delegated access', async page => { await page.getByRole('button', { name: 'Delegated access', exact: true }).click(); await page.getByRole('button', { name: 'Refresh grants', exact: true }).waitFor(); }],
];

test.describe('touch, focus and motion', () => {
  test.beforeEach(({ isMobile }) => { test.skip(isMobile, 'QA-06: the phone layout is not delivered yet, so these measures run on desktop only.'); });

  for (const [name, open] of screens) {
    test(`${name}: every control is at least 44px and its text at least 14px`, async ({ resident }) => {
      await open(resident);
      expect(await controlsBelowTarget(resident)).toEqual([]);
    });
  }

  test('the keyboard focus is visible on every control reached with Tab, including the message composer', async ({ resident }) => {
    const composer = resident.getByPlaceholder(/Ask Rashid/);
    await composer.focus();
    expect(await focusIsVisible(resident), 'the composer shows focus on its container').toBe(true);
    await resident.mouse.click(1, 1);
    await resident.keyboard.press('Tab');
    const unseen: string[] = [];
    for (let step = 0; step < 14; step++) {
      const label = await resident.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 30)}"` : 'none'; });
      if (!await focusIsVisible(resident)) unseen.push(label);
      await resident.keyboard.press('Tab');
    }
    expect(unseen).toEqual([]);
  });

  test('reduced motion stops every transition and animation', async ({ resident }) => {
    await resident.emulateMedia({ reducedMotion: 'reduce' });
    await resident.getByRole('button', { name: 'Payment accounts', exact: true }).click();
    const moving = await resident.evaluate(() => [...document.querySelectorAll('*')].flatMap(el => {
      const s = getComputedStyle(el), transitions = s.transitionDuration.split(',').some(value => Number.parseFloat(value) > 0), animated = s.animationName !== 'none' && s.animationDuration.split(',').some(value => Number.parseFloat(value) > 0);
      return transitions || animated ? [`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`] : [];
    }));
    expect(moving).toEqual([]);
    expect(await resident.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  });
});
