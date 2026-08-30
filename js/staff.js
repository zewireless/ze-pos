/**
 * Staff – CRUD management for admin and cashier accounts
 */
const Staff = (() => {
    let searchTerm = '';

    function render() {
        const el = document.getElementById('page-staff');
        const users = DB.getAll('users');
        const filtered = searchTerm
            ? users.filter(u =>
                u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                u.username.toLowerCase().includes(searchTerm.toLowerCase())
            )
            : users;

        // Header actions
        document.getElementById('headerActions').innerHTML = `
            <button class="btn btn-primary" id="btnAddStaff">+ Add Staff</button>
        `;
        document.getElementById('btnAddStaff').addEventListener('click', () => openForm());

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>All Staff (${filtered.length})</h3>
                    <input type="text" class="form-control" placeholder="Search by name or username..."
                           value="${App.escapeHtml(searchTerm)}" id="staffSearch" style="width:240px;">
                </div>
                <div class="card-body" style="padding:0;">
                    ${filtered.length === 0
                        ? '<div class="empty-state"><span class="icon">👥</span><h3>No staff found</h3><p>Add your first cashier or staff member to get started.</p></div>'
                        : renderTable(filtered)
                    }
                </div>
            </div>
        `;

        document.getElementById('staffSearch').addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
        });

        // Bind actions
        el.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', () => openForm(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="invite"]').forEach(btn => {
            btn.addEventListener('click', () => generateInvite(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="toggle"]').forEach(btn => {
            btn.addEventListener('click', () => toggleStaff(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteStaff(btn.dataset.id));
        });
    }

    function renderTable(users) {
        const currentUserId = Auth.currentUser().id;

        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Username</th>
                            <th>Role</th>
                            <th>Pay</th>
                            <th>Status</th>
                            <th>Account</th>
                            <th>Created</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map(u => `
                            <tr>
                                <td>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <div class="sidebar-avatar" style="width:32px;height:32px;font-size:13px;flex-shrink:0;">
                                            ${u.name.charAt(0).toUpperCase()}
                                        </div>
                                        <strong>${App.escapeHtml(u.name)}</strong>
                                    </div>
                                </td>
                                <td class="text-muted">${App.escapeHtml(u.username)}</td>
                                <td>
                                    <span class="badge ${u.role === 'admin' ? 'badge-primary' : 'badge-success'}">
                                        ${u.role === 'admin' ? 'Admin' : 'Cashier'}
                                    </span>
                                </td>
                                <td class="text-muted">
                                    ${u.role === 'admin'
                                        ? '—'
                                        : u.payType === 'fixed'
                                            ? `${App.formatCurrency(u.fixedSalary || 0)} /wk`
                                            : `${App.formatCurrency(u.hourlyRate || 0)} /hr`
                                    }
                                </td>
                                <td>
                                    <span class="badge ${u.enabled !== false ? 'badge-success' : 'badge-danger'}">
                                        ${u.enabled !== false ? 'Active' : 'Disabled'}
                                    </span>
                                </td>
                                <td>
                                    ${u.authUid
                                        ? '<span class="badge badge-primary">✓ Login linked</span>'
                                        : `<button class="btn btn-outline btn-sm" data-action="invite" data-id="${u.id}">🔗 Invite</button>`
                                    }
                                </td>
                                <td class="text-muted">${App.formatDate(u.createdAt)}</td>
                                <td class="text-right">
                                    <div class="btn-group" style="justify-content:flex-end;">
                                        ${u.id !== currentUserId ? `
                                            <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${u.id}" title="Toggle status">
                                                ${u.enabled !== false ? '🔴' : '🟢'}
                                            </button>
                                        ` : ''}
                                        <button class="btn btn-outline btn-sm" data-action="edit" data-id="${u.id}">Edit</button>
                                        ${u.id !== currentUserId ? `
                                            <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${u.id}" style="color:var(--danger);">🗑</button>
                                        ` : ''}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function openForm(id) {
        const user = id ? DB.getById('users', id) : null;
        const title = user ? 'Edit Staff' : 'Add New Staff';
        const isEdit = !!user;

        App.openModal(`
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Full Name <span class="required">*</span></label>
                    <input type="text" class="form-control" id="staffName"
                           value="${user ? App.escapeHtml(user.name) : ''}"
                           placeholder="e.g. Juan Dela Cruz">
                </div>
                <div class="form-group">
                    <label>Username <span class="required">*</span></label>
                    <input type="text" class="form-control" id="staffUsername"
                           value="${user ? App.escapeHtml(user.username) : ''}"
                           placeholder="e.g. juan123"
                           ${isEdit ? 'readonly style="background:#f1f5f9;cursor:not-allowed;"' : ''}>
                </div>
                <div class="form-group">
                    <label>Sign-in account</label>
                    <p class="form-hint" style="margin:0;">Staff create their own account with an invite code — you never see their password. After saving, click <strong>🔗 Invite</strong> on the staff list to generate their one-time code.</p>
                </div>
                <div class="form-group">
                    <label>Role <span class="required">*</span></label>
                    <select class="form-control" id="staffRole">
                        <option value="cashier" ${user && user.role === 'cashier' ? 'selected' : ''}>Cashier</option>
                        <option value="admin" ${user && user.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </div>

                <div class="form-group" id="staffPinSection" style="display:none;">
                    <label>Manager PIN</label>
                    <input type="text" class="form-control" id="staffManagerPin" inputmode="numeric" maxlength="6"
                           value="${user && user.managerPin ? App.escapeHtml(user.managerPin) : ''}"
                           placeholder="4–6 digits">
                    <small class="form-hint">Cashiers enter this PIN to authorize voiding a completed order. Leave blank to disable void authorization for this admin.</small>
                </div>

                <div class="form-group" id="staffPaySection" style="display:none;">
                    <label>Pay Type</label>
                    <select class="form-control" id="staffPayType">
                        <option value="hourly" ${!user || user.payType !== 'fixed' ? 'selected' : ''}>Hourly (per hour)</option>
                        <option value="fixed" ${user && user.payType === 'fixed' ? 'selected' : ''}>Fixed (per week)</option>
                    </select>
                </div>
                <div class="form-group" id="staffHourlyWrap" style="display:none;">
                    <label>Hourly Rate (₱) <span class="required">*</span></label>
                    <input type="number" class="form-control" id="staffHourlyRate" step="0.01" min="0"
                           value="${user ? (user.hourlyRate ?? 0) : ''}"
                           placeholder="e.g. 12.50">
                    <small class="form-hint">Paid per hour worked. Payroll = hours × rate.</small>
                </div>
                <div class="form-group" id="staffFixedWrap" style="display:none;">
                    <label>Fixed Salary ($ / week) <span class="required">*</span></label>
                    <input type="number" class="form-control" id="staffFixedSalary" step="0.01" min="0"
                           value="${user ? (user.fixedSalary ?? 0) : ''}"
                           placeholder="e.g. 480">
                    <small class="form-hint">Flat amount per week, regardless of hours.</small>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnSaveStaff">Save</button>
            </div>
        `);

        // Show pay fields only for cashiers; toggle hourly vs fixed.
        // Show the Manager PIN field only for admins (used to authorize
        // cashier-initiated order voids).
        const updatePayVisibility = () => {
            const isCashier = document.getElementById('staffRole').value === 'cashier';
            const isFixed = document.getElementById('staffPayType').value === 'fixed';
            document.getElementById('staffPaySection').style.display = isCashier ? '' : 'none';
            document.getElementById('staffHourlyWrap').style.display = isCashier && !isFixed ? '' : 'none';
            document.getElementById('staffFixedWrap').style.display = isCashier && isFixed ? '' : 'none';
            document.getElementById('staffPinSection').style.display = isCashier ? 'none' : '';
        };
        document.getElementById('staffRole').addEventListener('change', updatePayVisibility);
        document.getElementById('staffPayType').addEventListener('change', updatePayVisibility);
        updatePayVisibility();

        document.getElementById('btnSaveStaff').addEventListener('click', async () => {
            const btnSave = document.getElementById('btnSaveStaff');
            const name = document.getElementById('staffName').value.trim();
            const username = document.getElementById('staffUsername').value.trim();
            const role = document.getElementById('staffRole').value;

            // Validation
            if (!name) {
                App.toast('Full name is required', 'error');
                return;
            }
            if (!username) {
                App.toast('Username is required', 'error');
                return;
            }

            // Check username uniqueness (only for new users)
            if (!isEdit) {
                const existing = DB.query('users', u => u.username === username);
                if (existing.length > 0) {
                    App.toast('Username already exists', 'error');
                    return;
                }
            }

            // Pay settings (cashiers only)
            let payType = 'hourly', hourlyRate = 0, fixedSalary = 0;
            if (role === 'cashier') {
                payType = document.getElementById('staffPayType').value === 'fixed' ? 'fixed' : 'hourly';
                hourlyRate = Math.max(0, parseFloat(document.getElementById('staffHourlyRate').value) || 0);
                fixedSalary = Math.max(0, parseFloat(document.getElementById('staffFixedSalary').value) || 0);
            }

            // Manager PIN (admins only) — used to authorize cashier voids
            let managerPin = '';
            if (role === 'admin') {
                managerPin = document.getElementById('staffManagerPin').value.trim();
                if (managerPin && !/^\d{4,6}$/.test(managerPin)) {
                    App.toast('Manager PIN must be 4–6 digits', 'error');
                    return;
                }
            }

            if (isEdit) {
                DB.update('users', id, { name, role, payType, hourlyRate, fixedSalary, managerPin });
                DB.logAction('staff_update', 'users', id, { name, role, payType, hourlyRate, fixedSalary });
                App.toast('Staff updated successfully');
            } else {
                const rec = DB.insert('users', {
                    name,
                    username,
                    role,
                    enabled: true,
                    payType,
                    hourlyRate,
                    fixedSalary,
                    managerPin,
                });
                // Auto-assign new staff to current store
                try {
                    await DB.assignUserToStore(rec.id, DB.getCurrentStore());
                } catch (e) {
                    console.warn('Auto-assign store failed:', e.message);
                }
                DB.logAction('staff_add', 'users', rec.id, { name, username, role, payType });
                // Make sure the new row has actually reached Supabase before
                // the admin can click "Invite" on it — that check runs
                // server-side and fails with "Staff member not found" if
                // this row isn't there yet.
                btnSave.disabled = true;
                btnSave.textContent = 'Saving...';
                await DB.flushOutbox();
                App.toast('Staff member added. Click 🔗 Invite to give them sign-in access.');
            }

            App.closeModal();
            render();
        });

        document.getElementById('staffName').focus();
    }

    async function generateInvite(id) {
        const user = DB.getById('users', id);
        if (!user) return;

        const client = Supabase.getClient();
        let { data: code, error } = await client.rpc('create_workspace_invite', { p_user_id: id });

        // If the server doesn't see this row yet, it's almost certainly a
        // background write that hasn't landed — flush it and retry once
        // before surfacing an error to the admin.
        if (error && /not found/i.test(error.message || '')) {
            await DB.flushOutbox();
            ({ data: code, error } = await client.rpc('create_workspace_invite', { p_user_id: id }));
        }

        if (error) {
            App.toast(error.message || 'Could not generate invite', 'error');
            return;
        }
        DB.logAction('staff_invite', 'users', id, { name: user.name });

        const joinUrl = `${window.location.origin}/join.html`;
        App.openModal(`
            <div class="modal-header">
                <h3>Invite ${App.escapeHtml(user.name)}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p class="text-muted" style="margin-bottom:16px;">Share this one-time code (valid 7 days). They open the join link, enter their own email + password + this code, and they're in.</p>
                <div class="invite-code">${App.escapeHtml(code)}</div>
                <div class="form-group" style="margin-top:16px;">
                    <label>Join link</label>
                    <input type="text" class="form-control" readonly value="${App.escapeHtml(joinUrl)}" onclick="this.select()">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" id="btnCopyInvite">📋 Copy Code</button>
                <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
            </div>
        `);

        document.getElementById('btnCopyInvite').addEventListener('click', () => {
            if (navigator.clipboard) navigator.clipboard.writeText(code);
            App.toast('Invite code copied');
        });
    }

    async function toggleStaff(id) {
        const user = DB.getById('users', id);
        if (user) {
            const newStatus = user.enabled === false ? true : false;
            DB.update('users', id, { enabled: newStatus });
            DB.logAction('staff_toggle', 'users', id, { name: user.name, enabled: newStatus });
            App.toast(`${user.name} is now ${newStatus ? 'active' : 'disabled'}`);
            render();
        }
    }

    async function deleteStaff(id) {
        const user = DB.getById('users', id);
        if (!user) return;

        const yes = await App.confirm(
            'Delete Staff Member?',
            `Are you sure you want to delete "${user.name}"? This cannot be undone.`
        );
        if (yes) {
            DB.remove('users', id);
            // Remove the deleted staff member's shift schedules
            DB.getAll('shift_schedules')
                .filter(s => s.userId === id)
                .forEach(s => DB.remove('shift_schedules', s.id));
            DB.logAction('staff_delete', 'users', id, { name: user.name, role: user.role });
            App.toast('Staff member deleted');
            render();
        }
    }

    return { render };
})();
