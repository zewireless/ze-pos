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
                    <label>${isEdit ? 'New Password (leave blank to keep current)' : 'Password'} ${!isEdit ? '<span class="required">*</span>' : ''}</label>
                    <input type="password" class="form-control" id="staffPassword"
                           placeholder="${isEdit ? '••••••••' : 'Enter password'}">
                </div>
                <div class="form-group">
                    <label>Role <span class="required">*</span></label>
                    <select class="form-control" id="staffRole">
                        <option value="cashier" ${user && user.role === 'cashier' ? 'selected' : ''}>Cashier</option>
                        <option value="admin" ${user && user.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </div>

                <div class="form-group" id="staffPaySection" style="display:none;">
                    <label>Pay Type</label>
                    <select class="form-control" id="staffPayType">
                        <option value="hourly" ${!user || user.payType !== 'fixed' ? 'selected' : ''}>Hourly (per hour)</option>
                        <option value="fixed" ${user && user.payType === 'fixed' ? 'selected' : ''}>Fixed (per week)</option>
                    </select>
                </div>
                <div class="form-group" id="staffHourlyWrap" style="display:none;">
                    <label>Hourly Rate ($) <span class="required">*</span></label>
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

        // Show pay fields only for cashiers; toggle hourly vs fixed
        const updatePayVisibility = () => {
            const isCashier = document.getElementById('staffRole').value === 'cashier';
            const isFixed = document.getElementById('staffPayType').value === 'fixed';
            document.getElementById('staffPaySection').style.display = isCashier ? '' : 'none';
            document.getElementById('staffHourlyWrap').style.display = isCashier && !isFixed ? '' : 'none';
            document.getElementById('staffFixedWrap').style.display = isCashier && isFixed ? '' : 'none';
        };
        document.getElementById('staffRole').addEventListener('change', updatePayVisibility);
        document.getElementById('staffPayType').addEventListener('change', updatePayVisibility);
        updatePayVisibility();

        document.getElementById('btnSaveStaff').addEventListener('click', () => {
            const name = document.getElementById('staffName').value.trim();
            const username = document.getElementById('staffUsername').value.trim();
            const password = document.getElementById('staffPassword').value;
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
            if (!isEdit && !password) {
                App.toast('Password is required', 'error');
                return;
            }
            if (!isEdit && password.length < 4) {
                App.toast('Password must be at least 4 characters', 'error');
                return;
            }
            if (isEdit && password && password.length < 4) {
                App.toast('Password must be at least 4 characters', 'error');
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

            if (isEdit) {
                const updates = { name, role, payType, hourlyRate, fixedSalary };
                if (password) {
                    updates.password = password;
                }
                DB.update('users', id, updates);
                App.toast('Staff updated successfully');
            } else {
                DB.insert('users', {
                    name,
                    username,
                    password,
                    role,
                    enabled: true,
                    payType,
                    hourlyRate,
                    fixedSalary,
                });
                App.toast('Staff member added successfully');
            }

            App.closeModal();
            render();
        });

        document.getElementById('staffName').focus();
    }

    async function toggleStaff(id) {
        const user = DB.getById('users', id);
        if (user) {
            const newStatus = user.enabled === false ? true : false;
            DB.update('users', id, { enabled: newStatus });
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
            App.toast('Staff member deleted');
            render();
        }
    }

    return { render };
})();
