// PayMongo Webhook – receives `checkout_session.payment_paid` events and
// records the payment + activates the client via admin_record_payment.
// GATED: enable this webhook URL in PayMongo → Webhooks once deployed.
//
// Env secrets:
//   PAYMONGO_SECRET_KEY  (needed to re-fetch and verify the event)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
//
// IMPORTANT: this function must run with verify_jwt = false (see config.toml)
// because PayMongo does not send a Supabase JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYMONGO_SECRET = Deno.env.get('PAYMONGO_SECRET_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
    if (!PAYMONGO_SECRET) return json({ ok: false, error: 'PayMongo not configured' }, 500);

    const body = await req.json();
    const event = body?.data;
    if (!event || !event.id) return json({ ok: false, error: 'Missing event' }, 400);

    // Verify the event actually exists at PayMongo before trusting it.
    const verify = await fetch(`https://api.paymongo.com/v1/events/${event.id}`, {
        headers: { Authorization: 'Basic ' + btoa(PAYMONGO_SECRET + ':') },
    });
    if (!verify.ok) return json({ ok: false, error: 'Unverified event' }, 401);

    const type = event.attributes?.type;
    if (type === 'checkout_session.payment_paid') {
        const cs = event.attributes?.data;
        const meta = cs?.attributes?.metadata || {};
        const profileId = meta.profile_id;
        const amount = cs?.attributes?.payments?.[0]?.attributes?.amount || 0; // cents

        if (!profileId) return json({ ok: false, error: 'No profile_id' }, 400);

        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
        const { error } = await supabase.rpc('admin_record_payment', {
            p_profile: profileId,
            p_amount: amount / 100,
            p_method: 'paymongo',
            p_reference: cs.id || null,
        });
        if (error) return json({ ok: false, error: error.message }, 500);
    }

    return json({ ok: true });
});
