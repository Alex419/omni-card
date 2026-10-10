import { defineConfig } from 'vitest/config';

// One test runner for the whole monorepo. Each workspace keeps its tests in `test/`.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', root: 'packages/shared', environment: 'node' } },
      { test: { name: 'server', root: 'apps/server', environment: 'node' } },
      { test: { name: 'client', root: 'apps/client', environment: 'node' } },
    ],
  },
});
