# Quick Task: Supabase Auth and Resident Onboarding

## Goal

Add optional browser-side Supabase email/password authentication, a three-step first-run resident onboarding flow, and profile/watchlist synchronization without gating public browsing.

## Scope

- Centralize browser auth, profile, and tracked-case state in a React context.
- Add `/auth` sign-up/sign-in UI and shell-level account controls.
- Replace `/onboard` with city discovery, optional address selection, and completion.
- Persist locally for guests and upsert `profiles` for signed-in users with fail-soft local fallback.
- Prefill the dashboard from the saved profile and expose a landing-page Get started entry point.

## Guardrails

- Vite + React only; no Next.js helpers or server-side auth.
- Use the existing `src/supabase.ts` browser client and `VITE_` environment variables.
- Do not gate public data, invoke an LLM in auth/profile request paths, run SQL, or commit.
- Preserve unrelated dirty-worktree changes.

## Verification

- `npm run build`
- Inspect logged-out shell/auth/onboarding routes.
- Exercise guest onboarding persistence with browser storage where runtime tooling permits.

## Result

Completed 2026-07-21 without committing. `npm run build` passes. The running Vite/Node app returned HTTP 200 for `/`, `/auth`, and `/onboarding`; the existing address endpoint returned live suggestions. Guest profile and watchlist writes remain local-first, while signed-in users upsert the same state to Supabase with an explicit local fallback when `profiles` is unavailable.
