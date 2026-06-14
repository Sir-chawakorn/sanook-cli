---
name: build-react-component
description: Scaffolds production-grade React/Next.js components with proper props typing, server vs client component boundaries, and composition; used when building or restructuring UI components.
when_to_use: When the user asks to create, scaffold, or restructure a React/Next.js component, page, or layout — especially deciding Server vs Client Component, prop typing, and folder structure.
---

## When to Use

Use this skill when creating, scaffolding, or restructuring a React/Next.js component, page, or layout. It is most valuable when you must decide Server vs Client Component boundaries, design a typed props contract, or lay out files. Skip it for trivial edits to an existing component (text/className tweaks, prop renames) — just edit directly.

Assumes Next.js App Router + React 19 + TypeScript. For pages/ router or React ≤18, drop the App Router steps and the `useActionState`/server-action patterns.

## Steps

1. **Default to a Server Component. Add `'use client'` only when the component actually needs the browser.** A file is client-only if it uses any of: `useState`/`useReducer`, `useEffect`/`useLayoutEffect`, event handlers (`onClick`, `onChange`, …), refs to DOM nodes, browser APIs (`window`, `localStorage`, `IntersectionObserver`), or a third-party lib that calls these. None of those → leave it a Server Component (no directive). `'use client'` is a **boundary**, not a per-file tag: it marks the entry point; every child imported into it becomes client too. So push it **down the tree** to the smallest interactive leaf.

2. **Keep the boundary thin: pass Server Components into Client Components as `children`/props, don't import them.** A Client Component can *render* Server Component output if it arrives via props/children — it just can't `import` one. Pattern:
   ```tsx
   // page.tsx (server) — fetches data, composes
   <ClientShell><ServerHeavyList /></ClientShell>
   ```
   This keeps the data-fetching + heavy markup on the server while the interactive wrapper stays small.

3. **Write the props contract first, as a named `interface`, with defaults.**
   ```tsx
   interface CardProps {
     title: string;
     description?: string;
     variant?: 'default' | 'outline';   // union, not string
     children?: React.ReactNode;
   }
   export function Card({ title, description, variant = 'default', children }: CardProps) { … }
   ```
   Rules: no `React.FC` (breaks generics, implies legacy `children`). Use string-literal unions over `string` for variants. Default values in the destructure, not `defaultProps`. Extend native props when wrapping an element: `interface ButtonProps extends React.ComponentProps<'button'> { variant?: … }` then spread `{...rest}` onto the element so consumers keep `aria-*`, `type`, `onClick`, etc.

4. **Fetch data in the Server Component with `async`/`await` — no `useEffect` fetching.**
   ```tsx
   export default async function Page() {
     const data = await getData();          // runs on server, no client JS shipped
     return <View data={data} />;
   }
   ```
   `fetch` is auto-deduped/cached per request. Set freshness with `{ next: { revalidate: 60 } }` or `cache: 'no-store'`. Never lift this into a Client Component — that ships the fetch + waterfalls it.

5. **Colocate files; reach for App Router special files when the route needs them.**
   ```
   components/card/
     card.tsx          # component
     card.test.tsx     # test
     card.module.css   # styles (or Tailwind inline)
   app/dashboard/
     page.tsx          # route UI
     layout.tsx        # shared shell (persists across child routes)
     loading.tsx       # Suspense fallback — auto-wraps page
     error.tsx         # 'use client' error boundary (gets error + reset)
     not-found.tsx
   ```
   Add `loading.tsx`/`error.tsx` only when the route does async work or can fail. Barrel `index.ts` files only at package/public boundaries — not inside feature folders (they bloat bundles and create import cycles).

6. **Compose, don't configure.** Prefer `children` and slot props over a pile of booleans. When a component has tightly-coupled parts, use the **compound pattern** instead of `tabs={[…]}` config:
   ```tsx
   <Tabs defaultValue="a">
     <Tabs.List><Tabs.Trigger value="a">A</Tabs.Trigger></Tabs.List>
     <Tabs.Panel value="a">…</Tabs.Panel>
   </Tabs>
   ```
   Shared state goes through a Context created *inside* the parent (see step 8). This beats prop explosions and lets consumers control layout.

7. **For forms/mutations use Server Actions + React 19 hooks, not manual fetch + useState.**
   ```tsx
   // actions.ts
   'use server';
   export async function save(prev, formData: FormData) { …; return { ok: true }; }
   ```
   ```tsx
   'use client';
   const [state, action, pending] = useActionState(save, null);
   return <form action={action}><button disabled={pending}>Save</button></form>;
   ```
   Use `useOptimistic` to reflect the change in UI before the action resolves; use `useFormStatus()` inside a child to read pending state without prop-passing.

8. **Kill prop drilling by lifting state or scoping a Context — not by threading props 3+ levels.** If two siblings need the same state, lift it to their nearest common parent. If many descendants need it, create a typed Context **co-located with the feature** (provider in the parent, a `useX()` hook that throws if used outside the provider):
   ```tsx
   const Ctx = React.createContext<T | null>(null);
   export function useTabs() {
     const c = React.useContext(Ctx);
     if (!c) throw new Error('useTabs must be used within <Tabs>');
     return c;
   }
   ```
   Don't reach for global state (Zustand/Redux) for what is local UI coordination.

9. **Apply the accessibility baseline, then hand deep a11y to the a11y skill.** Use the semantic element (`<button>` for actions, `<a>`/`<Link>` for navigation, `<nav>`/`<main>`/`<ul>`), associate every input with a `<label htmlFor>`, give icon-only controls an `aria-label`, and don't trap keyboard users. Anything beyond this baseline (focus management, ARIA widget roles, live regions) → defer to the dedicated accessibility skill.

## Common Errors

- **`useState`/event handler in a Server Component** → build error: *"You're importing a component that needs useState… add 'use client'."* Fix: add the directive to that leaf, or move just the interactive bit into a small client child. Don't slap `'use client'` on the whole page.
- **Importing a Server Component into a Client Component** → it silently becomes a client component (loses server-only access to DB/secrets/`async`). Fix: pass it as `children`/prop from a server parent (step 2).
- **Passing a non-serializable prop (function, Date, class instance) across the server→client boundary** → *"Only plain objects can be passed to Client Components."* Event handlers/functions can't cross it. Fix: serialize, or move the handler into the client side.
- **`React.FC<Props>`** → swallows generics and implies an optional `children` you may not want. Use a plain function with a typed param.
- **Fetching in `useEffect` for first paint** → request waterfall + spinner + larger bundle. Fix: `await` it in the Server Component (step 4).
- **`async` Client Component** (`'use client'` + `async function`) → not supported; only Server Components can be async. Fetch on the server or use a data hook / `use()`.
- **Reading `process.env.SECRET` in client code** → it's `undefined` in the browser (only `NEXT_PUBLIC_*` is exposed) and leaks if it weren't. Keep secrets in Server Components/actions.
- **Barrel `index.ts` re-exporting a whole feature folder** → defeats tree-shaking, drags client code into server bundles, and risks circular imports. Import from the specific file.
- **`error.tsx` without `'use client'`** → error boundaries must be Client Components; it won't catch otherwise.
- **Mutating data then expecting the UI to refresh** → call `revalidatePath`/`revalidateTag` in the server action; client state won't update on its own.

## Verify

- [ ] `npx tsc --noEmit` passes — props contract is sound, no `any` leaking in.
- [ ] `next build` (or `next dev` with no console errors) — confirms no Server/Client boundary violation or serialization error.
- [ ] Every `'use client'` sits on the **smallest** interactive component; server data-fetching stays server-side (grep the tree: a `'use client'` file should not contain `await fetch`/DB calls).
- [ ] Props use named unions + extend native element props where wrapping; no `React.FC`; no `defaultProps`.
- [ ] Interactive controls are real semantic elements with labels/`aria-label`; tab order works.
- [ ] No prop drilled past 2 levels without a lift or Context; no global store for purely local UI state.
- [ ] Tests/lint run green if the repo has them (`npm test`, `npm run lint`).
