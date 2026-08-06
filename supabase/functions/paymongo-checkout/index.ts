// PayMongo Checkout – creates a hosted checkout session (GCash / Maya / Card).
// GATED: only reachable when PAYMONGO_ENABLED is true in the app config.
//
// Env secrets (Supabase → Project Settings → Edge Functions → Secrets):
//   PAYMONGO_SECRET_KEY       (from your PayMongo dashboard, secret key)
//   PAYMONGO_SUCCESS_URL      e.g. https://yourdomain.com/app.html
//   PAYMONGO_CANCEL_URL       e.g. https://yourdomain.com/billing (or app.html)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYMONGO_SECRET = Deno.env.get('PAYMONGO_SECRET_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUCCESS_URL = Deno.env.get('PAYMONGO_SUCCESS_URL') || 'https://yourdomain.com/app.html';
const CANCEL_URL = Deno.env.get('PAYMONGO_CANCEL_URL') || 'https://yourdomain.com/app.html';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!PAYMONGO_SECRET) return json({ error: 'PayMongo not configured' }, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Verify the caller is a signed-in client via their Supabase JWT
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile } = await supabase.from('profiles').select('plan_id').eq('id', user.id).single();
    const { data: plan } = await supabase.from('plans').select('name, price_monthly').eq('id', profile?.plan_id || '00000000-0000-0000-0000-000000000000').maybeSingle();
    const name = plan?.name || 'ZE-POS Monthly';
    const amount = Math.round(parseFloat(plan?.price_monthly || 999) * 100); // cents

    const res = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa(PAYMONGO_SECRET + ':'),
        },
        body: JSON.stringify({
            data: {
                attributes: {
                    line_items: [{ currency: 'PHP', amount, name, quantity: 1 }],
                    payment_method_types: ['gcash', 'maya', 'card'],
                    success_url: SUCCESS_URL,
                    cancel_url: CANCEL_URL,
                    description: `${name} — ZE-POS subscription`,
                    metadata: { profile_id: user.id, plan_id: profile?.plan_id || '' },
                },
            },
        }),
    });

    const payload = await res.json();
    if (!res.ok) {
        const detail = payload.errors?.[0]?.detail || 'PayMongo error';
        return json({ error: detail }, 502);
    }

    return json({ checkout_url: payload.data.attributes.checkout_url, session_id: payload.data.id });
});
