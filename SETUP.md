# ZE-POS — Subscription SaaS Setup Guide

Turn the POS into a cloud, subscription product. This guide takes you from the
code to **live clients paying a monthly fee** — all on free tiers.

## What you get

- Clients **register** (business + email + password) → their own cloud workspace is created.
- Your app unlocks while their **monthly subscription is active**; otherwise they see a paywall.
- **Manual billing** (GCash / Maya / bank transfer) works immediately — you activate clients from your admin dashboard.
- **PayMongo** online checkout (GCash/Maya/card) is coded and can be switched on later.
- **Admin dashboard** (`/admin.html`) lists every client, who's paying, who's overdue, with cancel / reactivate / record-payment controls.
- Each client's data is cloud-backed and **RLS-isolated** (no client can see another's data).

---

## Step 1 — Create a free Supabase project

1. Go to https://supabase.com → **Sign up** → **New project**.
2. Pick a name (e.g. `ze-pos`), a strong DB password, and a region close to you (Singapore is nearest to the Philippines).
3. Copy the **Project URL** and **anon public key**:
   Project Settings → **API** → `Project URL` + `anon public`.
4. In Project Settings → **Auth**, turn **OFF** "Confirm email" so clients can sign in instantly after registering.

> Free tier: 500 MB Postgres, 50k monthly logins — plenty for a small client base.
> You only outgrow it later ($25/mo Pro).

## Step 2 — Run the database migration

1. Open your project → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/migrations/001_init.sql`.
3. Run it. You should see "Success" (creates plans, profiles, payments, the 12 tenant tables, RLS, admin RPCs, and the seed function).

## Step 3 — Point the app at your Supabase project

Edit `config.js`:

```js
SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
```

Also fill in your payment details (what you show clients for manual payment):

```js
BUSINESS_PAYMENT_DETAILS: {
    gcash: '09XX-XXX-XXXX (Your Name)',
    maya:  '09XX-XXX-XXXX (Your Name)',
    bank:  'Bank: XXXX Bank / Account: 0000-0000-000',
},
```

> Change the monthly price later by editing the `plans` table in the Supabase Table
> Editor (default ₱999/month).

## Step 4 — Make YOUR account the super-admin

1. Go to Authentication → **Users** in Supabase and create an account with your email/password (or register through the app).
2. Open the **Table Editor** → `profiles` → find your row → set `is_super_admin = true`.
3. `admin.html` now works for you (it redirects anyone who isn't flagged).

## Step 5 — Deploy the app (free hosting)

**Option A — Vercel** (recommended):
1. Push this folder to a GitHub repo.
2. https://vercel.com → **New Project** → import the repo (framework: **Other**).
3. Deploy. You get a URL like `ze-pos.vercel.app`.

**Option B — Netlify**: New site from Git → build command empty → publish directory `/`.

> Since Supabase URL/key are in `config.js`, no server env vars are needed. Keep
> `config.js` simple — it only holds the public anon key (safe to ship; RLS protects data).

## Step 6 — Test the whole flow

1. Open your deployed URL → **Create an account** (any email/password).
2. You land on the **paywall** (no subscription yet).
3. Open `https://yourdomain/admin.html` (or your local copy) → find the new client → **💰 Pay** → pick GCash/amount → **Activate & Save**.
4. Back in the client's browser → **↻ I've paid — Check Status** → the app unlocks with the starter menu.
5. Log in on a second device with the same account → your data (orders, menu) is there — **cloud sync works**.
6. In admin → **Cancel** the client → their app locks to the paywall again.

## Step 7 — (Later) Enable PayMongo online payments

Requires a **PayMongo merchant account** (needs PH business registration + bank account).

1. In Supabase → **Edge Functions** → deploy:
   `supabase/functions/paymongo-checkout` and `supabase/functions/paymongo-webhook`.
2. Add secrets (Edge Functions → Manage → Secrets):
   - `PAYMONGO_SECRET_KEY` (PayMongo dashboard → Developers → Keys, secret key)
   - `PAYMONGO_SUCCESS_URL` → `https://yourdomain/app.html`
   - `PAYMONGO_CANCEL_URL` → `https://yourdomain/app.html`
3. In PayMongo → **Developers → Webhooks**, add the webhook URL
   `https://<project-ref>.supabase.co/functions/v1/paymongo-webhook`
   and subscribe to the **`checkout_session.payment_paid`** event.
4. In `config.js`: `PAYMONGO_ENABLED: true` and
   `PAYMONGO_CHECKOUT_URL: 'https://<project-ref>.supabase.co/functions/v1/paymongo-checkout'`.
5. Re-deploy. The billing page now shows **"Pay Online"**.

---

## How the pieces fit

```
register.html / index.html  →  Supabase Auth (email/password)
        │
        ▼
app.html boot  →  Supabase session → DB.init() loads the client's 12 tables
        │
        ├─ subscription active?  → full POS (all modules unchanged)
        └─ not active?           → paywall on the Billing page

admin.html (owner only, is_super_admin) → clients, statuses, payments, cancel/reactivate
PayMongo (gated) → checkout edge fn + webhook edge fn auto-activate after payment
```

**Security:** every tenant table has RLS scoped to `workspace_id = auth.uid()`.
Admin actions go through SECURITY DEFINER RPCs that check `is_super_admin`, so the
public anon key can never read another client's data.

## Known limits (MVP)

- **Internet required** for the app (data lives in the cloud). Offline-first is a future phase.
- **Last-write-wins** sync — two devices editing the same record at once can overwrite each other. Fine for a single counter.
- **One login per business** for now (cashier-specific logins are a later phase; staff roles still work in-app).
- New clients start with a **starter menu**; they edit it in the Menu page.

## Useful links

- Supabase: https://supabase.com
- PayMongo: https://paymongo.com
- Vercel: https://vercel.com
