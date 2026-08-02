# Migration: Vercel → Cloudflare Workers (2026-08-02)

Moved off Vercel (Hobby account soft-blocked for exceeding function-invocation fair-use limits)
onto **Cloudflare Workers** via the **OpenNext** adapter. External services unchanged: **Supabase**
(DB), **Privy** (auth), **Bridge/Tempo/Resend** webhooks, on-chain RPCs. Requires the **Workers
Paid ($5/mo)** plan (SSR bundle ~6.4 MiB gzip; needs >10ms CPU/request).

The heavy crypto stack (Lit/Vincent, `@solana/*`, `ethers`, `viem`, Privy, Stripe, MCP SDK) builds
and runs on `workerd` with `nodejs_compat`.

## Changes made
| File | Change | Why |
|------|--------|-----|
| `open-next.config.ts` | New | OpenNext Cloudflare adapter config. |
| `wrangler.jsonc` | New | `main: .open-next/worker.js`, `nodejs_compat`. The 16 public `NEXT_PUBLIC_*` vars live here. |
| `app/opengraph-image.tsx`, `app/twitter-image.tsx` | **Deleted** | `@vercel/og` uses edge-runtime WASM, which OpenNext can't bundle for Workers. (Re-add later as static images if wanted.) |
| `middleware.ts` | Unchanged | Edge middleware (Privy JWT + bot detection) — natively supported by OpenNext. |
| `package.json` | Added `@opennextjs/cloudflare` + `wrangler` devDeps, `deploy`/`preview` scripts | Reproducible deploys. |

## Env / secrets (61 app vars)
- **16 public** `NEXT_PUBLIC_*` → `vars` in `wrangler.jsonc`.
- **45 secrets** (Privy, Solana/Base keys, Stripe, Bridge, Lit, seed phrases, service keys, CRON_SECRET…)
  → Workers secrets via `wrangler secret bulk` (never committed).
- Build reads all from `.env.production.local` (gitignored); `vercel env pull` output in `.env.cf.production` (gitignored).

## Deploy
```bash
npm run deploy        # = opennextjs-cloudflare build && deploy
```
Needs `CLOUDFLARE_API_TOKEN` in env.

- **Live (Workers subdomain):** https://remlo.timjosh507.workers.dev
- **Cloudflare Worker name:** `remlo`

## ⚠️ Crons — NOT wired
The 4 `app/api/cron/*` routes (autopayroll, escrow expiry, reputation writes, inflow indexing) are
deployed but **have no schedule** (they weren't running on Vercel Hobby either). To enable, add
Cloudflare **Cron Triggers** to `wrangler.jsonc` (`"triggers": { "crons": [...] }`) hitting those
routes with the `CRON_SECRET` header.

## Custom domain (remlo.xyz) — PENDING
Not yet added to Cloudflare. Add it as a zone, move nameservers, then attach `remlo.xyz` +
`www.remlo.xyz` to the `remlo` Worker (delete stale Vercel records first).
