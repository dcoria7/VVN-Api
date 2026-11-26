// Build reproducible para smoke:local, aunque exista configuración remota local.
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child=spawn('npm',['run','build'],{stdio:'inherit',env:{...process.env,
 VVN_ENVIRONMENT:'staging',
 VVN_BRAND_ID:'00000090-1111-4111-8111-111111111111',
 NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:'local-test-key',
 BRAND_OPERATOR_EMAIL:'operator@example.invalid',
 BRAND_OPERATOR_PASSWORD:'synthetic-password',
 RATING_SALT:'local-test-salt',NEXT_TELEMETRY_DISABLED:'1',SENTRY_DSN:'',
}});
const [code]=await once(child,'exit');
if(code!==0)process.exit(code??1);
await import('./clean-standalone-env.mjs');
