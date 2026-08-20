/**
 * Admin – super-admin dashboard for managing clients & subscriptions.
 * All privileged reads/writes go through SECURITY DEFINER RPCs that verify
 * is_super_admin, so the public anon key can never leak another client's data.
 */
const Admin = (() => {
    let modalResolve = null;
    let confirmResolve = null;
    let selfId = null;

    // ── tiny UI helpers (this page doesn't load app.js) ─────────
    function $(id) { return document.getElementById(id); }

    function toast(msg, type = 'success') {
        const t = document.createElement('div');
        t.className = 'toast ' + (type === 'error' ? 'error' : '');
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    function openModal(html) {
        $('adminModalContent').innerHTML = html;
        $('adminModalBackdrop').classList.add('show');
    }

    function closeModal() {
        $('adminModalBackdrop').classList.remove('show');
        $('adminModalContent').innerHTML = '';
    }

    function confirmDialog(title, text, okLabel = 'OK') {
        return new Promise(resolve => {
            confirmResolve = resolve;
            $('adminConfirmTitle').textContent = title;
            $('adminConfirmText').textContent = text;
            $('adminConfirmOk').textContent = okLabel;
            $('adminConfirmBackdrop').classList.add('show');
        });
    }

    // ── boot ────────────────────────────────────────────────────
    async function init() {
        Supabase.init();
        const session = await Supabase.getSession();
        if (!session) { window.location.href = 'index.html'; return; }
        const { profile } = await Supabase.getProfile();
        if (!profile || !profile.is_super_admin) { window.location.href = 'app.html'; return; }
        selfId = profile.id;
        $('adminUser').textContent = profile.business_name || 'Owner';

        $('btnAdminLogout').addEventListener('click', () => Supabase.signOut().then(() => { window.location.href = 'index.html'; }));
        $('btnAdminRefresh').addEventListener('click', load);
        $('btnNewPlan').addEventListener('click', () => openPlanForm(null));
        $('adminConfirmCancel').addEventListener('click', () => { $('adminConfirmBackdrop').classList.remove('show'); if (confirmResolve) confirmResolve(false); });
        $('adminConfirmOk').addEventListener('click', () => { $('adminConfirmBackdrop').classList.remove('show'); if (confirmResolve) confirmResolve(true); });
        $('adminModalBackdrop').addEventListener('click', (e) => { if (e.target === $('adminModalBackdrop')) closeModal(); });

        await load();
    }

    // ── data ────────────────────────────────────────────────────
    // ── data ────────────────────────────────────────────────────
    async function load() {
        const client = Supabase.getClient();
        const { data, error } = await client.rpc('admin_list_clients');
        if (error) {
            $('clientList').innerHTML = `<div class="empty-state"><h3>Error</h3><p>${App_escapeHtml((error.message || error).toString())}</p></div>`;
            return;
        }
        renderStats(data || []);
        renderClients(data || []);
        await loadPlans();
    }

    // ── plans data ──────────────────────────────────────────────
    let cachedPlans = [];

    async function loadPlans() {
        const client = Supabase.getClient();
        const { data, error } = await client.rpc('admin_list_plans');
        if (error) {
            $('planList').innerHTML = `<div class="empty-state"><h3>Error</h3><p>${App_escapeHtml((error.message || error).toString())}</p></div>`;
            return;
        }
        cachedPlans = data || [];
        renderPlans(cachedPlans);
    }

    function fmtDuration(p) {
        const map = { trial: 'Trial', days: 'Days', weeks: 'Weeks', months: 'Months', custom: 'Custom' };
        const label = map[p.duration_type] || p.duration_type;
        return `${p.duration_days} day${p.duration_days === 1 ? '' : 's'} (${label})`;
    }

    function renderPlans(plans) {
        if (!plans.length) {
            $('planList').innerHTML = '<div class="empty-state"><span class="icon">📦</span><h3>No plans yet</h3><p>Create your first plan.</p></div>';
            return;
        }
        $('planList').innerHTML = `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Plan</th>
                            <th>Price</th>
                            <th>Duration</th>
                            <th>Status</th>
                            <th>Clients</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${plans.map(p => `
                            <tr>
                                <td><strong>${App_escapeHtml(p.name)}</strong></td>
                                <td>${App_escapeHtml(p.currency)} ${parseFloat(p.price_monthly).toFixed(2)}</td>
                                <td class="text-muted">${fmtDuration(p)}</td>
                                <td>${p.active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Retired</span>'}</td>
                                <td class="text-muted">${p.client_count}</td>
                                <td class="text-right">
                                    <div class="btn-group" style="justify-content:flex-end;flex-wrap:wrap;">
                                        <button class="btn btn-outline btn-sm" data-plan-action="edit" data-id="${p.id}">Edit</button>
                                        <button class="btn btn-outline btn-sm" data-plan-action="toggle" data-id="${p.id}">${p.active ? 'Retire' : 'Restore'}</button>
                                        <button class="btn btn-danger btn-sm" data-plan-action="delete" data-id="${p.id}">🗑</button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        $('planList').querySelectorAll('[data-plan-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const { planAction, id } = btn.dataset;
                const plan = cachedPlans.find(p => p.id === id);
                if (planAction === 'edit') openPlanForm(plan);
                else if (planAction === 'toggle') togglePlanActive(plan);
                else if (planAction === 'delete') deletePlanConfirm(plan);
            });
        });
    }

    function openPlanForm(plan) {
        const isEdit = !!plan;
        openModal(`
            <div class="modal-header">
                <h3>${isEdit ? 'Edit Plan' : 'New Plan'}</h3>
                <button class="modal-close" onclick="Admin.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Plan Name</label>
                    <input type="text" class="form-control" id="planName" value="${isEdit ? App_escapeHtml(plan.name) : ''}" placeholder="e.g. 1-Day Trial">
                </div>
                <div class="form-group">
                    <label>Price</label>
                    <input type="number" class="form-control" id="planPrice" value="${isEdit ? plan.price_monthly : '0'}" step="0.01" min="0">
                </div>
                <div class="form-group">
                    <label>Currency</label>
                    <input type="text" class="form-control" id="planCurrency" value="${isEdit ? App_escapeHtml(plan.currency) : 'PHP'}" style="width:100px;">
                </div>
                <div class="form-group">
                    <label>Duration Type</label>
                    <select class="form-control" id="planDurationType">
                        <option value="trial" ${isEdit && plan.duration_type === 'trial' ? 'selected' : ''}>Trial</option>
                        <option value="days" ${isEdit && plan.duration_type === 'days' ? 'selected' : ''}>Days</option>
                        <option value="weeks" ${isEdit && plan.duration_type === 'weeks' ? 'selected' : ''}>Weeks</option>
                        <option value="months" ${(!isEdit || plan.duration_type === 'months') ? 'selected' : ''}>Months</option>
                        <option value="custom" ${isEdit && plan.duration_type === 'custom' ? 'selected' : ''}>Custom</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Duration (in days)</label>
                    <input type="number" class="form-control" id="planDurationDays" value="${isEdit ? plan.duration_days : '30'}" min="1" step="1">
                    <small class="form-hint">Number of days a client gets on this plan. 1-day trial = 1, 1-week = 7, monthly = 30.</small>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="planActive" ${(!isEdit || plan.active) ? 'checked' : ''}> Active (offered to clients)</label>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Admin.closeModal()">Cancel</button>
                <button class="btn btn-success" id="planSave">${isEdit ? 'Save Changes' : 'Create Plan'}</button>
            </div>
        `);

        $('planSave').addEventListener('click', () => savePlan(isEdit ? plan.id : null));
    }

    async function savePlan(planId) {
        const name = $('planName').value.trim();
        const price = parseFloat($('planPrice').value);
        const currency = $('planCurrency').value.trim() || 'PHP';
        const durationType = $('planDurationType').value;
        const durationDays = parseInt($('planDurationDays').value, 10);
        const active = $('planActive').checked;

        if (!name) { toast('Plan name is required', 'error'); return; }
        if (isNaN(price) || price < 0) { toast('Enter a valid price', 'error'); return; }
        if (!durationDays || durationDays <= 0) { toast('Duration must be at least 1 day', 'error'); return; }

        const client = Supabase.getClient();
        let error;
        if (planId) {
            ({ error } = await client.rpc('admin_update_plan', {
                p_plan_id: planId, p_name: name, p_price: price, p_duration_type: durationType,
                p_duration_days: durationDays, p_currency: currency, p_active: active,
            }));
        } else {
            ({ error } = await client.rpc('admin_create_plan', {
                p_name: name, p_price: price, p_duration_type: durationType,
                p_duration_days: durationDays, p_currency: currency, p_active: active,
            }));
        }
        if (error) { toast(error.message || 'Could not save plan', 'error'); return; }
        closeModal();
        toast(planId ? 'Plan updated' : 'Plan created');
        loadPlans();
    }

    async function togglePlanActive(plan) {
        const client = Supabase.getClient();
        const { error } = await client.rpc('admin_set_plan_active', { p_plan_id: plan.id, p_active: !plan.active });
        if (error) { toast(error.message || 'Could not update plan', 'error'); return; }
        toast(plan.active ? 'Plan retired' : 'Plan restored');
        loadPlans();
    }

    async function deletePlanConfirm(plan) {
        if (plan.client_count > 0) {
            toast(`Cannot delete — ${plan.client_count} client(s) are on this plan. Retire it instead.`, 'error');
            return;
        }
        const yes = await confirmDialog('Delete Plan?', `Permanently delete "${plan.name}"? This cannot be undone.`, 'Delete');
        if (!yes) return;
        const client = Supabase.getClient();
        const { error } = await client.rpc('admin_delete_plan', { p_plan_id: plan.id });
        if (error) { toast(error.message || 'Could not delete plan', 'error'); return; }
        toast('Plan deleted');
        loadPlans();
    }

    function App_escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s || '';
        return div.innerHTML;
    }

    function renderStats(clients) {
        const active = clients.filter(c => c.subscription_status === 'active').length;
        const overdue = clients.filter(c => c.subscription_status === 'overdue').length;
        const cancelled = clients.filter(c => c.subscription_status === 'cancelled').length;
        const never = clients.filter(c => c.subscription_status === 'never').length;

        const stat = (icon, color, label, value) => `
            <div class="stat-card">
                <div class="stat-icon ${color}">${icon}</div>
                <div class="stat-info">
                    <div class="stat-label">${label}</div>
                    <div class="stat-value">${value}</div>
                </div>
            </div>
        `;
        $('adminStats').innerHTML =
            stat('👥', 'blue', 'Total Clients', clients.length) +
            stat('✅', 'green', 'Active', active) +
            stat('⏰', 'orange', 'Overdue', overdue) +
            stat('🚫', 'red', 'Cancelled', cancelled) +
            stat('🆕', 'purple', 'Never Subscribed', never);
    }

    function statusBadge(status) {
        const map = { active: ['badge-success', 'Active'], overdue: ['badge-danger', 'Overdue'], cancelled: ['badge-warning', 'Cancelled'], never: ['badge-warning', 'No Plan'] };
        const [cls, label] = map[status] || map.never;
        return `<span class="badge ${cls}">${label}</span>`;
    }

    function renderClients(clients) {
        if (!clients.length) {
            $('clientList').innerHTML = '<div class="empty-state"><span class="icon">👥</span><h3>No clients yet</h3><p>Share the registration link to start.</p></div>';
            return;
        }
        $('clientList').innerHTML = `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Business</th>
                            <th>Plan</th>
                            <th>Status</th>
                            <th>Renews</th>
                            <th>Last Payment</th>
                            <th>Operator</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${clients.map(c => `
                            <tr>
                                <td>
                                    <strong>${App_escapeHtml(c.business_name)}</strong>
                                    <div class="shift-meta">${App_escapeHtml(c.email || '')}</div>
                                </td>
                                <td>${App_escapeHtml(c.plan_name || '—')}</td>
                                <td>${statusBadge(c.subscription_status)}</td>
                                <td class="text-muted">${c.current_period_end ? fmtDate(c.current_period_end) : '—'}</td>
                                <td class="text-muted">${c.last_payment_at ? fmtDate(c.last_payment_at) : '—'}</td>
                                <td class="text-center">
                                    ${c.is_super_admin
                                        ? (c.id === selfId
                                            ? '<span class="badge badge-success" title="You cannot change your own operator status">🛡 Operator</span>'
                                            : `<button class="btn btn-danger btn-sm" data-action="demote" data-id="${c.id}" data-name="${App_escapeHtml(c.business_name)}" data-email="${App_escapeHtml(c.email)}" title="Demote to normal client">🛡 Demote</button>`)
                                        : `<button class="btn btn-success btn-sm" data-action="promote" data-id="${c.id}" data-name="${App_escapeHtml(c.business_name)}" data-email="${App_escapeHtml(c.email)}">➕ Make Operator</button>`}
                                </td>
                                <td class="text-right">
                                    <div class="btn-group" style="justify-content:flex-end;flex-wrap:wrap;">
                                        <button class="btn btn-success btn-sm" data-action="pay" data-id="${c.id}" data-name="${App_escapeHtml(c.business_name)}">💰 Pay</button>
                                        <button class="btn btn-outline btn-sm" data-action="history" data-id="${c.id}" data-name="${App_escapeHtml(c.business_name)}">History</button>
                                        ${c.subscription_status === 'active'
                                            ? `<button class="btn btn-outline btn-sm" data-action="cancel" data-id="${c.id}" data-name="${App_escapeHtml(c.business_name)}">Cancel</button>`
                                            : `<button class="btn btn-outline btn-sm" data-action="overdue" data-id="${c.id}" data-name="${App_escapeHtml(c.business_name)}">Mark Overdue</button>`}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        $('clientList').querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const { action, id, name, email } = btn.dataset;
                if (action === 'pay') recordPayment(id, name);
                else if (action === 'history') viewPayments(id, name);
                else if (action === 'cancel') setStatus(id, 'cancelled', `Cancel ${name}'s subscription? They'll lose access immediately.`);
                else if (action === 'overdue') setStatus(id, 'overdue', `Mark ${name} as overdue?`);
                else if (action === 'promote') setOperator(id, true, `Make ${name} (${email}) a platform operator?`);
                else if (action === 'demote') setOperator(id, false, `Demote ${name} (${email}) to a normal client?`);
            });
        });
    }

    function fmtDate(iso) {
        const d = new Date(iso);
        return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // ── actions ─────────────────────────────────────────────────
    // ── actions ─────────────────────────────────────────────────
    function recordPayment(id, businessName) {
        const planOptions = cachedPlans.map(p =>
            `<option value="${p.id}" data-price="${p.price_monthly}" data-days="${p.duration_days}">${App_escapeHtml(p.name)} — ${App_escapeHtml(p.currency)} ${parseFloat(p.price_monthly).toFixed(2)} (${p.duration_days}d)</option>`
        ).join('');

        openModal(`
            <div class="modal-header">
                <h3>Record Payment — ${App_escapeHtml(businessName)}</h3>
                <button class="modal-close" onclick="Admin.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Plan</label>
                    <select class="form-control" id="payPlan">
                        <option value="">— Keep current plan —</option>
                        ${planOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>Amount (₱)</label>
                    <input type="number" class="form-control" id="payAmount" value="999" step="0.01" min="0">
                </div>
                <div class="form-group">
                    <label>Method</label>
                    <select class="form-control" id="payMethod">
                        <option value="gcash">GCash</option>
                        <option value="maya">Maya</option>
                        <option value="bank">Bank Transfer</option>
                        <option value="card">Card</option>
                        <option value="paymongo">PayMongo</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Reference (optional)</label>
                    <input type="text" class="form-control" id="payReference" placeholder="e.g. GCash ref #">
                </div>
                <small class="form-hint" id="payHint">Recording activates the client. Pick a plan above to set the exact duration, or leave it to reuse their current plan (30 days if none).</small>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Admin.closeModal()">Cancel</button>
                <button class="btn btn-success" id="paySave">✓ Activate & Save</button>
            </div>
        `);

        $('payPlan').addEventListener('change', (e) => {
            const opt = e.target.selectedOptions[0];
            const price = opt && opt.dataset.price;
            const days = opt && opt.dataset.days;
            if (price) $('payAmount').value = price;
            $('payHint').textContent = days
                ? `Recording activates the client and extends their period by ${days} day(s).`
                : `Recording activates the client. Pick a plan above to set the exact duration, or leave it to reuse their current plan (30 days if none).`;
        });

        $('paySave').addEventListener('click', async () => {
            const amount = parseFloat($('payAmount').value);
            const method = $('payMethod').value;
            const reference = $('payReference').value.trim();
            const planId = $('payPlan').value || null;
            if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }

            const client = Supabase.getClient();
            const { error } = await client.rpc('admin_record_payment', {
                p_profile: id, p_amount: amount, p_method: method, p_reference: reference || null, p_plan_id: planId,
            });
            if (error) { toast(error.message || 'Could not record payment', 'error'); return; }
            closeModal();
            toast('Payment recorded — client activated');
            load();
        });
    }

    async function viewPayments(id, businessName) {
        const client = Supabase.getClient();
        const { data, error } = await client.rpc('admin_list_payments', { p_profile: id });
        if (error) { toast(error.message || 'Could not load payments', 'error'); return; }
        const rows = data || [];
        openModal(`
            <div class="modal-header">
                <h3>Payments — ${App_escapeHtml(businessName)}</h3>
                <button class="modal-close" onclick="Admin.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                ${rows.length ? `
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th>Ref</th></tr>
                            </thead>
                            <tbody>
                                ${rows.map(p => `
                                    <tr>
                                        <td>${fmtDate(p.created_at)}</td>
                                        <td><strong>${p.amount}</strong></td>
                                        <td class="text-muted">${App_escapeHtml(p.method)}</td>
                                        <td>${p.status === 'paid' ? '<span class="badge badge-success">Paid</span>' : '<span class="badge badge-warning">' + App_escapeHtml(p.status) + '</span>'}</td>
                                        <td class="text-muted">${App_escapeHtml(p.reference || '—')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<div class="empty-state"><h3>No payments</h3></div>'}
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Admin.closeModal()">Close</button>
            </div>
        `);
    }

    async function setStatus(id, status, message) {
        const yes = await confirmDialog('Confirm', message, status === 'cancelled' ? 'Cancel' : 'Update');
        if (!yes) return;
        const client = Supabase.getClient();
        const { error } = await client.rpc('admin_set_subscription_status', { p_profile: id, p_status: status });
        if (error) { toast(error.message || 'Could not update status', 'error'); return; }
        toast('Status updated');
        load();
    }

    async function setOperator(id, make, message) {
        const yes = await confirmDialog('Confirm', message, make ? 'Make Operator' : 'Demote');
        if (!yes) return;
        const client = Supabase.getClient();
        const { error } = await client.rpc('admin_set_super_admin', { p_profile: id, p_make: make });
        if (error) { toast(error.message || 'Could not change operator status', 'error'); return; }
        toast(make ? 'Promoted to operator' : 'Demoted to client');
        load();
    }

    return { init, closeModal };
})();

document.addEventListener('DOMContentLoaded', Admin.init);
