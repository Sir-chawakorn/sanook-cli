---
tags: [research, mcp, sanook-cli, integration, roadmap]
note_type: research
created: 2026-06-18
updated: 2026-06-18
parent: "[[Research/_Index]]"
source:
  - https://registry.modelcontextprotocol.io/openapi.json
  - https://registry.modelcontextprotocol.io/v0/servers
  - https://registry.modelcontextprotocol.io/v0/version
  - https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
  - https://modelcontextprotocol.io/specification/2025-06-18/server/tools
related:
  - "[[Shared/Tech-Standards/mcp-integration-roadmap]]"
---

# 2026-06-18 - Sanook MCP Ecosystem and UX Roadmap

> Research snapshot for how Sanook CLI currently handles MCP, what the official MCP registry exposes, and which integrations would make Sanook easier to use.

## Current Sanook MCP State

Sanook already has a strong MCP foundation:

- MCP client: `src/mcp.ts`
  - Loads global `~/.sanook/mcp.json`.
  - Loads project `.sanook/mcp.json` only after project trust.
  - Supports stdio via `command` + `args`.
  - Supports remote Streamable HTTP via `url` + `headers`.
  - Sanitizes server names.
  - Sends minimal safe env to child MCP servers and only passes explicit `cfg.env`.
  - Caps MCP tool output.
  - Merges MCP tools into the main agent as `<server>__<tool>`.
- MCP server: `src/mcp-server.ts`
  - `sanook mcp serve` exposes `sanook_search`, `sanook_recall`, `sanook_remember`, `sanook_index`, and `sanook_stats`.
  - Uses stdio JSON-RPC and keeps stdout protocol-clean.
- CLI management: `src/bin.ts`
  - `sanook mcp add <name> <command> [args...]`
  - `sanook mcp add <name> https://host/mcp`
  - `sanook mcp list`
  - `sanook mcp remove <name>`

Main gap: Sanook can run MCP servers, but users still need to know the exact package, args, secrets, and safe configuration shape themselves.

## Registry Findings

The official registry API is available and healthy:

- `GET /v0/version` returned registry `1.7.9`, build time `2026-05-12T21:05:57Z`.
- `GET /v0/health` returned `status: ok`.
- OpenAPI exposes list/get/validate/publish/status endpoints under `/v0` and `/v0.1`.
- Server entries include:
  - `server.name`, `description`, `version`, `repository`, `websiteUrl`
  - `remotes` with `type: streamable-http` or `sse`
  - `packages` with `registryType`, `identifier`, `version`, `runtimeHint`, `transport`
  - `environmentVariables`, `headers`, `packageArguments`, `runtimeArguments`
  - `isRequired`, `isSecret`, `format`, `placeholder`, and default values for setup UX
  - metadata such as `isLatest`

This means Sanook can build a first-class MCP installer without hardcoding every server.

## High-Value MCP Categories for Sanook

| Category | Examples seen in registry | Why it matters for Sanook |
|---|---|---|
| Code hosting | GitLab official remote, GitHub variants | PRs/issues/releases/repo operations. |
| Local/cloud files | Filesystem variants, remote GCS filesystem | Safer file access outside the workspace, cloud artifacts. |
| Databases | Postgres, SQLite | Data inspection for app/debug workflows; should default read-only. |
| Project management | Linear, Jira | Turn user tasks into issue-backed work loops. |
| Observability | Sentry | Debug production errors from real issue/event context. |
| Browser/web | Playwright, Browserbase, fetch, Brave/web search | JS-rendered pages, docs extraction, web research. |
| Team/chat | Slack, Discord | Team context and delivery/notification workflows. |
| Knowledge/workspace | Notion, Gmail, Google Drive, Obsidian | Import user knowledge into second-brain workflows. |
| Docs/versioned knowledge | Context7-like docs servers | Better library/API grounding without broad web search. |
| Infrastructure | Docker, Kubernetes variants | Ops/debug workflows, but needs strict approval gates. |

## Recommended Sanook UX Improvements

### P0: Discover / Install / Test

Add registry-backed commands:

```text
sanook mcp search <query>
sanook mcp info <server-name>
sanook mcp install <server-name> [--name alias]
sanook mcp test [name]
```

Expected behavior:

- `search` calls the official registry, filters latest versions, and shows transport/package choices.
- `info` shows description, repo, remotes/packages, required env/header secrets, and risk class.
- `install` converts registry metadata to `~/.sanook/mcp.json`.
- `test` initializes the server and lists tools without starting an agent turn.

### P1: Setup Wizard from Registry Metadata

Use `environmentVariables` and `headers`:

- prompt for required secrets without echoing them
- support `--env KEY=value` and `--header KEY=value`
- store secrets explicitly only in `~/.sanook/mcp.json`, not inherited process env
- show a redacted preview before write

### P1: Safer Capability Review

After install/test, print:

- transport: stdio / remote HTTP
- package runtime: `npx`, `uvx`, Docker, remote
- number of tools
- tool names
- risk class:
  - read-only
  - file-write
  - network-write
  - database-write
  - infra/admin

Then let users enable dangerous servers intentionally.

### P2: Preset Packs

Sanook can ship curated packs:

```text
sanook mcp preset dev
sanook mcp preset research
sanook mcp preset pm
sanook mcp preset ops
```

Suggested presets:

- `dev`: GitHub/GitLab, filesystem, Sentry, Context7/docs
- `research`: fetch, Brave/web search, docs, Obsidian/GDrive
- `pm`: Linear/Jira, Slack, Notion
- `ops`: Postgres read-only, Docker/Kubernetes, Sentry

### P2: Tool Discovery in the REPL

Improve `/tools`:

- group MCP tools by server
- show disabled/unreachable servers
- show how to fix missing env/headers
- show source config path: global vs project

## Implementation Notes

Good fit for Sanook's existing code:

- Add a new module `src/mcp-registry.ts`.
- Keep registry parsing pure/testable.
- Do not install from arbitrary registry package metadata without showing command/env first.
- Prefer remote Streamable HTTP when no local runtime is required.
- Prefer read-only database servers by default.
- Keep project `.sanook/mcp.json` behind trust, as today.
- Add tests with mocked fetch and fake MCP servers.

## Suggested First Integrations

For this repo and owner's likely workflows:

1. GitLab official remote or GitHub MCP variant: repo/issues/PRs/releases.
2. Sentry: production debugging and release verification.
3. Linear/Jira: task loop integration if issue tracker is used.
4. Postgres read-only: app data inspection.
5. Context7/docs + fetch/search: better grounded research.
6. Slack/Discord: team/message workflows.
7. Google Drive/Gmail/Notion/Obsidian: knowledge intake into second-brain.

## Open Questions

- Should Sanook store MCP secrets directly in `mcp.json`, or add a redacted secret store under `~/.sanook/secrets.json`?
- Should `sanook mcp install` default to global only, with `--project` requiring trust?
- Should remote OAuth flows be supported directly, or should Sanook only accept bearer tokens/headers first?
- Should dangerous MCP tool groups be disabled until the user runs `sanook mcp enable <name> --write`?

up:: [[Research/_Index]]
