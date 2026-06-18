---
tags: [standard, mcp, integration, roadmap]
note_type: standard-reference
created: 2026-06-18
updated: 2026-06-18
parent: "[[Shared/Tech-Standards/_Index]]"
source:
  - "[[Research/2026-06-18-sanook-mcp-ecosystem-and-ux-roadmap]]"
---

# MCP Integration Roadmap

> Technical roadmap for making MCP easier and safer to use inside Sanook CLI.

## Current Baseline

- `src/mcp.ts` supports stdio MCP and remote Streamable HTTP.
- `src/mcp-server.ts` exposes Sanook's brain as an MCP server.
- `src/bin.ts` supports `mcp add/list/remove`, `mcp serve`, registry-backed `mcp search/info/install`, curated `mcp preset`, and `mcp test/doctor`.
- `src/mcp-registry.ts` maps official registry remotes/packages into Sanook `mcp.json`.
- Project MCP config remains behind `sanook trust`.

## Target UX

```text
sanook mcp search github
sanook mcp info com.gitlab/mcp
sanook mcp install com.gitlab/mcp --name gitlab
sanook mcp test gitlab
sanook mcp doctor
```

## P0 Requirements

1. Registry search - implemented
   - Query official registry.
   - Show latest versions only by default.
   - Show server name, description, version, transport, package runtime, and source URL.
2. Server info - implemented
   - Show remotes/packages.
   - Show required env/header inputs.
   - Mark secret inputs.
   - Show install command preview.
3. Install - implemented
   - Convert selected remote/package into Sanook `mcp.json`.
   - Write explicit user-requested config only.
   - Preserve `0600` permissions.
   - Never inherit ambient provider API keys into MCP child env.
4. Test - implemented
   - Initialize one server.
   - Run `tools/list`.
   - Report tool count and tool names.
   - Print clear failure reason and setup hints.

## P1 Requirements

- `sanook mcp doctor`: validate config shape, missing commands, missing env, unreachable remote, duplicate tool names.
- `sanook mcp list --tools`: grouped tools by server.
- `sanook mcp remove` should support exact server names and show config path.
- Support `--project` install only if project is trusted.
- Add auth hints when hosted remotes return `401 Unauthorized`.
- Add registry result caching and risk labels for write-capable servers.

## Safety Policy

- Default to read-only where a server offers read-only or scoped modes.
- Show risk class before enabling:
  - read-only
  - file-write
  - network-write
  - database-write
  - infra/admin
- Dangerous servers must remain subject to existing approval gates in ask mode.
- Do not run package installs implicitly during `search` or `info`.
- For package metadata with `fileSha256`, verify downloaded MCPB packages before running.

## First Presets

| Preset | Servers to consider | Use case |
|---|---|---|
| `dev` | GitHub/GitLab, Sentry, Context7/docs | coding, PRs, releases, error debugging |
| `research` | fetch, Brave/web search, docs, Obsidian/GDrive | grounded external research |
| `pm` | Linear/Jira, Slack/Discord, Notion | task and team workflows |
| `ops` | Postgres read-only, Docker/Kubernetes, Sentry | operational debugging |

up:: [[Shared/Tech-Standards/_Index]]
