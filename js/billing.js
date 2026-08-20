/**
 * Billing – subscription status, plan picker, payment method selection,
 * and payment claim submission for a self-service billing flow.
 *
 * Flow:
 *   1. No active subscription, no pending claim → show plan picker +
 *      payment method selector → client submits a claim (pending).
 *   2. Pending claim exists → show "awaiting review" screen.
 *   3. Active subscription → show manage/renew screen (can also change
 *      plan by submitting a new claim).
 */
const Billing = (() => {
    let cachedPlans = [];
    let selectedPlanId = null;
    let selectedMethod = 'gcash';

    function render() {
        const el = document.getElementById('page-billing');
        if (!el || !Auth.isLoggedIn()) return;
        load(el);
    }

    async function load(el) {
        el.innerHTML = `
            <div class="card">
                <div class="card-body" style="text-align:center;padding:40px;">
                    <span class="icon" style="font-size:32px;">⏳</span>
                    <h3>Loading billing…</h3>
                </div>
            </div>
        `;

        try {
            const client = Supabase.getClient();
            const { data: billing } = await client.rpc('get_my_billing');
            const { data: plans } = await client
                .from('plans')
                .select('*')
                .eq('active', true)
                .order('sort_order')
                .order('price_monthly');
            cachedPlans = plans || [];
            const b = billing || {};

            const status = b.status || 'never';
            const periodEnd = b.period_end ? new Date(b.period_end) : null;
            const isActive = status === 'active' && (!periodEnd || periodEnd.getTime() > Date.now());

            if (b.pending_payment) {
                el.innerHTML = renderPending(b.pending_payment);
                bindPending(el, b.pending_payment);
                return;
            }

            if (isActive) {
                el.innerHTML = renderManage(b);
                bindManage(el);
                return;
            }

            selectedPlanId = selectedPlanId || (cachedPlans[0] && cachedPlans[0].id) || null;
            el.innerHTML = renderPicker(b, status, periodEnd);
            bindPicker(el);
        } catch (err) {
            el.innerHTML = `
                <div class="card">
                    <div class="card-body">
                        <p class="text-muted">Could not load billing: ${App.escapeHtml(err.message || err)}</p>
                    </div>
                </div>
            `;
        }
    }

    function statusBadge(status, periodEnd) {
        const map = { active: ['badge-success', 'Active'], overdue: ['badge-danger', 'Overdue'], cancelled: ['badge-warning', 'Cancelled'], never: ['badge-warning', 'No Plan'] };
        const [cls, label] = map[status] || map.never;
        let extra = '';
        if (status === 'active' && periodEnd) extra = ` · renews ${App.formatDate(periodEnd.toISOString())}`;
        return `<span class="badge ${cls}">${label}</span>${extra}`;
    }

    function fmtDuration(p) {
        const map = { trial: 'Trial', days: 'Days', weeks: 'Weeks', months: 'Months', custom: 'Custom' };
        const label = map[p.duration_type] || p.duration_type || '';
        return `${p.duration_days} day${p.duration_days === 1 ? '' : 's'}${label ? ' · ' + label : ''}`;
    }

    // ── Plan picker + payment method selector ─────────────────────
    function renderPicker(b, status, periodEnd) {
        const cfg = window.ZE_CONFIG || {};
        const details = cfg.BUSINESS_PAYMENT_DETAILS || {};
        const payments = (b.payments || []).filter(p => p.status === 'paid');

        const planCards = cachedPlans.length ? cachedPlans.map(p => `
            <div class="plan-card ${p.id === selectedPlanId ? 'selected' : ''}" data-plan-id="${p.id}"
                 style="cursor:pointer;border:2px solid ${p.id === selectedPlanId ? 'var(--primary)' : 'var(--border)'};border-radius:12px;padding:16px;margin-bottom:10px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div>
                        <strong>${App.escapeHtml(p.name)}</strong>
                        <div class="shift-meta">${fmtDuration(p)}</div>
                    </div>
                    <div style="font-size:20px;font-weight:800;">${App.escapeHtml(p.currency)} ${parseFloat(p.price_monthly).toFixed(2)}</div>
                </div>
            </div>
        `).join('') : '<p class="text-muted">No plans are currently available. Please contact support.</p>';

        const methods = [
            { id: 'gcash', label: 'GCash', detail: details.gcash },
            { id: 'maya', label: 'Maya', detail: details.maya },
            { id: 'bank', label: 'Bank Transfer', detail: details.bank },
        ];
        const methodTabs = methods.map(m => `
            <button type="button" class="btn ${m.id === selectedMethod ? 'btn-primary' : 'btn-outline'} btn-sm pay-method-btn" data-method="${m.id}">${m.label}</button>
        `).join(' ');

        const activeMethod = methods.find(m => m.id === selectedMethod) || methods[0];

        return `
            <div class="card" style="max-width:640px;margin:0 auto;">
                <div class="card-header">
                    <h3>🔒 Choose a Plan</h3>
                    ${statusBadge(status, periodEnd)}
                </div>
                <div class="card-body">
                    <p class="text-muted">Pick the plan that fits your business, then submit your payment.</p>

                    <div id="planCards" style="margin:16px 0;">
                        ${planCards}
                    </div>

                    <h4 style="margin-bottom:8px;">Payment Method</h4>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;" id="methodTabs">
                        ${methodTabs}
                        ${cfg.PAYMONGO_ENABLED ? `<button type="button" class="btn ${selectedMethod === 'paymongo' ? 'btn-primary' : 'btn-outline'} btn-sm pay-method-btn" data-method="paymongo">💳 Pay Online</button>` : ''}
                    </div>

                    <div id="methodDetail">
                        ${selectedMethod === 'paymongo' ? `
                            <p class="form-hint" style="margin-bottom:12px;">You'll be redirected to a secure checkout to pay by GCash, Maya, or card.</p>
                        ` : `
                            <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px;">
                                <strong>${App.escapeHtml(activeMethod.label)}:</strong> ${App.escapeHtml(activeMethod.detail || 'See your payment details')}
                            </div>
                            <div class="form-group">
                                <label>Reference Number (optional)</label>
                                <input type="text" class="form-control" id="payRef" placeholder="e.g. GCash reference #">
                            </div>
                        `}
                    </div>

                    <button class="btn btn-primary" id="btnSubmitClaim" style="width:100%;" ${cachedPlans.length ? '' : 'disabled'}>
                        ${selectedMethod === 'paymongo' ? '💳 Continue to Checkout' : '✓ Submit Payment'}
                    </button>

                    ${payments.length ? renderPaymentHistory(payments) : ''}
                </div>
            </div>
        `;
    }

    function bindPicker(el) {
        el.querySelectorAll('[data-plan-id]').forEach(card => {
            card.addEventListener('click', () => {
                selectedPlanId = card.dataset.planId;
                load(el);
            });
        });

        el.querySelectorAll('.pay-method-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedMethod = btn.dataset.method;
                load(el);
            });
        });

        const submitBtn = document.getElementById('btnSubmitClaim');
        if (submitBtn) {
            submitBtn.addEventListener('click', async () => {
                if (!selectedPlanId) { App.toast('Select a plan first', 'error'); return; }

                if (selectedMethod === 'paymongo') {
                    const cfg = window.ZE_CONFIG || {};
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Opening checkout…';
                    try {
                        const client = Supabase.getClient();
                        const { data: session } = await client.auth.getSession();
                        const token = session && session.access_token;
                        const res = await fetch(cfg.PAYMONGO_CHECKOUT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || '') },
                            body: JSON.stringify({ planId: selectedPlanId }),
                        });
                        const json = await res.json();
                        if (json.checkout_url) {
                            window.location.href = json.checkout_url;
                        } else {
                            App.toast(json.error || 'Could not start checkout', 'error');
                            submitBtn.disabled = false;
                            submitBtn.textContent = '💳 Continue to Checkout';
                        }
                    } catch (err) {
                        App.toast('Checkout error: ' + (err.message || err), 'error');
                        submitBtn.disabled = false;
                        submitBtn.textContent = '💳 Continue to Checkout';
                    }
                    return;
                }

                const reference = (document.getElementById('payRef') || {}).value || '';
                submitBtn.disabled = true;
                submitBtn.textContent = 'Submitting…';
                try {
                    const client = Supabase.getClient();
                    const { error } = await client.rpc('submit_payment_claim', {
                        p_plan_id: selectedPlanId,
                        p_method: selectedMethod,
                        p_reference: reference.trim() || null,
                    });
                    if (error) {
                        App.toast(error.message || 'Could not submit payment', 'error');
                        submitBtn.disabled = false;
                        submitBtn.textContent = '✓ Submit Payment';
                        return;
                    }
                    App.toast('Payment submitted — awaiting confirmation');
                    load(el);
                } catch (err) {
                    App.toast(err.message || 'Could not submit payment', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = '✓ Submit Payment';
                }
            });
        }
    }

    // ── Pending claim screen ────────────────────────────────────
    function renderPending(pending) {
        return `
            <div class="card" style="max-width:640px;margin:0 auto;">
                <div class="card-header">
                    <h3>⏳ Payment Under Review</h3>
                    <span class="badge badge-warning">Pending</span>
                </div>
                <div class="card-body">
                    <p class="text-muted">We've received your payment submission and it's awaiting confirmation.</p>
                    <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px;margin:16px 0;">
                        <div><strong>Plan:</strong> ${App.escapeHtml(pending.plan_name || '—')}</div>
                        <div><strong>Amount:</strong> ${App.formatCurrency(pending.amount)}</div>
                        <div><strong>Method:</strong> ${App.escapeHtml(pending.method)}</div>
                        <div class="text-muted" style="margin-top:6px;">${App.formatDateTime(pending.created_at)}</div>
                    </div>
                    <button class="btn btn-outline" id="btnRefreshPending" style="width:100%;margin-bottom:8px;">↻ Refresh Status</button>
                    <button class="btn btn-outline btn-danger" id="btnCancelClaim" style="width:100%;">Cancel Submission</button>
                </div>
            </div>
        `;
    }

    function bindPending(el, pending) {
        const refreshBtn = document.getElementById('btnRefreshPending');
        if (refreshBtn) refreshBtn.addEventListener('click', () => load(el));

        const cancelBtn = document.getElementById('btnCancelClaim');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', async () => {
                const yes = await App.confirm('Cancel Submission?', 'This will withdraw your pending payment submission.', 'Cancel Submission');
                if (!yes) return;
                try {
                    const client = Supabase.getClient();
                    const { error } = await client.rpc('cancel_payment_claim', { p_payment_id: pending.id });
                    if (error) { App.toast(error.message || 'Could not cancel', 'error'); return; }
                    App.toast('Submission cancelled');
                    load(el);
                } catch (err) {
                    App.toast(err.message || 'Could not cancel', 'error');
                }
            });
        }
    }

    // ── Active subscription: manage/renew screen ────────────────
    function renderManage(b) {
        const payments = (b.payments || []).filter(p => p.status === 'paid');
        const periodEnd = b.period_end ? App.formatDate(new Date(b.period_end).toISOString()) : '—';

        return `
            <div class="card" style="max-width:640px;margin:0 auto;">
                <div class="card-header">
                    <h3>💳 Billing & Subscription</h3>
                    <span class="badge badge-success">Active</span>
                </div>
                <div class="card-body">
                    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
                        <div class="stat-card">
                            <div class="stat-icon blue">📋</div>
                            <div class="stat-info">
                                <div class="stat-label">Plan</div>
                                <div class="stat-value">${App.escapeHtml(b.plan_name || '—')}</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon green">📅</div>
                            <div class="stat-info">
                                <div class="stat-label">Renews</div>
                                <div class="stat-value" style="font-size:0.95rem;">${periodEnd}</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon orange">💰</div>
                            <div class="stat-info">
                                <div class="stat-label">Price</div>
                                <div class="stat-value">${b.currency || '₱'} ${b.price_monthly != null ? parseFloat(b.price_monthly).toFixed(2) : '—'}</div>
                            </div>
                        </div>
                    </div>

                    <p class="form-hint" style="margin:14px 0;">
                        Want to switch plans or renew early? You can submit a new payment any time.
                    </p>
                    <button class="btn btn-primary" id="btnChangePlan" style="width:100%;margin-bottom:8px;">Change Plan / Renew</button>
                    <button class="btn btn-outline" id="btnRefreshBilling" style="width:100%;">↻ Refresh Status</button>

                    ${payments.length ? renderPaymentHistory(payments) : ''}
                </div>
            </div>
        `;
    }

    function bindManage(el) {
        const refreshBtn = document.getElementById('btnRefreshBilling');
        if (refreshBtn) refreshBtn.addEventListener('click', () => load(el));

        const changeBtn = document.getElementById('btnChangePlan');
        if (changeBtn) {
            changeBtn.addEventListener('click', async () => {
                selectedPlanId = null;
                try {
                    const client = Supabase.getClient();
                    const { data: plans } = await client.from('plans').select('*').eq('active', true).order('sort_order').order('price_monthly');
                    cachedPlans = plans || [];
                    selectedPlanId = (cachedPlans[0] && cachedPlans[0].id) || null;
                    const { data: billing } = await client.rpc('get_my_billing');
                    el.innerHTML = renderPicker(billing || {}, (billing && billing.status) || 'active', billing && billing.period_end ? new Date(billing.period_end) : null);
                    bindPicker(el);
                } catch (err) {
                    App.toast(err.message || 'Could not load plans', 'error');
                }
            });
        }
    }

    function renderPaymentHistory(payments) {
        return `
            <h4 style="margin:20px 0 8px;">Payment History</h4>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Method</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${payments.map(p => `
                            <tr>
                                <td>${App.formatDateTime(p.created_at)}</td>
                                <td><strong>${App.formatCurrency(p.amount)}</strong></td>
                                <td class="text-muted">${App.escapeHtml(p.method)}</td>
                                <td><span class="badge badge-success">Paid</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    return { render };
})();
