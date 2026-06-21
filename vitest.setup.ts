import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate every test FILE to a unique throwaway HOME, set BEFORE the test module (and thus
// src/memory-store.ts, whose MEMORY_DIR = appHomePath('memory') freezes at import) is evaluated.
// Effect:
//   • no test ever reads or clobbers the real ~/.sanook (auto-memory) or the second-brain vault;
//   • concurrent test files resolve to different memory dirs, so they can't race on a shared dir
//     (was: flaky `ENOTEMPTY: rmdir ~/.sanook/memory` when several files rm/write it at once).
// Tests that need their own HOME still stubEnv('HOME', …) locally; this is just a safe default.
process.env.HOME = mkdtempSync(join(tmpdir(), 'sanook-test-home-'));
