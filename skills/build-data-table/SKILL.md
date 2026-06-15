---
name: build-data-table
description: Builds production data grids that stay fast and accessible at 10k–1M+ rows — decide server-side vs client-side sort/filter/paginate by the dataset-fits-in-memory test (client only under ~10k rows, otherwise push to the API and treat the table as a controlled view of server state), ROW-VIRTUALIZE with TanStack Virtual or react-window so only the visible window mounts (fixed estimateSize, overscan 5–10, measureElement for dynamic rows, contain:strict, and a real scroll container — never table-layout:auto over thousands of rows), build the headless logic with TanStack Table v8 (or AG Grid when you need pinning/grouping/enterprise out of the box), add column resize/reorder/pin, inline edit with optimistic update + rollback on error, row selection with a stable rowId, full keyboard nav with roving tabindex over an ARIA grid (role=grid/row/gridcell, aria-sort, aria-rowcount/aria-rowindex so virtualization stays announced), position:sticky headers, streaming CSV export that doesn't block the main thread, and explicit empty/loading-skeleton/error/no-results states.
when_to_use: Building a sortable/filterable/paginated table, an editable grid, or any list that must render thousands+ of rows without jank — virtualization, column pin/resize/reorder, inline edit, keyboard grid nav, or CSV export. Distinct from build-react-component (scaffolds one component's props/server-vs-client boundary; this is the full grid subsystem) and design-api-pagination (defines the backend cursor/keyset paging contract; this consumes it for server-side mode) — and from optimize-react-rerenders (fixes wasted renders in general React; this owns the table-specific row-memoization + virtualization).
---

## When to Use

Reach for this skill when you're building a real data grid, not a static `<table>`:

- "Make this table sortable/filterable and paginated" — and decide server vs client
- "The table janks / freezes scrolling 50k rows" → you need virtualization
- "Let users resize, reorder, and pin columns; persist the layout"
- "Inline-edit a cell and save it optimistically with rollback on failure"
- "Add row selection (checkboxes, select-all-across-pages) and bulk actions"
- "Make the grid keyboard-navigable and screen-reader accessible (ARIA grid)"
- "Export the current (filtered/sorted) view to CSV"

NOT this skill:
- Scaffolding a single component's props contract / Server-vs-Client boundary, not a grid subsystem → build-react-component
- The backend list endpoint's cursor/keyset contract, page_size caps, `{data,next_cursor,has_more}` envelope → design-api-pagination (this skill *consumes* that contract in server-side mode)
- Generic "why is React re-rendering" wasted-render diagnosis outside the table → optimize-react-rerenders (this owns only the row/cell memoization the grid needs)
- Wiring TanStack Query caching/mutations/optimistic infra in general → manage-client-server-state (this skill calls into it for the data layer)
- A spreadsheet with formulas/multi-sheet/cell-range math → build-spreadsheet (a grid is read-mostly tabular UI, not a calc engine)
- Field-level form rules across a `<form>` (not per-cell inline edit) → build-form-validation
- Deep WCAG audit of the finished UI → audit-accessibility-wcag (this skill builds the grid a11y baseline it then verifies)
- Charts/heatmaps from the data → write-data-viz; cleaning/reshaping the rows before display → wrangle-tabular-data
- Live-updating rows over a socket → build-realtime-channel feeds this grid; merge into rows keyed by stable id

## Steps

1. **Decide server-side vs client-side FIRST — it changes the whole architecture.** The test is "does the full dataset fit in memory and stay responsive to filter/sort in the browser?"

   | | Client-side | Server-side |
   |---|---|---|
   | Row count | ≲ 10k (hard ceiling ~50k) | 10k → millions |
   | Sort/filter/paginate | in JS, instant | the API does it; table is a *controlled view* |
   | Source of truth | the loaded array | the server query (sort/filter/page in the request) |
   | TanStack flag | `getSortedRowModel`, `getFilteredRowModel`, `getPaginationRowModel` | `manualSorting/manualFiltering/manualPagination: true` + `pageCount`/`rowCount` |

   In server-side mode, debounce filter input (~300ms), send `sort`, `filter`, and the **cursor** (from design-api-pagination — keyset, not OFFSET) to the API, and keep table state controlled (`state={{ sorting, columnFilters, pagination }}` + `onSortingChange` etc.). Never load 200k rows to filter client-side "because it's simpler" — it OOMs the tab.

2. **Virtualize rows whenever you render more than ~100 at once — this is non-negotiable for big grids.** Mounting 10k `<tr>` nodes blows the DOM budget and kills scroll. Use **TanStack Virtual** (`@tanstack/react-virtual`, framework-agnostic, the default) or **react-window** (lighter, fixed/variable list). Only the visible window + overscan mounts.

   ```tsx
   const rowVirtualizer = useVirtualizer({
     count: rows.length,
     getScrollElement: () => scrollRef.current,
     estimateSize: () => 36,        // measured row height in px
     overscan: 8,                   // render 8 extra each side; smooths fast scroll
     measureElement: el => el.getBoundingClientRect().height, // only if rows vary
   });
   // render: a tall spacer div (totalSize) + absolutely-positioned visible rows
   ```

   Rules: give the scroll container a **fixed height** and `overflow:auto`; set `contain: strict` (or `layout paint`) on it; use `transform: translateY()` for row offset, not `top`. Do **not** use a native `<table>` with `table-layout:auto` over thousands of rows — the browser re-measures every column on each row; switch to `display:grid`/explicit `<col>` widths or `table-layout:fixed`. For dynamic row heights, `measureElement` + `data-index`; expect a one-frame jump unless you pre-measure.

3. **Build the logic headless with TanStack Table v8; pick AG Grid only when you need its enterprise features turned-key.** TanStack Table is *headless* — it computes models, you render every DOM node (full control, ~14kb, pairs with Virtual). Define columns with `createColumnHelper<Row>()` for type-safe accessors:

   ```tsx
   const col = createColumnHelper<Person>();
   const columns = [
     col.accessor('name', { header: 'Name', enableSorting: true }),
     col.accessor('amount', { cell: c => fmtMoney(c.getValue()), enableColumnFilter: true }),
   ];
   const table = useReactTable({ data, columns, getRowId: r => r.id,
     getCoreRowModel: getCoreRowModel() });
   ```

   Choose **AG Grid** instead when you need row grouping/tree data, pivoting, built-in column pinning + Excel export, or a million-row server-row-model without hand-rolling it — it ships those, but it's heavier and styling is its own system. Don't reach for a styled mega-component (`<DataGrid>` Material/MUI X) if you need fine control; you'll fight it.

4. **Column resize / reorder / pin — wire the table's column features and persist the layout.** TanStack: `enableColumnResizing: true` + `columnResizeMode:'onChange'` (live) vs `'onEnd'` (commit on mouseup, cheaper); read width via `header.getSize()` and apply with CSS vars so resizing doesn't re-render every cell. Reorder = drag the header and reorder `columnOrder` state (use the table's `setColumnOrder`; a `dnd-kit` sortable context for the drag). **Pin** with `column.getIsPinned()` + `position: sticky; left: <accumulated width>; z-index` and a shadow on the last pinned column. Persist `{columnOrder, columnSizing, columnPinning, columnVisibility}` to localStorage (or the user profile) keyed by table id and rehydrate as initial state.

5. **Inline edit = optimistic update + rollback, never block on the network.** On commit (Enter / blur), write the new value into the cached rows immediately, fire the mutation, and roll back on error. With TanStack Query:

   ```tsx
   useMutation({ mutationFn: patchCell,
     onMutate: async (next) => {
       await qc.cancelQueries({ queryKey });
       const prev = qc.getQueryData(queryKey);
       qc.setQueryData(queryKey, patch(prev, next)); // optimistic
       return { prev };
     },
     onError: (_e, _v, ctx) => qc.setQueryData(queryKey, ctx.prev), // rollback
     onSettled: () => qc.invalidateQueries({ queryKey }),
   });
   ```

   Edit mode: single cell, `aria-readonly` off, focus the input, Esc cancels, Enter commits + moves down, Tab moves right. Validate per-cell before the optimistic write (type/range); show the error inline and keep the old value. This is the per-cell case — multi-field `<form>` rules belong to build-form-validation.

6. **Row selection: use a stable `getRowId` and decide select-all semantics.** TanStack `enableRowSelection`, state `rowSelection: Record<rowId, boolean>` — keyed by **your row id**, not the index, so selection survives sort/filter/page. The header checkbox has three states (none/some/all) via `table.getIsSomePageRowsSelected()` → `indeterminate`. Critical decision: "select all" = **current page** or **entire matching dataset**? In server-side mode you can't select rows you haven't loaded — implement "select all N matching" as a *predicate* (the active filter) sent to the bulk endpoint, not a list of ids, and show "All 4,213 selected" with a clear-selection affordance.

7. **Keyboard nav + ARIA grid — roving tabindex over a real grid role, virtualization-aware.** A data grid is **one tab stop**: the container/active cell has `tabindex=0`, every other cell `tabindex=-1`; arrow keys move the active cell and move the `0`. Roles: container `role="grid"`, rows `role="row"`, cells `role="gridcell"`, header cells `role="columnheader"` with `aria-sort="ascending|descending|none"`. Because virtualization removes off-screen rows from the DOM, **you must** set `aria-rowcount={totalRows}` on the grid and `aria-rowindex` (1-based, header = 1) on every rendered row, and `aria-colcount`/`aria-colindex` for horizontally virtualized columns — otherwise SRs announce "row 12 of 30" instead of "of 50000". Key map:

   | Key | Action |
   |---|---|
   | ↑ ↓ ← → | move active cell |
   | Home / End | first / last cell in row |
   | Ctrl+Home / Ctrl+End | first / last cell in grid |
   | PageUp / PageDown | scroll a viewport of rows (and move focus) |
   | Enter / F2 | enter edit mode; Esc exits |
   | Space | toggle row selection |

   When focus moves to a virtualized row that's scrolled out, call `rowVirtualizer.scrollToIndex(i)` before focusing so the node exists. Sort headers must be operable with Enter/Space and update `aria-sort`. Deep WCAG conformance → audit-accessibility-wcag.

8. **Sticky headers (and sticky pinned columns) with `position: sticky`.** Header row: `position: sticky; top: 0; z-index: 2` inside the scroll container (sticky is scoped to the nearest scrolling ancestor — the header must live *inside* the same `overflow:auto` element as the rows, not above it). Pinned column cells: `sticky; left: 0; z-index: 1`; the top-left corner (sticky header + pinned col) needs the higher `z-index`. Give sticky cells an opaque `background` (transparent sticky cells show rows bleeding through) and a bottom/right `box-shadow` so the freeze line reads.

9. **CSV export of the *current view*, off the main thread for large sets.** Export reflects the active sort/filter/column-visibility, not the raw data. Build CSV correctly: quote fields containing `, " \n`, double internal quotes (`"a ""b"" c"`), prefix the file with `﻿` (UTF-8 BOM) so Excel reads UTF-8, and **defend against CSV injection** — prefix any cell starting with `= + - @ \t \r` with a `'` (formula-injection in spreadsheets). For server-side / huge datasets, hit a streaming export endpoint (the server pages with the keyset cursor and streams rows) or generate in a Web Worker + `Blob` so a 100k-row export doesn't freeze the UI; trigger download via an object URL.

10. **Every grid has four states — design them, don't default to a blank box.** *Loading* → skeleton rows matching column widths (not a centered spinner; preserves layout, no shift). *Empty* (no data exists yet) → illustration + primary action ("Add your first record"). *No results* (filters exclude everything) → "No matches" + a **Clear filters** button (distinct from empty — the fix differs). *Error* → message + Retry that refires the query, keeping prior data visible if you have it. In server-side infinite scroll, show a row-level loading sentinel at the bottom and an error row with retry, not a full-table swap.

## Common Errors

- **Rendering all rows, then "optimizing" later.** 10k `<tr>` is already janky; virtualize from the start (step 2). Bolting it on after layout/CSS assumes a normal `<table>` is the biggest rewrite.
- **Client-side sort/filter on a server-scale dataset.** Loading 100k+ rows to filter in JS OOMs the tab and waterfalls. Use `manualSorting/Filtering/Pagination` + the paged API (step 1).
- **`<table>` with `table-layout:auto` over thousands of rows.** The browser re-measures every column per row → quadratic. Use `table-layout:fixed` / `display:grid` with explicit widths (step 2).
- **Selection/edit keyed by row index.** Sort or filter and the wrong rows are selected/edited. Key by a stable `getRowId` (steps 5–6).
- **No `aria-rowcount`/`aria-rowindex` with virtualization.** SR announces the rendered window ("12 of 30"), not the real total. Set them from the full count (step 7).
- **Every cell in the tab order.** Tabbing through 50 columns × visible rows is unusable. One tab stop + roving tabindex + arrow keys (step 7).
- **Sticky header outside the scroll container.** `position:sticky` only sticks within its scrolling ancestor — a header above the `overflow:auto` div won't stick. Put it inside (step 8).
- **Transparent sticky/pinned cells.** Rows show through the frozen header/column. Opaque background + shadow (step 8).
- **Inline edit that awaits the server before updating UI.** Feels broken on slow networks. Optimistic write + rollback on error (step 5).
- **CSV without quoting / injection guard.** Commas/newlines corrupt columns; a cell starting `=cmd|...` executes in Excel. Quote + escape + prefix dangerous leading chars + BOM (step 9).
- **Exporting raw data instead of the current view.** Users expect the filtered/sorted/visible columns they see. Export from the table's current row model (step 9).
- **One "no data" state for both empty and filtered-out.** Users can't tell "nothing exists" from "filters hide everything." Split them; give no-results a Clear-filters button (step 10).
- **Re-creating `columns`/`data` inline each render.** New array identity busts memoization and re-runs every row model. Define `columns` module-level or `useMemo`, keep `data` referentially stable (defer deep render perf to optimize-react-rerenders).

## Verify

1. **Scale:** load the target row count (10k / 100k) and scroll fast top-to-bottom — DOM node count stays bounded (only window + overscan in the inspector), no dropped frames.
2. **Server mode:** sort/filter/page issue new API requests with the right params (keyset cursor, not OFFSET); the table never holds the full dataset; filter input is debounced.
3. **Columns:** resize, reorder, pin, hide — layout holds, pinned columns freeze with a shadow, and the layout persists across reload.
4. **Inline edit:** commit shows the new value instantly; force the mutation to fail → it rolls back to the old value and surfaces an error; Esc cancels, Enter advances.
5. **Selection:** select rows, then sort/filter/page → the *same* rows stay selected (id-keyed); header checkbox shows indeterminate; "select all matching" sends a predicate, not loaded ids.
6. **Keyboard:** Tab reaches the grid once; arrows/Home/End/Ctrl+Home move the active cell; focusing a scrolled-out row scrolls it into view first; sort headers fire on Enter/Space.
7. **A11y:** screen reader announces `role=grid`, column headers with `aria-sort`, and the **real** total via `aria-rowcount` (not the virtualized window); run audit-accessibility-wcag for full conformance.
8. **Sticky:** header stays pinned on vertical scroll, pinned columns on horizontal scroll, corner z-index correct, no bleed-through.
9. **Export:** CSV of a filtered+sorted view opens in Excel with UTF-8 intact, fields with commas/quotes/newlines are correct, a `=`-leading cell is neutralized, and a 100k-row export doesn't freeze the tab.
10. **States:** empty, no-results (with Clear-filters), loading skeleton, and error (with Retry) each render distinctly and the error path recovers.

Done = the grid renders the target scale without jank (virtualized, bounded DOM), sort/filter/paginate run server-side for large datasets against the keyset API, columns resize/reorder/pin and persist, inline edit is optimistic with rollback, selection and edit are id-stable, the grid is one keyboard tab stop with a correct ARIA grid (rowcount/rowindex aware of virtualization), headers and pinned columns stick opaquely, CSV export of the current view is correctly quoted + injection-safe, and all four data states are designed — all proven by checks 1–10.
