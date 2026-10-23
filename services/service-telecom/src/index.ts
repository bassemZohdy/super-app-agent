import { fileURLToPath } from 'node:url';
import { createApplicationServer } from '../../../packages/backend-kit/src/application.ts';
export const server = createApplicationServer('service-telecom', () => ({ status: 404, data: { error: 'Enable PROVIDER_INTEGRATION to use telecom simulators.' } }));
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT || 4006), '0.0.0.0');
