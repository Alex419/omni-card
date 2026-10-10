import { defineConfig } from 'tsup';

// Bundle the server and the shared package into one file. Real npm dependencies stay external
// and are installed on the host as usual.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: ['@omni/shared'],
});
