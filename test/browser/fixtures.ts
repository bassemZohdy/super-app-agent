/** Shared fixtures for the browser journeys (QA-09). Playwright Test gives every test its own browser context, so no
 *  cookie, storage or session carries over. On top of that, every test must stay on this machine: a request to any other
 *  host is aborted and fails the test, because a journey that quietly needs the internet is not a local journey. */
import { test as base, expect } from 'playwright/test';
import { demoPortOffset } from '../../scripts/endpoints.ts';
import { installNetworkFence } from './network-fence.ts';

export const test = base.extend<{ blockedExternalRequests: string[] }>({
  blockedExternalRequests: [async ({ context }, use) => {
    const blocked: string[] = [];
    await installNetworkFence(context, demoPortOffset, blocked);
    await use(blocked);
    expect(blocked, 'the journey tried to reach a blocked external or interactive-stack endpoint').toEqual([]);
  }, { auto: true }],
});

export { expect };
