import type { ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import {
  approximateTokens,
  buildPromptSizeBreakdown,
  measurePromptSection,
  renderPromptSizeBreakdown,
  serializeToolSchemas,
} from './prompt-size.js';

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    model: 'sonnet',
    maxSteps: 20,
    permissionMode: 'ask',
    cacheTtl: '5m',
    compaction: 'truncate',
    contextCompression: 'selective',
    ...overrides,
  };
}

describe('prompt-size helpers', () => {
  it('measures chars, UTF-8 bytes, and rough tokens', () => {
    expect(approximateTokens(0)).toBe(0);
    expect(approximateTokens(401)).toBe(101);

    const section = measurePromptSection('thai', 'Thai text', 'ไทย');
    expect(section).toMatchObject({
      id: 'thai',
      label: 'Thai text',
      chars: 3,
      bytes: 9,
      approxTokens: 1,
      empty: false,
    });
  });

  it('serializes tool schemas without executable functions', () => {
    const tools = {
      read_file: {
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        execute: async () => 'secret runtime path',
      },
    } as unknown as ToolSet;

    const json = serializeToolSchemas(tools);
    expect(json).toContain('"name": "read_file"');
    expect(json).toContain('"description": "Read a file"');
    expect(json).not.toContain('execute');
    expect(json).not.toContain('secret runtime path');
  });
});

describe('buildPromptSizeBreakdown', () => {
  it('builds a deterministic offline report from injected loaders', async () => {
    const report = await buildPromptSizeBreakdown({
      cwd: '/repo',
      loadConfigImpl: async () => testConfig({ personality: 'friendly' }),
      loadMemoryImpl: async () => '<memory>SANOOK.md</memory>',
      loadAutoMemoryImpl: async () => '<auto_memory>remember this</auto_memory>',
      loadSkillsImpl: async () => [{ name: 'ship', description: 'ship cleanly', path: '/skills/ship/SKILL.md' }],
      gitContextImpl: async () => '<git>main clean</git>',
      loadBrainContextImpl: async () => '<brain_vault>state</brain_vault>',
      loadRepoMapImpl: async () => '<repo_map>src/index.ts</repo_map>',
      tools: {
        read_file: {
          description: 'Read a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      } as unknown as ToolSet,
    });

    expect(report.cwd).toBe('/repo');
    expect(report.model).toBe('sonnet');
    expect(report.skillsCount).toBe(1);
    expect(report.builtInToolsCount).toBe(1);
    expect(report.sections.map((section) => section.id)).toEqual([
      'base-system',
      'personality',
      'auto-memory',
      'skills-index',
      'brain-context',
      'project-memory',
      'repo-map',
      'git-context',
    ]);
    expect(report.sections.find((section) => section.id === 'skills-index')?.empty).toBe(false);
    expect(report.systemPrompt.chars).toBeGreaterThan(report.sections[0].chars);
    expect(report.toolSchemas.chars).toBeGreaterThan(0);
    expect(report.total.chars).toBeGreaterThan(report.systemPrompt.chars);

    const rendered = renderPromptSizeBreakdown(report);
    expect(rendered).toContain('Sanook prompt-size');
    expect(rendered).toContain('Second-brain context');
    expect(rendered).toContain('MCP tools are intentionally not spawned');
  });
});
