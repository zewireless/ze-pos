// PayMongo Webhook – receives `checkout_session.payment_paid` events and records
// the payment + extends the client's subscription.
//
// SECURITY (003): the event is RE-FETCHED from PayMongo by id, and profile_id +
// amount are read from that fetched payload — never from the request body. The
// request body is only used for the event id, so a forged body with a real event
// id cannot inject an arbitrary profile_id/amount. Payment recording happens via
// billing_paymongo_record (service-role-only RPC) with idempotency on reference.
//
// Env secrets:
//   PAYMONGO_SECRET_KEY        (re-fetch + verify the event)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected by Supabase)
//
// IMPORTANT: verify_jwt = false (config.toml) because PayMongo sends no Supabase
// JWT. The service-role RPC is the only thing that trusts this endpoint.

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
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ ok: false, error: 'Supabase not configured' }, 500);

    const body = await req.json().catch(() => null);
    const eventId = body?.data?.id;
    if (!eventId) return json({ ok: false, error: 'Missing event id' }, 400);

    // Verify the event exists at PayMongo and pull its FULL payload.
    const verify = await fetch(`https://api.paymongo.com/v1/events/${eventId}`, {
        headers: { Authorization: 'Basic ' + btoa(PAYMONGO_SECRET + ':') },
    });
    if (!verify.ok) return json({ ok: false, error: 'Unverified event' }, 401);

    const verified = await verify.json().catch(() => null);
    const event = verified?.data;
    if (!event) return json({ ok: false, error: 'Malformed event' }, 401);

    // Event type lives on the verified payload, not the request body.
    const eventType = event.type || event.attributes?.type;
    if (eventType !== 'checkout_session.payment_paid') {
        return json({ ok: true, handled: false }); // not our event type — ack silently
    }

    // The checkout session, again from the VERIFIED payload.
    const cs = event.attributes?.data;
    const meta = cs?.attributes?.metadata || {};
    const profileId = meta.profile_id;
    const planId = meta.plan_id || null;
    const amountCents = cs?.attributes?.amount || 0; // PayMongo amounts are in cents
    const amountPhp = amountCents / 100;
    const reference = cs?.id || eventId;

    if (!profileId) return json({ ok: false, error: 'No profile_id in verified event' }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Amount sanity check: the verified amount must cover the plan price (when
    // we can resolve the plan). A zero/partial payment never activates a month.
    let amountOk = amountPhp > 0;
    if (amountOk && planId) {
        const { data: plan, error: planErr } = await supabase
            .from('plans')
            .select('price_monthly')
            .eq('id', planId)
            .maybeSingle();
        if (!planErr && plan) {
            amountOk = amountPhp >= Number(plan.price_monthly || 0);
        }
    }
    if (!amountOk) return json({ ok: false, error: 'Amount does not cover plan' }, 400);

    // Record via the service-role-only RPC (idempotent on reference).
    const { error } = await supabase.rpc('billing_paymongo_record', {
        p_profile_id: profileId,
        p_amount: amountPhp,
        p_method: 'paymongo',
        p_reference: reference,
    });
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, handled: true });
});
