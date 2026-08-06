/**
 * Categories – CRUD management for product categories
 */
const Categories = (() => {
    let searchTerm = '';

    function render() {
        const el = document.getElementById('page-categories');
        const categories = DB.getAll('categories');
        const filtered = searchTerm
            ? categories.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
            : categories;

        // Header actions
        document.getElementById('headerActions').innerHTML = `
            <button class="btn btn-primary" id="btnAddCategory">+ Add Category</button>
        `;
        document.getElementById('btnAddCategory').addEventListener('click', () => openForm());

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>All Categories (${filtered.length})</h3>
                    <input type="text" class="form-control" placeholder="Search categories..."
                           value="${App.escapeHtml(searchTerm)}" id="catSearch" style="width:240px;">
                </div>
                <div class="card-body" style="padding:0;">
                    ${filtered.length === 0
                        ? '<div class="empty-state"><span class="icon">📁</span><h3>No categories found</h3><p>Add your first category to get started.</p></div>'
                        : renderTable(filtered)
                    }
                </div>
            </div>
        `;

        document.getElementById('catSearch').addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
        });

        // Bind actions
        el.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', () => openForm(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="toggle"]').forEach(btn => {
            btn.addEventListener('click', () => toggleCategory(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteCategory(btn.dataset.id));
        });
    }

    function renderTable(categories) {
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Description</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${categories.map(c => `
                            <tr>
                                <td><strong>${App.escapeHtml(c.name)}</strong></td>
                                <td class="text-muted">${App.escapeHtml(c.description || '—')}</td>
                                <td>
                                    <span class="badge ${c.enabled ? 'badge-success' : 'badge-danger'}">
                                        ${c.enabled ? 'Enabled' : 'Disabled'}
                                    </span>
                                </td>
                                <td class="text-muted">${App.formatDate(c.createdAt)}</td>
                                <td class="text-right">
                                    <div class="btn-group" style="justify-content:flex-end;">
                                        <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${c.id}" title="Toggle">
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
        const cat = id ? DB.getById('categories', id) : null;
        const title = cat ? 'Edit Category' : 'Add Category';

        App.openModal(`
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Category Name <span class="required">*</span></label>
                    <input type="text" class="form-control" id="catName" value="${cat ? App.escapeHtml(cat.name) : ''}" placeholder="e.g. Burgers">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" class="form-control" id="catDesc" value="${cat ? App.escapeHtml(cat.description || '') : ''}" placeholder="Short description">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnSaveCategory">Save</button>
            </div>
        `);

        document.getElementById('btnSaveCategory').addEventListener('click', () => {
            const name = document.getElementById('catName').value.trim();
            const description = document.getElementById('catDesc').value.trim();

            if (!name) {
                App.toast('Category name is required', 'error');
                return;
            }

            if (cat) {
                DB.update('categories', id, { name, description });
                App.toast('Category updated successfully');
            } else {
                DB.insert('categories', { name, description, enabled: true });
                App.toast('Category created successfully');
            }

            App.closeModal();
            render();
        });

        document.getElementById('catName').focus();
    }

    async function toggleCategory(id) {
        const cat = DB.getById('categories', id);
        if (cat) {
            DB.update('categories', id, { enabled: !cat.enabled });
            App.toast(`Category ${cat.enabled ? 'disabled' : 'enabled'}`);
            render();
        }
    }

    async function deleteCategory(id) {
        const yes = await App.confirm('Delete Category?', 'This will not delete menu items in this category.');
        if (yes) {
            DB.remove('categories', id);
            App.toast('Category deleted');
            render();
        }
    }

    return { render };
})();
