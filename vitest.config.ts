import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    // Per-file temp HOME so the suite never touches the real ~/.sanook / vault and fs-backed tests
    // (memory store, persona, brain) can't race on a shared directory. See vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
  },
});
