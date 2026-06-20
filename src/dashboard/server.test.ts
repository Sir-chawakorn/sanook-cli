import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dashboardStaticRoot } from './server.js';

describe('dashboard static assets', () => {
  it('ships Sanook Dashboard shell files', async () => {
    const root = dashboardStaticRoot();
    const index = await readFile(join(root, 'index.html'), 'utf8');
    const app = await readFile(join(root, 'app.js'), 'utf8');
    expect(index).toContain('Sanook Dashboard');
    expect(app).toContain('/api/status');
  });
});
