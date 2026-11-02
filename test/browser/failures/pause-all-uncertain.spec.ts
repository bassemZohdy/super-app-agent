import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { test, expect } from '../fixtures.ts';

test('pause-all announces unconfirmed outcomes without claiming rules are unchanged', async ({ page }) => {
  const moduleId = '\0pause-test';
  const server = await createServer({
    root: resolve('apps/shell-react'), configFile: resolve('apps/shell-react/vite.config.ts'), logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'pause-test', resolveId(id) { return id === 'virtual:pause-test' ? moduleId : undefined; },
      load(id) { return id === moduleId ? `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MandateConsentPanel } from '/src/MandateConsentPanel.tsx';
        createRoot(document.getElementById('root')).render(React.createElement(MandateConsentPanel, {
          busy: false, read: async () => ({ mandates: [] }),
          mutate: async () => ({ success: true, paused: ['a'], notPaused: [{ mandateId: 'b', code: 'PAUSE_UNCONFIRMED' }] }),
          work: async fn => { await fn(); }
        }));` : undefined; },
      configureServer(vite) { vite.middlewares.use('/pause-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/pause-test', '<html><head></head><body><div id="root"></div><script type="module" src="/@id/virtual:pause-test"></script></body></html>')); }); },
    }],
  });
  try {
    await server.listen();
    const port = (server.httpServer!.address() as AddressInfo).port;
    await page.goto(`http://127.0.0.1:${port}/pause-test`);
    await page.getByRole('button', { name: 'Pause all rules' }).click({ timeout: 10000 });
    const status = page.getByRole('status');
    await expect(status).toContainText('1 rule could not be confirmed');
    await expect(status).toContainText('may already be paused');
    await expect(status).toContainText('Check their current state');
    await expect(status).not.toContainText('unchanged');
  } finally { await server.close(); }
});
