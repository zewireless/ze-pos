// PayMongo Webhook – receives `checkout_session.payment_paid` events and records
// the payment + extends the client's subscription.
//
// SECURITY (003): the event is RE-FETCHED from PayMongo by id, and profile_id +
// amount are read from that fetched payload — never from the request body. The
// request body is only used for the event id, so a forged body with a real event
// id cannot inject an arbitrary profile_id/amount. Payment recording happens via
// billing_paymongo_record (service-role-only RPC) with idempotency on reference.
//
// IDEMPOTENCY: Webhook events are logged to audit_log with the PayMongo event_id
// as entity_id. Duplicate deliveries of the same event are detected and skipped.
//
// FALLBACK VALIDATION: If plan_id missing from checkout metadata, we resolve it
// from the profile's current plan_id and verify amount against that plan's price.
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

    // IDEMPOTENCY: Check if we've already processed this webhook event.
    // We log webhook events to audit_log with action='paymongo_webhook' and
    // entity_id = PayMongo event_id. If it exists, skip processing.
    const { data: existingLog } = await supabase
        .from('audit_log')
        .select('id')
        .eq('action', 'paymongo_webhook')
        .eq('entity_id', eventId)
        .maybeSingle();
    if (existingLog) {
        return json({ ok: true, handled: true, duplicate: true });
    }

    // FALLBACK VALIDATION: If plan_id not in metadata, resolve from profile.
    let resolvedPlanId = planId;
    let planPrice = 0;
    if (!resolvedPlanId) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('plan_id')
            .eq('id', profileId)
            .maybeSingle();
        resolvedPlanId = profile?.plan_id || null;
    }
    // Fetch the plan price (from metadata plan_id or profile's plan_id)
    if (resolvedPlanId) {
        const { data: plan } = await supabase
            .from('plans')
            .select('price_monthly')
            .eq('id', resolvedPlanId)
            .maybeSingle();
        planPrice = plan ? Number(plan.price_monthly || 0) : 0;
    }

    // Amount sanity check: verified amount must cover the plan price.
    // If we couldn't resolve a plan, require at least the minimum known plan price.
    const minPlanPrice = planPrice > 0 ? planPrice : 999.00; // default ZE-POS Monthly
    const amountOk = amountPhp >= minPlanPrice;
    if (!amountOk) return json({ ok: false, error: 'Amount does not cover plan' }, 400);

    // Record via the service-role-only RPC (idempotent on reference).
    const { error } = await supabase.rpc('billing_paymongo_record', {
        p_profile_id: profileId,
        p_amount: amountPhp,
        p_method: 'paymongo',
        p_reference: reference,
    });
    if (error) return json({ ok: false, error: error.message }, 500);

    // AUDIT LOG: Record the webhook event for idempotency and traceability.
    // Uses billing_log_webhook which resolves the workspace from the profile
    // (log_action can't run as service_role because it needs auth.uid()).
    await supabase.rpc('billing_log_webhook', {
        p_profile_id: profileId,
        p_event_id: eventId,
        p_details: {
            profile_id: profileId,
            plan_id: resolvedPlanId,
            amount_php: amountPhp,
            reference,
            checkout_session_id: cs?.id,
            event_type: eventType,
        },
    }).catch(err => console.warn('audit log failed:', err.message));

    return json({ ok: true, handled: true });
});
