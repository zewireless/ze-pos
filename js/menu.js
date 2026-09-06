/**
 * Menu – CRUD management for menu items with sizes
 */
const Menu = (() => {
    let searchTerm = '';
    let filterCategory = '';

    function render() {
        const el = document.getElementById('page-menu');
        const items = DB.getAll('menu_items');
        const categories = DB.getAll('categories');

        let filtered = items;
        if (searchTerm) {
            filtered = filtered.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        if (filterCategory) {
            filtered = filtered.filter(i => i.categoryId === filterCategory);
        }

        document.getElementById('headerActions').innerHTML = `
            <button class="btn btn-primary" id="btnAddMenu">+ Add Item</button>
        `;
        document.getElementById('btnAddMenu').addEventListener('click', () => openForm());

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>All Menu Items (${filtered.length})</h3>
                    <div style="display:flex;gap:10px;">
                        <select class="form-control" id="menuCatFilter" style="width:180px;">
                            <option value="">All Categories</option>
                            ${categories.map(c => `<option value="${c.id}" ${filterCategory === c.id ? 'selected' : ''}>${App.escapeHtml(c.name)}</option>`).join('')}
                        </select>
                        <input type="text" class="form-control" placeholder="Search items..."
                               value="${App.escapeHtml(searchTerm)}" id="menuSearch" style="width:200px;">
                    </div>
                </div>
                <div class="card-body" style="padding:0;">
                    ${filtered.length === 0
                        ? '<div class="empty-state"><span class="icon">📋</span><h3>No menu items found</h3><p>Add your first menu item to get started.</p></div>'
                        : renderTable(filtered, categories)
                    }
                </div>
            </div>
        `;

        document.getElementById('menuSearch').addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
        });
        document.getElementById('menuCatFilter').addEventListener('change', (e) => {
            filterCategory = e.target.value;
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

    function renderTable(items, categories) {
        const catMap = {};
        categories.forEach(c => catMap[c.id] = c.name);

        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Image</th>
                            <th>Name</th>
                            <th>Category</th>
                            <th>Sizes</th>
                            <th>Price Range</th>
                            <th>Status</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(item => {
                            const sizes = DB.query('menu_sizes', s => s.menuItemId === item.id);
                            const prices = sizes.map(s => parseFloat(s.price) || 0);
                            const minPrice = prices.length ? Math.min(...prices) : 0;
                            const maxPrice = prices.length ? Math.max(...prices) : 0;
                            return `
                                <tr>
                                    <td>
                                        <div style="width:48px;height:48px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden;">
                                            ${App.safeImageUrl(item.image)
                                                ? `<img src="${App.safeImageUrl(item.image)}" style="width:100%;height:100%;object-fit:cover;">`
                                                : '<span style="font-size:1.5rem;">🍽</span>'
                                            }
                                        </div>
                                    </td>
                                    <td>
                                        <strong>${App.escapeHtml(item.name)}</strong>
                                        <br><small class="text-muted">${App.escapeHtml(item.description || '')}</small>
                                    </td>
                                    <td><span class="badge badge-purple">${App.escapeHtml(catMap[item.categoryId] || '—')}</span></td>
                                    <td>${sizes.map(s => `<span class="badge badge-gray">${App.escapeHtml(s.name)}: ${App.formatCurrency(s.price)}</span> `).join('') || '<span class="text-muted">No sizes</span>'}</td>
                                    <td>${prices.length > 1 ? App.formatCurrency(minPrice) + ' – ' + App.formatCurrency(maxPrice) : App.formatCurrency(minPrice)}</td>
                                    <td><span class="badge ${item.enabled ? 'badge-success' : 'badge-danger'}">${item.enabled ? 'Active' : 'Inactive'}</span></td>
                                    <td class="text-right">
                                        <div class="btn-group" style="justify-content:flex-end;">
                                            <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${item.id}">
                                                ${item.enabled ? '🔴' : '🟢'}
                                            </button>
                                            <button class="btn btn-outline btn-sm" data-action="edit" data-id="${item.id}">Edit</button>
                                            <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${item.id}" style="color:var(--danger);">🗑</button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function openForm(id) {
        const item = id ? DB.getById('menu_items', id) : null;
        const categories = DB.getAll('categories').filter(c => c.enabled);
        const allCondiments = DB.getAll('condiments').filter(c => c.enabled);
        const sizes = id ? DB.query('menu_sizes', s => s.menuItemId === id) : [];
        const title = item ? 'Edit Menu Item' : 'Add Menu Item';

        App.openModal(`
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Item Name <span class="required">*</span></label>
                    <input type="text" class="form-control" id="itemName" value="${item ? App.escapeHtml(item.name) : ''}" placeholder="e.g. Zinger Burger">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" class="form-control" id="itemDesc" value="${item ? App.escapeHtml(item.description || '') : ''}" placeholder="Short description">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Category <span class="required">*</span></label>
                        <select class="form-control" id="itemCategory">
                            <option value="">Select category</option>
                            ${categories.map(c => `<option value="${c.id}" ${item && item.categoryId === c.id ? 'selected' : ''}>${App.escapeHtml(c.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Image</label>
                        <div class="image-upload" id="imageUpload">
                            <span class="icon">📷</span>
                            <span>Upload</span>
                            <input type="file" accept="image/*" id="itemImage">
                        </div>
                    </div>
                </div>

                <h4 style="margin-bottom:12px;font-size:0.95rem;">Sizes & Prices</h4>
                <div id="sizesContainer">
                    ${sizes.length > 0 ? sizes.map((s, i) => sizeRow(s.name, s.price, i)).join('') : sizeRow('Regular', '', 0)}
                </div>
                <button class="btn btn-outline btn-sm" id="addSizeBtn" style="margin-bottom:20px;">+ Add Size</button>

                <div class="form-group">
                    <label>Notes (visible to kitchen)</label>
                    <input type="text" class="form-control" id="itemNotes" value="${item ? App.escapeHtml(item.notes || '') : ''}" placeholder="Optional notes">
                </div>
                ${item && App.hasFeature('MultiStore') ? `
                <div class="form-group" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" id="itemApplyAllStores" checked style="width:auto;">
                    <label for="itemApplyAllStores" style="margin:0;">Apply these changes to this item in every other store too</label>
                </div>
                <div class="text-muted" style="font-size:12px;margin-top:-6px;margin-bottom:10px;">Uncheck this if you want this store's price/name to stay different from the others.</div>
                ` : ''}
            </div>
            <div class="modal-footer">
                ${item && App.hasFeature('MultiStore') ? `<button class="btn btn-outline" id="btnCopyToStores" style="margin-right:auto;" title="Copy this item (and its category) to every other store">📋 Copy to Other Stores</button>` : ''}
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnSaveMenu">Save</button>
            </div>
        `);

        // Image preview
        const imgInput = document.getElementById('itemImage');
        const imgUpload = document.getElementById('imageUpload');
        if (item && item.image) {
            imgUpload.innerHTML = `<img src="${App.safeImageUrl(item.image)}"><input type="file" accept="image/*" id="itemImage">`;
            // Re-bind after innerHTML change
            document.getElementById('itemImage').addEventListener('change', handleImageUpload);
        }
        imgInput.addEventListener('change', handleImageUpload);

        // Add size
        let sizeIndex = sizes.length || 1;
        document.getElementById('addSizeBtn').addEventListener('click', () => {
            const container = document.getElementById('sizesContainer');
            container.insertAdjacentHTML('beforeend', sizeRow('', '', sizeIndex++));
            bindSizeRemove();
        });

        bindSizeRemove();

        // Retroactive copy — for items that existed before auto-copy-on-
        // create was added, or that were only added to one store on
        // purpose and are now needed elsewhere too.
        document.getElementById('btnCopyToStores')?.addEventListener('click', async () => {
            const btn = document.getElementById('btnCopyToStores');
            btn.disabled = true;
            btn.textContent = 'Copying…';
            const cat = DB.getById('categories', item.categoryId);
            if (cat) await DB.propagateToStores('categories', cat);
            await DB.propagateToStores('menu_items', item);
            const curSizes = DB.query('menu_sizes', s => s.menuItemId === item.id);
            for (const s of curSizes) await DB.propagateToStores('menu_sizes', s);
            App.toast(`"${item.name}" copied to other stores`);
            btn.disabled = false;
            btn.textContent = '📋 Copy to Other Stores';
        });

        // Save
        document.getElementById('btnSaveMenu').addEventListener('click', () => {
            const name = document.getElementById('itemName').value.trim();
            const description = document.getElementById('itemDesc').value.trim();
            const categoryId = document.getElementById('itemCategory').value;
            const notes = document.getElementById('itemNotes').value.trim();

            if (!name) { App.toast('Item name is required', 'error'); return; }
            if (!categoryId) { App.toast('Please select a category', 'error'); return; }

            // Collect sizes
            const sizeEls = document.querySelectorAll('.size-row');
            const sizeData = [];
            sizeEls.forEach(row => {
                const sName = row.querySelector('.size-name-input').value.trim();
                const sPrice = parseFloat(row.querySelector('.size-price-input').value) || 0;
                if (sName) sizeData.push({ name: sName, price: sPrice });
            });
            if (sizeData.length === 0) {
                App.toast('Add at least one size with a name', 'error');
                return;
            }

            // Image
            const imgEl = document.getElementById('imageUpload');
            const imgTag = imgEl.querySelector('img');
            const image = imgTag ? imgTag.src : '';

            const imageData = { name, description, categoryId, notes, image };

            if (item) {
                DB.update('menu_items', id, imageData);
                // Replace sizes
                const oldSizes = DB.query('menu_sizes', s => s.menuItemId === id);
                oldSizes.forEach(s => DB.remove('menu_sizes', s.id));
                const newSizeRows = sizeData.map(s => DB.insert('menu_sizes', { menuItemId: id, name: s.name, price: s.price }));
                DB.logAction('menu_item_update', 'menu_items', id, { name, categoryId, sizes: sizeData });

                const applyAll = document.getElementById('itemApplyAllStores');
                if (applyAll && applyAll.checked) {
                    const updatedItem = DB.getById('menu_items', id);
                    DB.syncEditToStores('menu_items', updatedItem);
                    DB.replaceMenuSizesInStores(id, newSizeRows);
                }
                App.toast(applyAll && applyAll.checked ? 'Menu item updated everywhere' : 'Menu item updated (this store only)');
            } else {
                const newItem = DB.insert('menu_items', { ...imageData, enabled: true });
                // Auto-copy new items to every other store so staff don't
                // have to re-encode the same item per store — each store's
                // copy is independently editable/deletable afterward. Copy
                // the category too, in case it's also brand new.
                const cat = DB.getById('categories', categoryId);
                if (cat) DB.propagateToStores('categories', cat);
                DB.propagateToStores('menu_items', newItem);
                sizeData.forEach(s => {
                    const newSize = DB.insert('menu_sizes', { menuItemId: newItem.id, name: s.name, price: s.price });
                    DB.propagateToStores('menu_sizes', newSize);
                });
                DB.logAction('menu_item_add', 'menu_items', newItem.id, { name, categoryId, sizes: sizeData });
                App.toast('Menu item created');
            }

            App.closeModal();
            render();
        });

        document.getElementById('itemName').focus();
    }

    function sizeRow(name, price, index) {
        return `
            <div class="form-row size-row" style="margin-bottom:10px;align-items:end;">
                <div class="form-group" style="margin-bottom:0;">
                    ${index === 0 ? '<label>Size Name</label>' : ''}
                    <input type="text" class="form-control size-name-input" value="${App.escapeHtml(name || '')}" placeholder="e.g. Small, Medium, Large">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    ${index === 0 ? '<label>Price</label>' : ''}
                    <div style="display:flex;gap:6px;">
                        <input type="number" class="form-control size-price-input" value="${price}" placeholder="0.00" step="0.01" min="0" style="flex:1;">
                        <button class="btn btn-ghost btn-sm remove-size-btn" style="color:var(--danger);flex-shrink:0;">✕</button>
                    </div>
                </div>
            </div>
        `;
    }

    function bindSizeRemove() {
        document.querySelectorAll('.remove-size-btn').forEach(btn => {
            btn.onclick = function () {
                const rows = document.querySelectorAll('.size-row');
                if (rows.length > 1) {
                    this.closest('.size-row').remove();
                } else {
                    App.toast('Need at least one size', 'warning');
                }
            };
        });
    }

    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            App.toast('Image must be under 2MB', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = function (ev) {
            const upload = document.getElementById('imageUpload');
            upload.innerHTML = `<img src="${App.safeImageUrl(ev.target.result)}"><input type="file" accept="image/*" id="itemImage">`;
            document.getElementById('itemImage').addEventListener('change', handleImageUpload);
        };
        reader.readAsDataURL(file);
    }

    async function toggleItem(id) {
        const item = DB.getById('menu_items', id);
        if (item) {
            DB.update('menu_items', id, { enabled: !item.enabled });
            App.toast(`Item ${item.enabled ? 'disabled' : 'enabled'}`);
            render();
        }
    }

    async function deleteItem(id) {
        const item = DB.getById('menu_items', id);
        const yes = await App.confirm('Delete Menu Item?', 'This will permanently remove this item and its sizes.');
        if (yes) {
            DB.remove('menu_items', id);
            // Remove associated sizes
            DB.query('menu_sizes', s => s.menuItemId === id).forEach(s => DB.remove('menu_sizes', s.id));
            DB.logAction('menu_item_delete', 'menu_items', id, { name: item ? item.name : null });
            App.toast('Menu item deleted');
            render();
        }
    }

    return { render };
})();
