---
tags: [session, session-log, mcp, sanook-cli]
note_type: session-log
created: 2026-06-18
updated: 2026-06-18
parent: "[[Sessions/_Index]]"
ai_surface: history
---

# 2026-06-18 - MCP Ecosystem and Sanook UX Scan

> Session log for reviewing Sanook's MCP support and current MCP registry integration opportunities.

## Summary

- Inspected `src/mcp.ts`, `src/mcp-server.ts`, `src/bin.ts`, `README.md`, and existing MCP tests/docs.
- Queried the official MCP registry API and OpenAPI metadata.
- Identified that Sanook already supports stdio + remote Streamable HTTP and can act as an MCP server.
- Main UX gap: no registry-backed search/info/install/test wizard yet.
- Added [[Research/2026-06-18-sanook-mcp-ecosystem-and-ux-roadmap]] and [[Shared/Tech-Standards/mcp-integration-roadmap]].
- Implemented the P0 MCP UX inside Sanook CLI: registry search/info/install, presets, list/test/doctor probing, docs, and tests.
- Verified local stdio MCP probing works; official GitLab remote installs from registry but returns `401 Unauthorized` without an auth header.

## What Was Tried

- Checked current MCP code paths with `rg`.
- Read MCP client/server implementation.
- Queried registry endpoints:
  - `https://registry.modelcontextprotocol.io/v0/version`
  - `https://registry.modelcontextprotocol.io/v0/health`
  - `https://registry.modelcontextprotocol.io/v0/servers?...`
  - `https://registry.modelcontextprotocol.io/openapi.json`
- Sampled registry search terms: GitHub, GitLab, Postgres, SQLite, filesystem, Slack, Discord, Notion, Linear, Jira, Sentry, Playwright, browser, Gmail, Drive, Obsidian, Context7, fetch, Brave, Docker, Kubernetes.

## Errors

- Initial unquoted `curl` query with `?limit=8` was expanded by zsh; quoted URL fixed it.
- Mintlify HTML docs are noisy for terminal extraction; the registry OpenAPI and API responses were more useful as machine-readable evidence.

## Solutions

- Used quoted registry URLs.
- Used the registry OpenAPI for endpoint/field shape.
- Captured a Sanook-specific roadmap instead of implementing a large installer in the research turn.
- Added `src/mcp-registry.ts` for official registry parsing and install-plan generation.
- Added `sanook mcp search`, `info`, `install`, `preset`, `test`, `doctor`, and `list --tools`.
- Kept unit tests network-free; live registry smoke was run separately against built `dist/bin.js`.
- Smoke result: `mcp search/info/install/list` worked against the official registry; a fake stdio MCP server passed `mcp test`; GitLab remote probe failed with `401 Unauthorized` until a token/header is supplied.

## Key Decisions

- Next best implementation should be `sanook mcp search/info/install/test`, not another hardcoded list.
- Use registry metadata for env/header prompts and secret handling.
- Keep project-local MCP behind `sanook trust`.
- Prefer read-only / remote Streamable HTTP defaults where available.
- Do not make the regular test suite depend on the live registry.
- Preserve manual `--header` support because some registry entries do not yet declare required auth metadata.

## Files Changed

- `second-brain/Research/2026-06-18-sanook-mcp-ecosystem-and-ux-roadmap.md`
- `second-brain/Shared/Tech-Standards/mcp-integration-roadmap.md`
- `second-brain/Shared/Tech-Standards/_Index.md`
- `second-brain/Research/_Index.md`
- `second-brain/Sessions/_Index.md`
- `second-brain/Sessions/2026-06-18-mcp-ecosystem-and-sanook-ux-scan.md`
- `src/mcp-registry.ts`
- `src/mcp-registry.test.ts`
- `src/mcp.ts`
- `src/mcp.test.ts`
- `src/bin.ts`
- `README.md`
- `CHANGELOG.md`

## Next Steps

- Improve auth hints for hosted MCPs that return `401` but do not declare header requirements in registry metadata.
- Add risk labels / read-write warnings before installing high-impact servers.
- Consider registry result caching and richer install previews.

up:: [[Sessions/_Index]]
