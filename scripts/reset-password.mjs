import { createAuthStore } from '../server/auth-store.mjs';
import { runtimeConfig } from '../server/runtime-config.mjs';

// Operator recovery when nobody who can sign in is able to issue a reset link from Account → Team.
const config = runtimeConfig();
try {
  const auth = createAuthStore(config.data), id = auth.userIdByEmail(process.argv[2]);
  if (!id) throw new Error(`No account uses ${process.argv[2]}.`);
  const reset = await auth.createPasswordReset(id, null);
  const origin = config.publicOrigin || `http://127.0.0.1:${config.port}`;
  console.log(`Password reset for ${reset.email} (expires in 24 hours, single use):\n${origin}/#reset=${reset.token}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
