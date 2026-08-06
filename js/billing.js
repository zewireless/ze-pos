/**
 * Billing – subscription status, paywall, and payment flow.
 *
 * Default flow is MANUAL billing (GCash / Maya / bank transfer shown to the
 * client; the owner activates them from the admin dashboard). When
 * ZE_CONFIG.PAYMONGO_ENABLED is true, an online PayMongo checkout is offered.
 */
const Billing = (() => {
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
            const { data: plans } = await client.from('plans').select('*').eq('active', true).order('price_monthly').limit(1);
            const plan = (plans && plans[0]) || null;
            const b = billing || {};

            const status = b.status || 'never';
            const periodEnd = b.period_end ? new Date(b.period_end) : null;
            const isActive = status === 'active' && (!periodEnd || periodEnd.getTime() > Date.now());

            el.innerHTML = isActive ? renderManage(b, plan) : renderPaywall(b, plan, status, periodEnd);
            bind(el, b, isActive);
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

    function renderPaywall(b, plan, status, periodEnd) {
        const cfg = window.ZE_CONFIG || {};
        const price = plan ? `${plan.currency} ${parseFloat(plan.price_monthly).toFixed(2)}` : '';
        const details = cfg.BUSINESS_PAYMENT_DETAILS || {};
        const payments = (b.payments || []).filter(p => p.status === 'paid');

        return `
            <div class="card" style="max-width:640px;margin:0 auto;">
                <div class="card-header">
                    <h3>🔒 Subscription Required</h3>
                    ${statusBadge(status, periodEnd)}
                </div>
                <div class="card-body">
                    <p class="text-muted">Your ZE-POS workspace is paused. Subscribe to the monthly plan to unlock your POS.</p>

                    <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:18px;margin:16px 0;">
                        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                            <div>
                                <strong>${App.escapeHtml((plan && plan.name) || (b.plan_name || 'ZE-POS Monthly'))}</strong>
                                <div class="shift-meta">${price || ''} / month · cancel anytime</div>
                            </div>
                            <div style="font-size:26px;font-weight:800;">${price || ''}</div>
                        </div>
                    </div>

                    <h4 style="margin-bottom:8px;">How to pay</h4>
                    <div class="table-container" style="margin-bottom:16px;">
                        <table>
                            <tbody>
                                <tr><td style="width:140px;"><strong>GCash</strong></td><td>${App.escapeHtml(details.gcash || 'See your payment details')}</td></tr>
                                <tr><td><strong>Maya</strong></td><td>${App.escapeHtml(details.maya || '—')}</td></tr>
                                <tr><td><strong>Bank transfer</strong></td><td>${App.escapeHtml(details.bank || '—')}</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <p class="form-hint" style="margin-bottom:16px;">
                        Send the monthly fee, then we'll activate your subscription shortly. You'll see your previous payments below.
                    </p>

                    ${cfg.PAYMONGO_ENABLED ? `
                        <button class="btn btn-primary" id="btnPayOnline" style="width:100%;margin-bottom:8px;">💳 Pay Online (GCash / Maya / Card)</button>
                    ` : ''}
                    <button class="btn btn-outline" id="btnRefreshBilling" style="width:100%;">↻ I've paid — Check Status</button>

                    ${payments.length ? renderPaymentHistory(payments) : ''}
                </div>
            </div>
        `;
    }

    function renderManage(b, plan) {
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
                                <div class="stat-value">${App.escapeHtml(b.plan_name || 'ZE-POS Monthly')}</div>
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
                                <div class="stat-label">Monthly</div>
                                <div class="stat-value">${b.currency || '₱'} ${b.price_monthly != null ? parseFloat(b.price_monthly).toFixed(2) : '999.00'}</div>
                            </div>
                        </div>
                    </div>

                    <p class="form-hint" style="margin:14px 0;">
                        Payments are processed manually or online. To cancel, simply stop your monthly payment — access ends at the renewal date.
                    </p>
                    <button class="btn btn-outline" id="btnRefreshBilling">↻ Refresh Status</button>

                    ${payments.length ? renderPaymentHistory(payments) : ''}
                </div>
            </div>
        `;
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

    function bind(el, b, isActive) {
        const refreshBtn = document.getElementById('btnRefreshBilling');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => load(el));
        }

        const payBtn = document.getElementById('btnPayOnline');
        if (payBtn) {
            payBtn.addEventListener('click', async () => {
                const cfg = window.ZE_CONFIG || {};
                payBtn.disabled = true;
                payBtn.textContent = 'Opening checkout…';
                try {
                    const client = Supabase.getClient();
                    const { data: session } = await client.auth.getSession();
                    const token = session && session.access_token;
                    const res = await fetch(cfg.PAYMONGO_CHECKOUT_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + (token || ''),
                        },
                        body: JSON.stringify({ planId: b.plan_id || null }),
                    });
                    const json = await res.json();
                    if (json.checkout_url) {
                        window.location.href = json.checkout_url;
                    } else {
                        App.toast(json.error || 'Could not start checkout', 'error');
                        payBtn.disabled = false;
                        payBtn.textContent = '💳 Pay Online (GCash / Maya / Card)';
                    }
                } catch (err) {
                    App.toast('Checkout error: ' + (err.message || err), 'error');
                    payBtn.disabled = false;
                    payBtn.textContent = '💳 Pay Online (GCash / Maya / Card)';
                }
            });
        }
    }

    return { render };
})();
