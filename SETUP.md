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

## Step 2 — Run the database migrations

1. Open your project → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/migrations/001_init.sql`, run it.
   Creates plans, profiles, payments, the 12 tenant tables, RLS, admin RPCs, and
   the seed function.
3. Paste the entire contents of `supabase/migrations/002_cashier_auth.sql`, run
   it. Adds `profiles.workspace_id` / `users.auth_uid`, membership-based RLS, the
   invite-code table + RPCs (`create_workspace_invite`, `mark_join_pending`,
   `join_workspace`), and re-points billing/admin RPCs at the workspace.
   Safe on an existing database (backfills current owners).
4. Paste the entire contents of `supabase/migrations/003_integrity.sql`, run it.
   The server-side trust layer (also safe on an existing database):
   - **Paywall enforced in the database** — a workspace with no active
     subscription can read its data but **cannot** create/edit/delete anything.
     Super-admin accounts are always exempt.
   - **Role-gated writes** — menu/categories/condiments/tax/settings/payroll/
     schedules are admin-write; cashiers can only insert orders and manage their
     own open shift.
   - **`audit_log` table + `log_action` RPC** — order deletes, payroll paid,
     staff changes, price changes, and settings changes are recorded with the
     acting user and a timestamp.
   - **No more `cloud-login`** — the owner's seeded password is removed and the
     `users.password` column is no longer readable by the app.
   - **`billing_paymongo_record`** — a service-role-only RPC the (fixed) PayMongo
     webhook uses to activate payments.
   - **Indexes** for the hot report/query paths.

   > ⚠️ After running 003, any workspace whose subscription is not `active` (or
   > whose `current_period_end` has passed) is **blocked server-side** from
   > taking orders. If you were testing on an account you never activated,
   > activate it from your admin dashboard (admin.html → 💰 Pay) before trying to
   > sell on it.

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

## Cashier / staff login

Each cashier gets their **own Supabase account** and signs in directly at
`/login.html` — the owner never needs to log in first. Access is granted with a
one-time **invite code** (no email provider, no edge functions).

How it works:

1. Owner signs in → **Staff → Add Staff** (name, username, role **Cashier** or
   **Admin**). No password needed — the cashier sets their own.
2. Owner clicks **🔗 Invite** on that staff row → a one-time code (valid 7 days)
   and the join link `…/join.html` are shown. Share them with the cashier.
3. Cashier opens `join.html`, enters **their own email + password + the code**,
   and their account is created and linked to the business. They sign in at
   `/login.html` with that email + password.
4. On sign-in they're in the app as themselves: admin-only pages are hidden, and
   the POS requires them to **Start Shift** (schedule rules still enforced).
   Sales they make are recorded to their shift and payroll.

> **Every staff member signs in with their own account.** The old shared-register
> "Switch User / Clock In" was removed in migration 003 — a cashier must be
> invite-linked and log in at `/login.html` with their own email + password. This
> is what makes per-user permissions enforceable server-side.
>
> Legacy staff rows (created before this update) have no login account yet — the
> owner just clicks **🔗 Invite** on each one and shares the code.
>
> If a staff member already has a ZE-POS account (e.g. they own another
> business), they can't take a second account — use a different email for their
> staff account.
>
> Invite codes are single-use and expire in 7 days. To revoke one before it's
> used, delete and re-create the staff member (or ask for support).

### Security model

- Tenant data is isolated by **membership**, not by auth.uid: every account has a
  `profiles.workspace_id` (the owner's = their own uid; a cashier's = the
  owner's uid). All RLS policies resolve the workspace from the signed-in user's
  profile, so a cashier reads their business's data and nothing else.
- An anonymous signup always starts as its **own** empty workspace — nothing can
  reassign it except a valid, unused, unexpired invite code.
- The `users` table (staff roster) is **admin-write-only**; members can read it.
- Since migration 003, writes are **role-gated at the database**: menu/categories/
  condiments/tax/settings/payroll/schedules are admin-write; cashiers insert
  orders and manage only their own open shift. The UI hiding is just cosmetic —
  the database is the real boundary.
- Since migration 003, the **subscription paywall is enforced at the database**:
  an inactive workspace cannot write any row (see Step 2). Disabling JS or
  editing the DOM cannot bypass it.
- Every sensitive change (order delete, payroll paid, staff edits, price
  changes, settings, history reset) is written to the `audit_log` table.

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

   > The webhook re-fetches each event from PayMongo and reads the profile/amount
   > from the *verified* payload (never the request body), validates the amount
   > against the plan, and records the payment idempotently via the
   > `billing_paymongo_record` RPC (service-role only). It only needs
   > `PAYMONGO_SECRET_KEY` — `SUPABASE_SERVICE_ROLE_KEY` is injected by Supabase.
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

**Security:** every tenant table has RLS scoped to `workspace_id = workspace_of()`
(the signed-in account's workspace — owner or linked cashier). Writes are gated
on role + active subscription. Admin actions go through SECURITY DEFINER RPCs
that check `is_super_admin`, so the public anon key can never read another
client's data or activate a payment.

## Known limits (MVP)

- **Internet required** for the app (data lives in the cloud). Offline-first is a future phase.
- **Last-write-wins** sync — two devices editing the same record at once can overwrite each other. Fine for a single counter.
- **Cashiers sign in with their own account** (invite code links them to the business). No shared-register clock-in — each device session is the signed-in user's. See "Cashier / staff login" above.
- New clients start with a **starter menu**; they edit it in the Menu page.

## Useful links

- Supabase: https://supabase.com
- PayMongo: https://paymongo.com
- Vercel: https://vercel.com
