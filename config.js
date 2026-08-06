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
        gcash: '09XX-XXX-XXXX (Your Name)',
        maya: '09XX-XXX-XXXX (Your Name)',
        bank: 'Bank: XXXX Bank / Account: 0000-0000-000',
    },
};
