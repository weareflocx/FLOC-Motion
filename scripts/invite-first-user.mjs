import { createAuthStore } from '../server/auth-store.mjs';
import { runtimeConfig } from '../server/runtime-config.mjs';

const config = runtimeConfig();
try {
  const invitation = await createAuthStore(config.data).bootstrap(process.argv[2]);
  const origin = config.publicOrigin || `http://127.0.0.1:${config.port}`;
  console.log(`First account invitation (expires in 48 hours):\n${origin}/#invite=${invitation.token}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
