---
tags: [context-pack, coding, release, verification]
note_type: context-pack
created: 2026-06-17
updated: 2026-06-17
parent: "[[Shared/Context-Packs/_Index]]"
---

# Context Pack: Coding & Release Work

> Use when changing source code, tests, build/release behavior, CLI commands, or scripts that affect runtime behavior.

## Load Order

1. [[Shared/AI-Context-Index]]
2. [[Runbooks/ai-second-brain-operating-sequence]]
3. [[Shared/Tech-Standards/verification-standard]]
4. Relevant project/source files
5. Relevant tests
6. [[Evals/second-brain-benchmarks]] only if the change affects AI/vault framework

## Required Role

- Primary: Operator
- Secondary: Scientist

## Verification Menu

Pick the narrowest set that proves the change:

- targeted test
- full test suite
- typecheck
- build
- smoke command
- diff/scan gate

## Output Artifacts

- Code/test/docs changes
- Short owner-facing summary with verification
- Session log if the work is non-trivial or changes durable framework behavior

## Done Criteria

- Source read before editing
- Tests or explicit unable-to-run note
- No destructive command without owner approval
- Residual risk stated if verification is partial

up:: [[Shared/Context-Packs/_Index]]
