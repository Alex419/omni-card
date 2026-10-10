import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** All configuration comes from environment variables (12-factor style). See .env.example. */

// Local development: read the repo-root .env if there is one. Node has this built in now, so no
// dotenv package. (Hosts like Render set real environment variables instead.)
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile) && !process.env.VITEST) process.loadEnvFile(envFile);

const env = process.env;

const clientDist = env.CLIENT_DIST ?? fileURLToPath(new URL('../../client/dist', import.meta.url));

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '0.0.0.0',
  production: env.NODE_ENV === 'production',
  /** Built client to serve, if present. In dev, Vite serves the client instead. */
  clientDist: existsSync(clientDist) ? clientDist : null,
  supabaseUrl: env.SUPABASE_URL ?? '',
  supabaseKey: env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  /** Where feedback goes when Supabase isn't configured (local dev). */
  feedbackFile: env.FEEDBACK_FILE ?? '.data/feedback.jsonl',
  /** Where analytics go when Supabase isn't configured (local dev). */
  analyticsFile: env.ANALYTICS_FILE ?? '.data/analytics.jsonl',
  /**
   * Secret that turns browser tokens into analytics pseudonyms. Must stay the same across
   * restarts or returning players look new. Render generates one (see render.yaml).
   */
  analyticsSecret: env.ANALYTICS_SECRET ?? '',
  /** Set ANALYTICS=off to record nothing. */
  analyticsEnabled: env.ANALYTICS !== 'off',
};
export type Config = typeof config;
