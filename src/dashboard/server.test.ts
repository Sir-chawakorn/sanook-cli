import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dashboardStaticFilePath, dashboardStaticRoot } from './server.js';

describe('dashboard static assets', () => {
  it('ships Sanook Dashboard shell files', async () => {
    const root = dashboardStaticRoot();
    const index = await readFile(join(root, 'index.html'), 'utf8');
    const app = await readFile(join(root, 'app.js'), 'utf8');
    expect(index).toContain('Sanook Dashboard');
    expect(app).toContain('/api/status');
  });

  it('resolves static asset paths without allowing traversal outside the dashboard bundle', () => {
    const root = dashboardStaticRoot();

    expect(dashboardStaticFilePath(root, '/')).toBe(join(root, 'index.html'));
    expect(dashboardStaticFilePath(root, '/app.js')).toBe(join(root, 'app.js'));
    expect(dashboardStaticFilePath(root, '/../package.json')).toBeNull();
    expect(dashboardStaticFilePath(root, '/..%2fpackage.json')).toBeNull();
  });
});
