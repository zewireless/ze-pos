/**
 * Condiments – CRUD management for add-ons / extras
 */
const Condiments = (() => {
    let searchTerm = '';

    function render() {
        const el = document.getElementById('page-condiments');
        const items = DB.getAll('condiments');
        const filtered = searchTerm
            ? items.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
            : items;

        document.getElementById('headerActions').innerHTML = `
            <button class="btn btn-primary" id="btnAddCondiment">+ Add Condiment</button>
        `;
        document.getElementById('btnAddCondiment').addEventListener('click', () => openForm());

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>All Condiments / Add-ons (${filtered.length})</h3>
                    <input type="text" class="form-control" placeholder="Search condiments..."
                           value="${App.escapeHtml(searchTerm)}" id="condSearch" style="width:240px;">
                </div>
                <div class="card-body" style="padding:0;">
                    ${filtered.length === 0
                        ? '<div class="empty-state"><span class="icon">🧀</span><h3>No condiments found</h3><p>Add extras that customers can add to their orders.</p></div>'
                        : renderTable(filtered)
                    }
                </div>
            </div>
        `;

        document.getElementById('condSearch').addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
        });

        el.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', () => openForm(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="toggle"]').forEach(btn => {
            btn.addEventListener('click', () => toggleItem(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteItem(btn.dataset.id));
        });
    }

    function renderTable(items) {
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Price</th>
                            <th>Status</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(c => `
                            <tr>
                                <td><strong>${App.escapeHtml(c.name)}</strong></td>
                                <td><strong>${App.formatCurrency(c.price)}</strong></td>
                                <td><span class="badge ${c.enabled ? 'badge-success' : 'badge-danger'}">${c.enabled ? 'Active' : 'Inactive'}</span></td>
                                <td class="text-right">
                                    <div class="btn-group" style="justify-content:flex-end;">
                                        <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${c.id}">
                                            ${c.enabled ? '🔴' : '🟢'}
                                        </button>
                                        <button class="btn btn-outline btn-sm" data-action="edit" data-id="${c.id}">Edit</button>
                                        <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${c.id}" style="color:var(--danger);">🗑</button>
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
        const item = id ? DB.getById('condiments', id) : null;
        const title = item ? 'Edit Condiment' : 'Add Condiment';

        App.openModal(`
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Name <span class="required">*</span></label>
                    <input type="text" class="form-control" id="condName" value="${item ? App.escapeHtml(item.name) : ''}" placeholder="e.g. Extra Cheese">
                </div>
                <div class="form-group">
                    <label>Price <span class="required">*</span></label>
                    <input type="number" class="form-control" id="condPrice" value="${item ? item.price : '0.00'}" step="0.01" min="0" placeholder="0.00">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnSaveCond">Save</button>
            </div>
        `);

        document.getElementById('btnSaveCond').addEventListener('click', () => {
            const name = document.getElementById('condName').value.trim();
            const price = parseFloat(document.getElementById('condPrice').value) || 0;

            if (!name) { App.toast('Name is required', 'error'); return; }

            if (item) {
                DB.update('condiments', id, { name, price });
                DB.logAction('condiment_update', 'condiments', id, { name, price });
                App.toast('Condiment updated');
            } else {
                const rec = DB.insert('condiments', { name, price, enabled: true });
                DB.logAction('condiment_add', 'condiments', rec.id, { name, price });
                App.toast('Condiment added');
            }

            App.closeModal();
            render();
        });

        document.getElementById('condName').focus();
    }

    async function toggleItem(id) {
        const item = DB.getById('condiments', id);
        if (item) {
            DB.update('condiments', id, { enabled: !item.enabled });
            DB.logAction('condiment_toggle', 'condiments', id, { name: item.name, enabled: !item.enabled });
            App.toast(`Condiment ${item.enabled ? 'disabled' : 'enabled'}`);
            render();
        }
    }

    async function deleteItem(id) {
        const item = DB.getById('condiments', id);
        const yes = await App.confirm('Delete Condiment?', 'This condiment will be removed from all future orders.');
        if (yes) {
            DB.remove('condiments', id);
            DB.logAction('condiment_delete', 'condiments', id, { name: item ? item.name : null });
            App.toast('Condiment deleted');
            render();
        }
    }

    return { render };
})();
