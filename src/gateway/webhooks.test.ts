import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedWebhookConfig } from './config.js';
import {
  handleWebhookRequest,
  renderWebhookTemplate,
  verifyWebhookSignature,
  webhookEventType,
} from './webhooks.js';

const h = vi.hoisted(() => ({
  runGatewayAgent: vi.fn(),
  deliverToTarget: vi.fn(),
}));

vi.mock('./session.js', () => ({
  runGatewayAgent: h.runGatewayAgent,
}));

vi.mock('./deliver.js', () => ({
  deliverToTarget: h.deliverToTarget,
}));

afterEach(() => {
  h.runGatewayAgent.mockReset();
  h.deliverToTarget.mockReset();
});

function cfg(overrides: Partial<ResolvedWebhookConfig> = {}): ResolvedWebhookConfig {
  return {
    enabled: true,
    secret: 'global-secret',
    publicUrl: 'https://hooks.example.com',
    rateLimitPerMinute: 30,
    source: 'config',
    routes: {
      issues: {
        name: 'issues',
        events: ['issues'],
        secret: 'route-secret',
        prompt: 'Issue #{issue.number}: {issue.title}\n{__raw__}',
        deliver: 'log',
        deliverOnly: false,
      },
    },
    ...overrides,
  };
}

function sign(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('generic webhook adapter', () => {
  it('renders dot-notation templates and raw JSON payloads', () => {
    const payload = { issue: { number: 42, title: 'Fix billing' }, tags: ['bug'] };
    const rendered = renderWebhookTemplate('Issue #{issue.number}: {issue.title}\nTags: {tags}\nMissing: {nope}', payload);
    expect(rendered).toContain('Issue #42: Fix billing');
    expect(rendered).toContain('"bug"');
    expect(rendered).toContain('Missing: {nope}');
    expect(renderWebhookTemplate(undefined, payload)).toContain('"title": "Fix billing"');
  });

  it('validates GitHub, GitLab, and generic webhook signatures', () => {
    const rawBody = '{"ok":true}';
    const digest = sign('secret', rawBody);
    expect(verifyWebhookSignature('secret', rawBody, { 'x-hub-signature-256': `sha256=${digest}` })).toEqual({
      ok: true,
      kind: 'github',
    });
    expect(verifyWebhookSignature('secret', rawBody, { 'x-gitlab-token': 'secret' })).toEqual({ ok: true, kind: 'gitlab' });
    expect(verifyWebhookSignature('secret', rawBody, { 'x-webhook-signature': digest })).toEqual({ ok: true, kind: 'generic' });
    expect(verifyWebhookSignature('secret', rawBody, { 'x-webhook-signature': 'bad' }).ok).toBe(false);
  });

  it('runs the gateway agent for matching events', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'agent reply', suppressDelivery: false, messages: [] });
    const rawBody = JSON.stringify({ event_type: 'issues', issue: { number: 42, title: 'Fix billing' } });
    const result = await handleWebhookRequest({
      routeName: 'issues',
      rawBody,
      headers: {
        'x-webhook-signature': sign('route-secret', rawBody),
        'x-request-id': 'issues-agent-1',
      },
      config: cfg(),
      model: 'openai:gpt-5.3-codex',
      permissionMode: 'ask',
    });

    expect(result).toMatchObject({ status: 200, body: { status: 'processed', route: 'issues', delivered: false } });
    expect(h.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'webhook',
        target: 'issues',
        prompt: expect.stringContaining('Issue #42: Fix billing'),
      }),
    );
  });

  it('supports direct delivery without an agent run', async () => {
    h.deliverToTarget.mockResolvedValue({ platform: 'telegram', target: 'telegram:111' });
    const rawBody = JSON.stringify({ event_type: 'push', repository: { full_name: 'owner/repo' } });
    const config = cfg({
      routes: {
        deploy: {
          name: 'deploy',
          events: ['push'],
          secret: 'deploy-secret',
          prompt: 'Push to {repository.full_name}',
          deliver: 'telegram:111',
          deliverOnly: true,
        },
      },
    });

    const result = await handleWebhookRequest({
      routeName: 'deploy',
      rawBody,
      headers: {
        'x-github-event': 'push',
        'x-hub-signature-256': `sha256=${sign('deploy-secret', rawBody)}`,
        'x-github-delivery': 'deploy-1',
      },
      config,
      model: 'sonnet',
    });

    expect(result).toMatchObject({ status: 200, body: { status: 'delivered', target: 'telegram:111' } });
    expect(h.runGatewayAgent).not.toHaveBeenCalled();
    expect(h.deliverToTarget).toHaveBeenCalledWith('telegram:111', 'Push to owner/repo', { subject: 'Webhook deploy' });
  });

  it('rejects invalid signatures, ignores unmatched events, and deduplicates delivery ids', async () => {
    const rawBody = JSON.stringify({ event_type: 'issues', issue: { number: 42, title: 'Fix billing' } });
    await expect(
      handleWebhookRequest({
        routeName: 'issues',
        rawBody,
        headers: { 'x-webhook-signature': 'bad' },
        config: cfg(),
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 401 });

    await expect(
      handleWebhookRequest({
        routeName: 'issues',
        rawBody,
        headers: { 'x-webhook-signature': sign('route-secret', rawBody), 'x-event-type': 'push', 'x-request-id': 'ignored-1' },
        config: cfg(),
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'ignored' } });

    h.runGatewayAgent.mockResolvedValue({ text: 'ok', suppressDelivery: false, messages: [] });
    const headers = { 'x-webhook-signature': sign('route-secret', rawBody), 'x-request-id': 'duplicate-1' };
    await handleWebhookRequest({ routeName: 'issues', rawBody, headers, config: cfg(), model: 'sonnet' });
    await expect(handleWebhookRequest({ routeName: 'issues', rawBody, headers, config: cfg(), model: 'sonnet' })).resolves.toMatchObject({
      status: 200,
      body: { status: 'duplicate' },
    });
  });

  it('detects common event headers and payload fields', () => {
    expect(webhookEventType({ 'x-github-event': 'pull_request' }, {})).toBe('pull_request');
    expect(webhookEventType({}, { object_kind: 'merge_request' })).toBe('merge_request');
  });
});
