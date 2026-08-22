# Phase A handoff — server-side trust layer (what YOU need to do)

Phase A is complete in code. This file lists exactly what to upload, what to run
in Supabase, and what to verify. **Do the Supabase step before you start testing.**

---

## 1) Upload to GitHub (new + changed files)

You already have the older files on GitHub. **Re-upload / overwrite these:**

| File | Status |
|---|---|
| `supabase/migrations/003_integrity.sql` | **NEW** |
| `supabase/functions/paymongo-webhook/index.ts` | **CHANGED** (webhook secured) |
| `js/auth.js` | **CHANGED** (removed clock-in) |
| `js/app.js` | **CHANGED** (removed switch-user, added `safeImageUrl`, audit wiring) |
| `js/db.js` | **CHANGED** (added `DB.logAction`) |
| `js/pos.js` | **CHANGED** (image src sanitized) |
| `js/menu.js` | **CHANGED** (image src sanitized, audit wiring) |
| `js/categories.js` | **CHANGED** (audit wiring) |
| `js/condiments.js` | **CHANGED** (audit wiring) |
| `js/orders.js` | **CHANGED** (audit wiring) |
| `js/payroll.js` | **CHANGED** (audit wiring) |
| `js/staff.js` | **CHANGED** (audit wiring) |
| `js/admin.js` | **CHANGED** (escaped payment status/method) |
| `app.html` | **CHANGED** (removed Switch User button) |
| `sw.js` | **CHANGED** (branding + cache bumped to v11) |
| `SETUP.md` | **CHANGED** (documents 003 + new security model) |
| `HANDOFF_PHASE_A.md` | **NEW** (this file) |

The service-worker cache name is now `ze-pos-v11`, so after you deploy the
changes everyone gets the new code automatically (assets are served cache-first).

---

## 2) Supabase — run migration 003

1. Supabase → **SQL Editor** → **New query**
2. Paste the entire contents of `supabase/migrations/003_integrity.sql` → **Run**

It is idempotent and safe on an existing database (it backfills and preserves
your data). It does four things:

- **Enforces the paywall in the database.** A workspace that isn't `active` can
  read its own data but can no longer create/edit/delete anything.
- **Role-gates writes.** Cashiers can insert orders and manage their own open
  shift only; menu/settings/payroll/schedules are admin-write.
- **Adds `audit_log` + `log_action`.** Every sensitive change is now recorded
  with who + when.
- **Removes the `cloud-login` credential** and hides the `users.password` column
  from the app.

> ⚠️ **After this runs, activate any account you were testing on.** If an account
> has `subscription_status = 'never'` (or its period expired) it is now blocked
> from taking orders. In `admin.html` → find the client → **💰 Pay** to activate.

---

## 3) Behavior changes to know about

- **No more "Switch User / Clock In".** Every person signs in with their own
  account. Cashiers who aren't invite-linked yet need one: **Staff → 🔗 Invite**,
  then they log in at `/login.html` with their own email + password.
- **Cashier sign-in requires a working invite link.** If a cashier was using the
  old shared-register clock-in, they now need an invite. This is the security fix.
- **Paywall is now real.** There is no way around it from the browser.

---

## 4) PayMongo (only if/when you enable online payments)

The webhook is fixed and safe to deploy when you're ready:

1. Supabase → **Edge Functions** → deploy `paymongo-checkout` **and**
   `paymongo-webhook` (the webhook now verifies each event by re-fetching it from
   PayMongo, reads the profile/amount from the *verified* payload, validates the
   amount against the plan, and records idempotently via the service-role RPC).
2. Add the secret `PAYMONGO_SECRET_KEY` (+ `PAYMONGO_SUCCESS_URL` /
   `PAYMONGO_CANCEL_URL` for the checkout function).
3. In PayMongo → Webhooks, add `…/functions/v1/paymongo-webhook`, event
   `checkout_session.payment_paid`.
4. In `config.js` set `PAYMONGO_ENABLED: true` + the checkout URL, then redeploy.

Not needed if you're staying on manual GCash/Maya/bank billing.

---

## 5) Verify checklist

1. **Owner login** works, dashboard loads, menu/payroll/settings editable.
2. **Activate a test client** (admin → 💰 Pay) → their app unlocks.
3. **Cashier flow:** Staff → 🔗 Invite a cashier → join on `/join.html` → sign in
   as them at `/login.html` → start shift (scheduled) → complete an order.
4. **Cashier can't edit menu/settings/payroll** (pages hidden AND DB rejects).
5. **Cancel/overdue a client** → they can see data but any write fails (server).
6. **Audit trail:** delete an order / mark payroll paid as owner → a row appears
   in Supabase `audit_log` (Table Editor).
7. **`users` table** no longer returns the `password` column.
