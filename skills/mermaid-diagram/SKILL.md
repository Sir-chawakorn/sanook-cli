---
name: mermaid-diagram
description: Turn requirements, code, or a system description into validated Mermaid diagrams (flowchart, sequence, class, ER, state, C4, Gantt, mindmap, git graph) and verify they render via mermaid-cli before delivering.
when_to_use: User asks to diagram/visualize a flow, architecture, data model, state machine, or sequence; needs a chart embedded in docs/markdown; "draw me the flow of X". Skip when the user wants an image edited or a non-Mermaid format (e.g. raw SVG, PlantUML, Graphviz/DOT) — those are different tools.
---

## When to Use

Trigger when the intent is "show this as a diagram" and the target is Mermaid (renders natively in GitHub, GitLab, Obsidian, VS Code, most docs). Map intent → diagram type up front; picking wrong wastes a render cycle:

| Intent / phrasing | Diagram type | Header keyword |
|---|---|---|
| Steps, branches, "the flow of X", decision logic | flowchart | `flowchart TD` / `LR` |
| Actors talking over time, API calls, request/response | sequence | `sequenceDiagram` |
| DB schema, tables + relations + cardinality | ER | `erDiagram` |
| OOP model, types, fields, inheritance | class | `classDiagram` |
| Lifecycle, status machine, "states of an order" | state | `stateDiagram-v2` |
| System / container / service boundaries | C4 | `C4Context` / `C4Container` |
| Timeline, project phases, dependencies-over-time | gantt | `gantt` |
| Hierarchy of ideas, brainstorm tree | mindmap | `mindmap` |
| Branch/merge history | git graph | `gitGraph` |

If unsure between flowchart and sequence: **does order-of-time + who-does-what matter?** yes → sequence, no → flowchart.

## Steps

1. **Read the source of truth, don't guess.** If diagramming code, open the actual files/functions and trace real control flow, call edges, or schema — not an assumed design. For ER/class, pull field names and FKs from the real schema/models.
2. **Pick the type** from the table above and the direction. Default `flowchart TD` (top-down) for processes; `LR` (left-right) when there are many sequential steps (wide reads better than tall).
3. **Write the Mermaid source to a temp file**, e.g. `/tmp/diagram.mmd` — do not hand-build it inline; you need a file to validate.
4. **Validate by rendering** — this is non-negotiable, a diagram that doesn't parse is a failure:
   ```bash
   npx -y @mermaid-js/mermaid-cli@latest -i /tmp/diagram.mmd -o /tmp/diagram.svg
   ```
   - First run downloads the package; that's expected. If `mmdc` is already on PATH, use it directly: `mmdc -i in.mmd -o out.svg`.
   - On headless/CI or if Chromium fails to launch, add a puppeteer config: write `{"args":["--no-sandbox"]}` to `/tmp/pp.json` and append `-p /tmp/pp.json`.
   - SVG is the cheapest/fastest output for a syntax check. Use `-o out.png` only if the user wants a raster image.
5. **If it fails, fix the root cause and re-render.** Read the parser error (it gives a line/token), correct the syntax, run step 4 again. Loop until it renders clean. Never "soften" by deleting the failing node or wrapping problem text — fix the actual syntax (see Common Errors).
6. **Tighten for readability** before delivery: short node labels (offload detail to surrounding prose), `subgraph` to group related nodes, consistent edge labels, and a sane direction. A correct-but-unreadable diagram still fails the task.
7. **Deliver as a fenced ```mermaid block** ready to paste into markdown/Obsidian. Do not deliver the SVG path as the answer unless the user explicitly asked for an image file — the fenced source is the product.

## Common Errors

- **Parens/brackets/quotes inside a label break the parser.** `A[Fetch (cached)]` fails. Wrap the whole label in double quotes: `A["Fetch (cached)"]`. Same fix for `:`, `;`, `#`, `&`, `<`, `>`, `/`.
- **HTML in labels needs `<br/>` not `\n`.** Newlines inside a node use `A["Line one<br/>Line two"]`. A literal `\n` renders as text.
- **Reserved word `end`** as a lowercase node id silently corrupts flowcharts. Use `End`, `END`, or `e_end`.
- **Sequence diagrams: declare or imply participants consistently.** Mixing `participant A as Auth` then referring to `Auth` later (the alias, not the id) breaks. Reference the **id** in arrows, the alias is display-only.
- **ER cardinality syntax is strict:** `USER ||--o{ ORDER : places` (one-to-many). Common crash is using `1` / `*` instead of the `||`, `o{`, `}o`, `|{` tokens.
- **C4 diagrams need the right header** (`C4Context`, `C4Container`, `C4Component`) and `Rel(a, b, "label")` — they do NOT use flowchart arrow syntax. Don't mix the two grammars.
- **`gantt` dates must be ISO** (`YYYY-MM-DD`) and need a `dateFormat` line; freeform dates fail.
- **`%%` is the comment marker, not `//` or `#`.** A stray `//` comment is parsed as a node and throws.
- **`graph` is the legacy keyword; prefer `flowchart`.** Both parse, but `flowchart` gets newer features (e.g. `&` chaining). Don't mix dialects in one block.
- **Indentation matters in `mindmap`** — it's whitespace-structured like YAML, not bracket-structured. Inconsistent indent = wrong tree.

## Verify

Done only when ALL hold:
- [ ] `mmdc`/`npx ... mermaid-cli` exited 0 on the final source (an actual render happened — not "it looks right").
- [ ] Diagram type matches the user's intent (flow vs sequence vs schema), not just "a diagram."
- [ ] Every node/edge in the diagram maps to something real in the source code/spec — no invented steps, no dropped branches.
- [ ] Labels are concise and the layout direction reads cleanly; groups use `subgraph` where it reduces crossing edges.
- [ ] Delivered as a copy-paste-ready ```mermaid fenced block (plus the image path only if an image was requested).
