import { createApp } from './app';
import { config } from './config';
import { log } from './log';
import { cryptoRng } from './rng';

const app = createApp(config, cryptoRng);

app.server.listen(config.port, config.host, () => {
  log.info('omni card server listening', {
    port: config.port,
    client: config.clientDist ? 'serving built client' : 'not built (use the Vite dev server)',
    feedback: app.feedback.name,
    analytics: app.analytics.name,
  });
});

// Hosts send SIGTERM before stopping or redeploying: close sockets cleanly instead of dropping them.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log.info('shutting down', { signal });
    void app.close().then(() => process.exit(0));
  });
}
