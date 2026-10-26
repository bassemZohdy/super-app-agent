/** Browser-side measures shared by the shell accessibility specs (P2-14): control size and text, and keyboard focus. */
import type { Page } from 'playwright/test';

export const CONTROLS = "button, select, input:not([type='checkbox']):not([type='radio']):not([type='hidden']), textarea, summary, [role='button']";

/** Visible controls whose target is under 44px in either direction, or whose text is under 14px. */
export const controlsBelowTarget = (page: Page) => page.evaluate((selector) => {
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
export const focusIsVisible = (page: Page) => page.evaluate(() => {
  for (let node = document.activeElement as Element | null; node; node = node.parentElement) {
    const s = getComputedStyle(node);
    if (s.outlineStyle !== 'none' && Number.parseFloat(s.outlineWidth) >= 2 && node.matches(':focus-within')) return true;
  }
  return false;
});

/** Elements that still animate or transition while reduced motion is requested. */
export const stillMoving = (page: Page) => page.evaluate(() => [...document.querySelectorAll('*')].flatMap(el => {
  const s = getComputedStyle(el), transitions = s.transitionDuration.split(',').some(value => Number.parseFloat(value) > 0), animated = s.animationName !== 'none' && s.animationDuration.split(',').some(value => Number.parseFloat(value) > 0);
  return transitions || animated ? [`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`] : [];
}));

/** Every Tab stop among the first `steps` that shows no focus indicator. */
export async function unseenFocusStops(page: Page, steps = 14) {
  const unseen: string[] = [];
  for (let step = 0; step < steps; step++) {
    const label = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 30)}"` : 'none'; });
    // Past the last Tab stop focus leaves the page (or wraps to the body); that is the end of the walk, not a missing indicator.
    if (step > 0 && label.startsWith('body')) break;
    if (!await focusIsVisible(page)) unseen.push(label);
    await page.keyboard.press('Tab');
  }
  return unseen;
}

/** Gives every element a transition and an infinite animation, so a reduced-motion check proves a rule that stops motion and
 *  does not pass only because the page happens to have none. Not important, so a shell's own `!important` rule still wins. */
export const injectMotionCanary = (page: Page) => page.addStyleTag({ content: '@keyframes motion-canary { to { opacity: 0.99; } } * { transition: all 1s; animation: motion-canary 1s infinite; }' });
