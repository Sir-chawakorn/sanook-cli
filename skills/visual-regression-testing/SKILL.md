---
name: visual-regression-testing
description: Catches unintended UI pixel changes by snapshotting rendered output and diffing against approved baselines — make snapshots deterministic (disable CSS animations/transitions/caret, mask dynamic regions like dates/avatars/ads, freeze the clock and seed randomness, preload+wait for fonts, pin viewport + deviceScaleFactor, force reduced-motion and a fixed color-scheme), generate per-browser/per-OS baselines (never share a Linux baseline with a dev's macOS), tune the diff threshold (maxDiffPixelRatio / anti-alias mode) instead of inflating it to hide flake, run baselines in ONE pinned container so subpixel/font rendering is identical, and wire a human review/approve flow (Playwright --update-snapshots, Chromatic/Percy approve UI) — at component level (isolated, fast) and page level (integration). Effectively a pixel contract: a diff is a question for a human, not an auto-pass.
when_to_use: You want to detect visual UI regressions — a CSS/refactor/dependency bump silently shifted layout/color/spacing, you're adding toHaveScreenshot/Chromatic/Percy/BackstopJS, baselines flake across machines, or you're tuning diff thresholds and the review/approve flow. Distinct from write-playwright-e2e (asserts functional behavior and DOM state, not pixels — this skill is the screenshot-diff layer) and audit-accessibility-wcag (WCAG conformance / contrast / semantics, not whether pixels changed).
---

## When to Use

Reach for this skill when the goal is **detecting unintended pixel/visual changes against an approved baseline**, not functional behavior or a11y conformance:

- "A CSS refactor / Tailwind upgrade / design-token change silently broke a layout somewhere"
- "Add visual regression / screenshot tests to this component library or these pages"
- "Set up Playwright `toHaveScreenshot`, Chromatic, Percy, or BackstopJS"
- "Snapshots flake — they pass on CI but fail on my Mac, or fail randomly"
- "Tune the diff threshold / mask the date+avatar regions / freeze animations"
- "Wire the baseline review-and-approve flow into PRs"

NOT this skill:
- Asserting a button click opens a modal, a form submits, navigation/DOM state, network mocking → write-playwright-e2e (functional E2E; this skill is the screenshot-diff layer that *also* runs on a stabilized page)
- WCAG conformance, contrast ratios, ARIA, keyboard/focus order, screen-reader semantics → audit-accessibility-wcag (correct *semantics*, not whether pixels match a baseline)
- A snapshot/screenshot test that's flaky for timing/ordering reasons → debug-flaky-tests (root-causing nondeterminism in general; this skill prescribes the *visual-specific* stabilizers)
- Structuring the test suite, fixtures, assertions for unit/integration tests → write-tests
- Driving a real browser to manually inspect/debug a rendering bug → debug-frontend-browser
- Catching LCP/CLS/perf regressions (layout shift as a metric, not a pixel diff) → optimize-core-web-vitals
- Defining the tokens (color/space/type scale) whose changes you're guarding → design-token-system

## Steps

1. **Pick the tier by what you own.** Each is a screenshot + perceptual diff against a stored baseline; they differ in where baselines live and review happens.

   | Tool | Baseline storage | Review/approve | Best for |
   |---|---|---|---|
   | **Playwright `toHaveScreenshot`** | git (PNGs committed per project) | `--update-snapshots` + PR diff of `.png` | self-hosted, full control, free; you own the render env |
   | **Chromatic** | cloud (Storybook) | hosted UI, per-story approve, branch baselines | Storybook component libs; turbosnap diffs only changed stories |
   | **Percy (BrowserStack)** | cloud | hosted UI, approve per snapshot | cross-browser cloud render, framework-agnostic SDK |
   | **BackstopLP / BackstopJS** | git/local | `approve` CLI, HTML report | legacy/no-cloud, reference+test+report flow |

   Default to **Playwright `toHaveScreenshot`** when you control the runner (commit baselines, run in a pinned container); reach for **Chromatic/Percy** when you can't pin a render env or want cross-browser cloud baselines without managing them.

2. **Render env is the baseline — pin it or every diff is noise.** Font hinting and subpixel antialiasing differ across OS/GPU, so a macOS-generated PNG will *never* match a Linux CI PNG. Generate and verify baselines in **one** environment:
   - Playwright: pin the Docker image to your exact version — `mcr.microsoft.com/playwright:v1.50.0-noble` — and run *baseline generation and CI in the same image*. Never commit a baseline produced on a dev's machine.
   - Snapshot filenames already encode browser/OS (`button-chromium-linux.png`). Keep that suffix; do **not** force a single platform name to "share" baselines across OSes — generate one baseline per `(browser, platform)` you actually test.
   - `npx playwright test --update-snapshots` locally only via `docker run` in that image, or with a dedicated CI "update baselines" job — so the bytes match CI.

3. **Kill animation and motion before the shot.** A mid-transition frame is the #1 flake source.
   ```ts
   // playwright.config.ts
   expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' } }
   ```
   `animations:'disabled'` finite-CSS-animations are fast-forwarded to their end state and transitions disabled; `caret:'hide'` removes the blinking text cursor; `scale:'css'` ignores DPR so HiDPI vs 1x render the same logical pixels. For motion that CSS can't reach, also inject:
   ```ts
   await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
   await page.addStyleTag({ content: `*,*::before,*::after{transition:none!important;animation:none!important;}` });
   ```

4. **Pin viewport + DPR + color-scheme deterministically.** Layout depends on width; rendering depends on DPR and scheme. Set them explicitly per project, never inherit the runner's screen:
   ```ts
   use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: 'light' }
   ```
   Test responsive breakpoints as **separate named snapshots** (`card-mobile-375.png`, `card-desktop-1280.png`) — don't rely on a default window size. For full-page shots, set `fullPage: true` only when the page height is stable; otherwise prefer clipping a component.

5. **Freeze time, randomness, and anything non-deterministic in content.** "Updated 3 minutes ago", `Math.random()` ids, and animated counters all churn pixels:
   - Clock: Playwright `await page.clock.setFixedTime(new Date('2025-01-01T00:00:00Z'))` (or `page.clock.install`) before navigation, so `Date.now()`/timers are frozen.
   - Seed PRNGs / stub `Math.random` and `crypto.randomUUID` via `addInitScript` so generated ids/charts are stable.
   - Stub network: route API calls to **fixtures** (deterministic data) — a live API means live data means flake. This is where it overlaps with write-playwright-e2e's mocking, but here the goal is *stable pixels*, not asserting a request.

6. **Wait for the page to be visually settled — not just `load`.** Diff what's actually rendered:
   - **Fonts:** a FOUT (fallback → web font swap) changes glyph metrics. `await page.evaluate(() => document.fonts.ready)` before the shot, and self-host/preload fonts so they're not network-flaky.
   - **Lazy images / skeletons:** wait for the specific `<img>` `decode()`/`load`, or assert the skeleton is gone (`await expect(loc).toBeVisible()`), not a blanket `networkidle` (deprecated and flaky).
   - **Layout stability:** `await page.waitForFunction` on a render-complete signal, or `expect(locator).toHaveScreenshot()` which **auto-retries until two consecutive shots match** — lean on that built-in stabilization rather than `waitForTimeout`.

7. **Mask the regions you can't make deterministic — don't widen the threshold to swallow them.** Ads, avatars, timestamps, maps, video, third-party embeds:
   ```ts
   await expect(page).toHaveScreenshot('dashboard.png', {
     mask: [page.locator('.ad-slot'), page.locator('[data-testid="avatar"]')],
     maskColor: '#FF00FF',
   });
   ```
   Masking paints those areas a solid color in both baseline and actual, so they're excluded from the diff while the rest stays pixel-exact. This is strictly better than raising the global threshold, which blinds you to real regressions everywhere.

8. **Tune the threshold tight; treat a loose threshold as a bug.** Two knobs, prefer the pixel-count one:
   - `maxDiffPixelRatio` (fraction of differing pixels, e.g. `0.01`) or `maxDiffPixels` (absolute count) — set as low as your env allows. Start at `0` and raise only to the floor that survives a no-change re-run.
   - `threshold` (per-pixel color sensitivity, 0–1, default `0.2`) — handles antialias jitter; lowering it makes diffs *stricter*.
   - **Anti-pattern:** bumping `maxDiffPixelRatio` to `0.1` to "stop flake." That hides a 9%-of-the-screen regression. Fix the nondeterminism (steps 3–6) instead; reserve a small ratio purely for subpixel antialiasing noise.

9. **Component vs page level — run both, weight toward component.** Component snapshots (Storybook + Chromatic, or Playwright `mount`/component testing) are isolated, fast, and pinpoint *which* component changed; a wall of full-page snapshots is slow and every page that embeds a changed header fails at once (noisy, hard to triage). Use a **pyramid**: many small component/story snapshots, a handful of critical full-page integration snapshots (login, checkout, dashboard). Snapshot **states**, not just the default: hover, focus, error, empty, loading, RTL, dark mode — each as its own baseline.

10. **A diff is a question for a human — never auto-update on CI.** The review/approve flow is the whole point:
    - **Failing build is correct behavior** when pixels change — the PR must show the diff image (Playwright attaches `expected/actual/diff` to the HTML report and `test-results/`; Chromatic/Percy link a hosted diff).
    - Approve intentional changes deliberately: Playwright → run the dedicated `--update-snapshots` job and **commit the new PNGs in the same PR** (reviewers see the pixel diff in git); Chromatic/Percy → click *approve* which moves the branch baseline.
    - **Never** run `--update-snapshots` automatically in the main test job or on every CI run — that auto-blesses regressions and the test becomes worthless. Updating baselines is a reviewed, intentional act.

11. **Keep baselines healthy.** Commit PNGs via **Git LFS** (binary churn bloats history); delete stale baselines when a component is removed (orphan PNGs hide nothing and rot); regenerate the whole set deliberately after an intentional global change (font swap, token update) in a single isolated PR titled as such, so reviewers know the diff is wholesale, not a regression slipping through.

## Common Errors

- **Baseline made on macOS, CI runs Linux.** Font/subpixel rendering differs → every snapshot "fails." Fix: generate and run in one pinned container image (`mcr.microsoft.com/playwright:vX.Y-noble`); never commit a dev-machine baseline.
- **Animations/transitions not disabled.** Mid-flight frame captured → random diffs. Fix: `animations:'disabled'`, `caret:'hide'`, inject `transition/animation:none!important`, `emulateMedia({reducedMotion:'reduce'})`.
- **Web font swaps after the shot (FOUT).** Glyph metrics shift → text diffs. Fix: `await document.fonts.ready` + self-host/preload fonts.
- **Live time/random/data.** "2 min ago", uuids, live API → churns pixels. Fix: `page.clock.setFixedTime`, seed/stub `Math.random`/`randomUUID`, route APIs to fixtures.
- **Raising `maxDiffPixelRatio` to stop flake.** Hides real regressions across the whole frame. Fix: eliminate nondeterminism (steps 3–6) and *mask* dynamic regions; keep the threshold near zero.
- **`waitForTimeout`/`networkidle` instead of a render signal.** Flaky on slow CI, deprecated. Fix: wait on `fonts.ready`, specific image `decode()`, or rely on `toHaveScreenshot`'s built-in retry-until-stable.
- **Forcing one platform name to share baselines.** A "shared" baseline matches no real env. Fix: one baseline per `(browser, platform)`; keep the OS suffix in the filename.
- **Auto-running `--update-snapshots` in CI.** Silently re-baselines regressions → the test never fails on a real change. Fix: dedicated, reviewed update job; commit PNGs in the PR.
- **Only the default/happy state snapshotted.** Hover/error/empty/dark/RTL regressions slip through. Fix: a baseline per meaningful state.
- **No DPR pin.** HiDPI runner doubles pixels vs 1x → size mismatch. Fix: `deviceScaleFactor:1` + `scale:'css'`.
- **Giant full-page snapshots only.** One header change fails 40 pages; slow, untriageable. Fix: component-level pyramid + a few critical page shots.
- **Baselines committed as raw blobs.** Binary churn bloats the repo. Fix: Git LFS; prune orphaned PNGs.

## Verify

1. **Determinism re-run:** run the suite twice back-to-back with **no code change** in the pinned CI image → zero diffs. Any nonzero diff on a clean re-run is leftover nondeterminism — fix it before trusting the suite.
2. **Env parity:** generate a baseline in the container and run CI in the same container → match; confirm filenames carry the `(browser, platform)` suffix and no baseline was produced on a dev machine.
3. **Real regression is caught:** deliberately change a color/padding/font-size by a few px → the relevant snapshot fails and the report shows a highlighted `diff.png`; the build goes red.
4. **Masking works, threshold is tight:** a masked region (avatar/clock) churning its content produces **no** diff, while an unmasked 1% layout shift **does** fail — proving the threshold isn't swallowing real changes.
5. **Stabilizers active:** animations disabled, `document.fonts.ready` awaited, clock fixed, randomness seeded, APIs stubbed to fixtures — grep the config/setup for each; a snapshot taken mid-animation or with a live `Date.now()` would fail check 1.
6. **Approve flow is manual:** confirm no job runs `--update-snapshots`/auto-approve on the main path; an intentional change requires committing new PNGs (or clicking approve) in a reviewed PR, and that PR's diff shows the pixel change.
7. **State coverage:** the critical components have baselines for hover/focus/error/empty/dark/RTL, not just default; responsive breakpoints are separate named snapshots.

Done = snapshots are byte-stable on a clean re-run in one pinned render env, dynamic regions are masked (not threshold-inflated), per-`(browser,platform)` baselines live in version control via LFS, a real few-pixel change goes red with a visible diff, and every baseline update is a deliberate, reviewed human approval — never an automatic CI step.
