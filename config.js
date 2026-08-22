/**
 * ZE-POS SaaS configuration.
 *
 * SETUP:
 *  1. Create a free Supabase project → https://supabase.com
 *  2. Run supabase/migrations/001_init.sql in the SQL Editor.
 *  3. Copy your project URL + anon key (Project Settings → API) into the two
 *     fields below.
 *  4. Turn OFF "Confirm email" in Auth settings so clients can log in immediately.
 *  5. In your Supabase account row (auth.users → profiles), set is_super_admin = true
 *     for YOUR account to unlock the /admin.html dashboard.
 *
 * EMAIL / PASSWORD RESET SETUP (required for the "Forgot password?" flow):
 *   1. Supabase dashboard → Authentication → URL Configuration →
 *      "Redirect URLs": add this app's origin, e.g.
 *        https://your-github-pages-or-domain
 *        http://localhost:5500            (for local `python -m http.server 5500`)
 *      The reset link redirects to origin + '/login.html' (see Auth.requestPasswordReset).
 *   2. Authentication → Email Templates → "Reset Password": keep the default
 *      template containing {{ .ConfirmationURL }}. Supabase appends
 *      #access_token=...&type=recovery to the redirect, which index.html reads
 *      to show the "Set New Password" form. If you use a custom template, the
 *      link MUST point at {{ .ConfirmationURL }} (not just {{ .Token }}).
 *   3. Project Settings → Auth → SMTP: configure a custom SMTP sender (or enable
 *      Supabase's email provider) so reset emails actually deliver.
 *   Note: "Confirm email" (signup) can stay ON; it is independent of reset email.
 */
window.ZE_CONFIG = {
    // ── Supabase ──────────────────────────────────────────────
    SUPABASE_URL: 'https://uggseeorngiuvuktylpz.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZ3NlZW9ybmdpdXZ1a3R5bHB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NzQ5NzMsImV4cCI6MjEwMTM1MDk3M30.wjye7RBfAvwjhDg1Az9zjWS1Kg8_PtL40h148j56ibo',

    // ── Payments ──────────────────────────────────────────────
    // Manual GCash/Maya/bank billing is the default (no gateway needed).
    // To enable PayMongo later: get a PayMongo merchant account, fill the keys
    // in supabase/functions/paymongo-checkout + webhook, deploy them, then set
    // PAYMONGO_ENABLED = true and add the checkout function URL below.
    PAYMONGO_ENABLED: false,
    PAYMONGO_CHECKOUT_URL: '',

    // Contact you show clients for manual payments
    BUSINESS_PAYMENT_DETAILS: {
        gcash: '0942-3838-884 (Lounel S.)',
        maya: '0942-3838-884 (Lounel S.)',
        bank: 'Bank: Metrobank Bank / Account: 537-390-876-0213',
    },
};
