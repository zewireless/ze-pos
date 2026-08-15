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
        $('adminConfirmCancel').addEventListener('click', () => { $('adminConfirmBackdrop').classList.remove('show'); if (confirmResolve) confirmResolve(false); });
        $('adminConfirmOk').addEventListener('click', () => { $('adminConfirmBackdrop').classList.remove('show'); if (confirmResolve) confirmResolve(true); });
        $('adminModalBackdrop').addEventListener('click', (e) => { if (e.target === $('adminModalBackdrop')) closeModal(); });

        await load();
    }

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
    function recordPayment(id, businessName) {
        openModal(`
            <div class="modal-header">
                <h3>Record Payment — ${App_escapeHtml(businessName)}</h3>
                <button class="modal-close" onclick="Admin.closeModal()">✕</button>
            </div>
            <div class="modal-body">
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
                <small class="form-hint">Recording activates the client and extends their period by 30 days.</small>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Admin.closeModal()">Cancel</button>
                <button class="btn btn-success" id="paySave">✓ Activate & Save</button>
            </div>
        `);

        $('paySave').addEventListener('click', async () => {
            const amount = parseFloat($('payAmount').value);
            const method = $('payMethod').value;
            const reference = $('payReference').value.trim();
            if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }

            const client = Supabase.getClient();
            const { error } = await client.rpc('admin_record_payment', { p_profile: id, p_amount: amount, p_method: method, p_reference: reference || null });
            if (error) { toast(error.message || 'Could not record payment', 'error'); return; }
            closeModal();
            toast('Payment recorded — client activated for 30 days');
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
