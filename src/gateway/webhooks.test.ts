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

  it('does not spend rate-limit quota on invalid signatures', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'ok', suppressDelivery: false, messages: [] });
    const rawBody = JSON.stringify({ event_type: 'issues', issue: { number: 7, title: 'Limit check' } });
    const config = cfg({
      rateLimitPerMinute: 30,
      routes: {
        limited: {
          name: 'limited',
          events: ['issues'],
          secret: 'route-secret',
          prompt: 'Issue #{issue.number}: {issue.title}',
          deliver: 'log',
          deliverOnly: false,
          rateLimitPerMinute: 1,
        },
      },
    });

    await expect(
      handleWebhookRequest({
        routeName: 'limited',
        rawBody,
        headers: { 'x-webhook-signature': 'bad', 'x-request-id': 'limited-bad-1' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 401 });

    await expect(
      handleWebhookRequest({
        routeName: 'limited',
        rawBody,
        headers: { 'x-webhook-signature': sign('route-secret', rawBody), 'x-request-id': 'limited-valid-1' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'processed' } });

    await expect(
      handleWebhookRequest({
        routeName: 'limited',
        rawBody,
        headers: { 'x-webhook-signature': sign('route-secret', rawBody), 'x-request-id': 'limited-valid-2' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('does not spend rate-limit quota on ignored events', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'ok', suppressDelivery: false, messages: [] });
    const config = cfg({
      routes: {
        ignoredLimit: {
          name: 'ignoredLimit',
          events: ['issues'],
          secret: 'route-secret',
          prompt: 'Issue #{issue.number}: {issue.title}',
          deliver: 'log',
          deliverOnly: false,
          rateLimitPerMinute: 1,
        },
      },
    });
    const ignoredBody = JSON.stringify({ event_type: 'push', issue: { number: 9, title: 'Ignored check' } });
    const acceptedBody = JSON.stringify({ event_type: 'issues', issue: { number: 9, title: 'Accepted check' } });

    await expect(
      handleWebhookRequest({
        routeName: 'ignoredLimit',
        rawBody: ignoredBody,
        headers: { 'x-webhook-signature': sign('route-secret', ignoredBody), 'x-request-id': 'ignored-limit-1' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'ignored' } });

    await expect(
      handleWebhookRequest({
        routeName: 'ignoredLimit',
        rawBody: acceptedBody,
        headers: { 'x-webhook-signature': sign('route-secret', acceptedBody), 'x-request-id': 'ignored-limit-2' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'processed' } });

    await expect(
      handleWebhookRequest({
        routeName: 'ignoredLimit',
        rawBody: acceptedBody,
        headers: { 'x-webhook-signature': sign('route-secret', acceptedBody), 'x-request-id': 'ignored-limit-3' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('does not spend rate-limit quota on duplicate deliveries', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'ok', suppressDelivery: false, messages: [] });
    const rawBody = JSON.stringify({ event_type: 'issues', issue: { number: 8, title: 'Retry check' } });
    const config = cfg({
      routes: {
        retry: {
          name: 'retry',
          events: ['issues'],
          secret: 'route-secret',
          prompt: 'Issue #{issue.number}: {issue.title}',
          deliver: 'log',
          deliverOnly: false,
          rateLimitPerMinute: 2,
        },
      },
    });
    const signature = sign('route-secret', rawBody);

    await expect(
      handleWebhookRequest({
        routeName: 'retry',
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-request-id': 'retry-duplicate-1' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'processed' } });

    await expect(
      handleWebhookRequest({
        routeName: 'retry',
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-request-id': 'retry-duplicate-1' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'duplicate' } });

    await expect(
      handleWebhookRequest({
        routeName: 'retry',
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-request-id': 'retry-unique-2' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'processed' } });

    await expect(
      handleWebhookRequest({
        routeName: 'retry',
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-request-id': 'retry-unique-3' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('does not mark rate-limited deliveries as duplicates', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'ok', suppressDelivery: false, messages: [] });
    const rawBody = JSON.stringify({ event_type: 'issues', issue: { number: 10, title: 'Rate retry check' } });
    const config = cfg({
      routes: {
        limitedRetry: {
          name: 'limitedRetry',
          events: ['issues'],
          secret: 'route-secret',
          prompt: 'Issue #{issue.number}: {issue.title}',
          deliver: 'log',
          deliverOnly: false,
          rateLimitPerMinute: 1,
        },
      },
    });
    const signature = sign('route-secret', rawBody);

    await expect(
      handleWebhookRequest({
        routeName: 'limitedRetry',
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-request-id': 'limited-retry-1' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'processed' } });

    await expect(
      handleWebhookRequest({
        routeName: 'limitedRetry',
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-request-id': 'limited-retry-2' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 429, body: { error: 'rate_limited' } });

    await expect(
      handleWebhookRequest({
        routeName: 'limitedRetry',
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-request-id': 'limited-retry-2' },
        config,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('does not track deliver-only routes without a delivery target', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'ok', suppressDelivery: false, messages: [] });
    const rawBody = JSON.stringify({ event_type: 'issues', issue: { number: 12, title: 'Target check' } });
    const badConfig = cfg({
      routes: {
        missingTarget: {
          name: 'missingTarget',
          events: ['issues'],
          secret: 'route-secret',
          prompt: 'Issue #{issue.number}: {issue.title}',
          deliver: 'log',
          deliverOnly: true,
          rateLimitPerMinute: 1,
        },
      },
    });
    const signature = sign('route-secret', rawBody);
    const headers = { 'x-webhook-signature': signature, 'x-request-id': 'missing-target-1' };

    await expect(
      handleWebhookRequest({
        routeName: 'missingTarget',
        rawBody,
        headers,
        config: badConfig,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 400, body: { error: 'deliver_only_requires_target' } });

    await expect(
      handleWebhookRequest({
        routeName: 'missingTarget',
        rawBody,
        headers,
        config: badConfig,
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 400, body: { error: 'deliver_only_requires_target' } });

    await expect(
      handleWebhookRequest({
        routeName: 'missingTarget',
        rawBody,
        headers: { 'x-webhook-signature': signature, 'x-request-id': 'missing-target-2' },
        config: cfg({
          routes: {
            missingTarget: {
              name: 'missingTarget',
              events: ['issues'],
              secret: 'route-secret',
              prompt: 'Issue #{issue.number}: {issue.title}',
              deliver: 'log',
              deliverOnly: false,
              rateLimitPerMinute: 1,
            },
          },
        }),
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'processed' } });

    expect(h.runGatewayAgent).toHaveBeenCalledTimes(1);
  });

  it('does not mark failed agent deliveries as duplicates', async () => {
    h.runGatewayAgent
      .mockRejectedValueOnce(new Error('agent exploded'))
      .mockResolvedValueOnce({ text: 'ok', suppressDelivery: false, messages: [] });
    const rawBody = JSON.stringify({ event_type: 'issues', issue: { number: 11, title: 'Failure retry check' } });
    const headers = { 'x-webhook-signature': sign('route-secret', rawBody), 'x-request-id': 'failed-retry-1' };

    await expect(
      handleWebhookRequest({
        routeName: 'issues',
        rawBody,
        headers,
        config: cfg(),
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 500, body: { error: 'agent_failed' } });

    await expect(
      handleWebhookRequest({
        routeName: 'issues',
        rawBody,
        headers,
        config: cfg(),
        model: 'sonnet',
      }),
    ).resolves.toMatchObject({ status: 200, body: { status: 'processed' } });

    expect(h.runGatewayAgent).toHaveBeenCalledTimes(2);
  });

  it('detects common event headers and payload fields', () => {
    expect(webhookEventType({ 'x-github-event': 'pull_request' }, {})).toBe('pull_request');
    expect(webhookEventType({}, { object_kind: 'merge_request' })).toBe('merge_request');
  });
});
