/**
 * Bundles – Combo Meals / Bundle Management
 * Allows creating combo deals with multiple items at a special price
 */
const Bundles = (() => {
    let searchTerm = '';
    let filterCategory = '';

    function render() {
        const el = document.getElementById('page-bundles');
        const bundles = DB.getAll('bundles');
        const categories = DB.getAll('categories');
        const menuItems = DB.getAll('menu_items');

        let filtered = bundles;
        if (searchTerm) {
            filtered = filtered.filter(b => b.name.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        if (filterCategory) {
            // Filter by items in bundle
            filtered = filtered.filter(b => {
                const bundleItems = DB.query('bundle_items', bi => bi.bundleId === b.id);
                return bundleItems.some(bi => {
                    const item = menuItems.find(m => m.id === bi.menuItemId);
                    return item && item.categoryId === filterCategory;
                });
            });
        }

        document.getElementById('headerActions').innerHTML = `
            <button class="btn btn-primary" id="btnAddBundle">+ Add Bundle</button>
        `;
        document.getElementById('btnAddBundle').addEventListener('click', () => openForm());

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Bundles / Combo Meals (${filtered.length})</h3>
                    <div style="display:flex;gap:10px;">
                        <select class="form-control" id="bundleCatFilter" style="width:180px;">
                            <option value="">All Categories</option>
                            ${categories.map(c => `<option value="${c.id}" ${filterCategory === c.id ? 'selected' : ''}>${App.escapeHtml(c.name)}</option>`).join('')}
                        </select>
                        <input type="text" class="form-control" placeholder="Search bundles..."
                               value="${App.escapeHtml(searchTerm)}" id="bundleSearch" style="width:200px;">
                    </div>
                </div>
                <div class="card-body" style="padding:0;">
                    ${filtered.length === 0
                        ? '<div class="empty-state"><span class="icon">🍽</span><h3>No bundles found</h3><p>Create your first combo meal bundle.</p></div>'
                        : renderTable(filtered, menuItems)
                    }
                </div>
            </div>
        `;

        document.getElementById('bundleSearch').addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
        });
        document.getElementById('bundleCatFilter').addEventListener('change', (e) => {
            filterCategory = e.target.value;
            render();
        });

        el.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', () => openForm(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="toggle"]').forEach(btn => {
            btn.addEventListener('click', () => toggleBundle(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteBundle(btn.dataset.id));
        });
    }

    function renderTable(bundles, menuItems) {
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Image</th>
                            <th>Name</th>
                            <th>Items</th>
                            <th>Bundle Price</th>
                            <th>Individual Total</th>
                            <th>Savings</th>
                            <th>Status</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${bundles.map(bundle => {
                            const bundleItems = DB.query('bundle_items', bi => bi.bundleId === bundle.id);
                            const itemNames = bundleItems.map(bi => {
                                const item = menuItems.find(m => m.id === bi.menuItemId);
                                return item ? App.escapeHtml(item.name) : 'Unknown';
                            }).join(', ');
                            const itemCount = bundleItems.length;
                            const individualTotal = bundleItems.reduce((sum, bi) => {
                                const item = menuItems.find(m => m.id === bi.menuItemId);
                                if (!item) return sum;
                                const sizes = DB.query('menu_sizes', s => s.menuItemId === item.id);
                                const minPrice = sizes.length ? Math.min(...sizes.map(s => parseFloat(s.price) || 0)) : 0;
                                return sum + (minPrice * bi.quantity);
                            }, 0);
                            const bundlePrice = parseFloat(bundle.price) || 0;
                            const savings = individualTotal - bundlePrice;
                            const savingsPct = individualTotal > 0 ? ((savings / individualTotal) * 100).toFixed(0) : 0;

                            return `
                                <tr>
                                    <td>
                                        <div style="width:48px;height:48px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden;">
                                            ${App.safeImageUrl(bundle.image)
                                                ? `<img src="${App.safeImageUrl(bundle.image)}" style="width:100%;height:100%;object-fit:cover;">`
                                                : '<span style="font-size:1.5rem;">🍽</span>'
                                            }
                                        </div>
                                    </td>
                                    <td>
                                        <strong>${App.escapeHtml(bundle.name)}</strong>
                                        <br><small class="text-muted">${App.escapeHtml(bundle.description || '')}</small>
                                    </td>
                                    <td>
                                        <span class="badge badge-purple">${itemCount} item(s)</span>
                                        <div class="text-muted" style="font-size:0.75rem;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${itemNames}</div>
                                    </td>
                                    <td><strong style="color:var(--primary);">${App.formatCurrency(bundlePrice)}</strong></td>
                                    <td class="text-muted">${App.formatCurrency(individualTotal)}</td>
                                    <td>
                                        <span class="badge ${savings > 0 ? 'badge-success' : 'badge-warning'}">
                                            ${App.formatCurrency(savings)} (${savingsPct}%)
                                        </span>
                                    </td>
                                    <td><span class="badge ${bundle.enabled ? 'badge-success' : 'badge-danger'}">${bundle.enabled ? 'Active' : 'Inactive'}</span></td>
                                    <td class="text-right">
                                        <div class="btn-group" style="justify-content:flex-end;">
                                            <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${bundle.id}">
                                                ${bundle.enabled ? '🔴' : '🟢'}
                                            </button>
                                            <button class="btn btn-outline btn-sm" data-action="edit" data-id="${bundle.id}">Edit</button>
                                            <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${bundle.id}" style="color:var(--danger);">🗑</button>
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
        const bundle = id ? DB.getById('bundles', id) : null;
        const menuItems = DB.getAll('menu_items').filter(i => i.enabled);
        const categories = DB.getAll('categories').filter(c => c.enabled);
        const title = bundle ? 'Edit Bundle' : 'Add Bundle';

        App.openModal(`
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Bundle Name <span class="required">*</span></label>
                    <input type="text" class="form-control" id="bundleName" value="${bundle ? App.escapeHtml(bundle.name) : ''}" placeholder="e.g. Zinger Meal Combo">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" class="form-control" id="bundleDesc" value="${bundle ? App.escapeHtml(bundle.description || '') : ''}" placeholder="e.g. Zinger Burger + Fries + Drink">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Bundle Price <span class="required">*</span></label>
                        <input type="number" class="form-control" id="bundlePrice" value="${bundle ? bundle.price : ''}" placeholder="0.00" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label>Image</label>
                        <div class="image-upload" id="bundleImageUpload">
                            <span class="icon">📷</span>
                            <span>Upload</span>
                            <input type="file" accept="image/*" id="bundleImage">
                        </div>
                    </div>
                </div>

                <h4 style="margin:20px 0 12px;font-size:0.95rem;">Bundle Items</h4>
                <div id="bundleItemsContainer">
                    ${bundle ? renderBundleItems(bundle.id, menuItems) : '<p class="text-muted">Add items to this bundle</p>'}
                </div>
                <button class="btn btn-outline btn-sm" id="addBundleItemBtn" style="margin-bottom:20px;">+ Add Item to Bundle</button>

                <div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:8px;">
                    <strong>Price Preview:</strong>
                    <div style="margin-top:8px;display:flex;gap:16px;flex-wrap:wrap;">
                        <span class="badge badge-info" id="previewIndividualTotal">Individual Total: $0.00</span>
                        <span class="badge badge-success" id="previewBundlePrice">Bundle Price: $0.00</span>
                        <span class="badge ${document.getElementById('bundlePrice')?.value && parseFloat(document.getElementById('bundlePrice').value) < parseFloat(document.getElementById('previewIndividualTotal')?.textContent.replace(/[^0-9.]/g, '')) ? 'badge-success' : 'badge-warning'}" id="previewSavings">Savings: $0.00</span>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnSaveBundle">Save Bundle</button>
            </div>
        `);

        // Image preview
        const imgInput = document.getElementById('bundleImage');
        const imgUpload = document.getElementById('bundleImageUpload');
        if (bundle && bundle.image) {
            imgUpload.innerHTML = `<img src="${App.safeImageUrl(bundle.image)}"><input type="file" accept="image/*" id="bundleImage">`;
            document.getElementById('bundleImage').addEventListener('change', handleBundleImageUpload);
        }
        imgInput.addEventListener('change', handleBundleImageUpload);

        // Add bundle item
        document.getElementById('addBundleItemBtn').addEventListener('click', () => {
            const container = document.getElementById('bundleItemsContainer');
            container.insertAdjacentHTML('beforeend', bundleItemRow('', '', 1, menuItems));
            bindBundleItemRemove();
            updatePricePreview();
        });

        // Price change listeners
        document.getElementById('bundlePrice').addEventListener('input', updatePricePreview);
        document.getElementById('bundleItemsContainer').addEventListener('change', updatePricePreview);

        bindBundleItemRemove();

        // Save
        document.getElementById('btnSaveBundle').addEventListener('click', () => {
            const name = document.getElementById('bundleName').value.trim();
            const description = document.getElementById('bundleDesc').value.trim();
            const price = parseFloat(document.getElementById('bundlePrice').value) || 0;

            if (!name) { App.toast('Bundle name is required', 'error'); return; }
            if (price <= 0) { App.toast('Bundle price is required', 'error'); return; }

            // Collect bundle items
            const itemEls = document.querySelectorAll('.bundle-item-row');
            const itemData = [];
            itemEls.forEach(row => {
                const menuItemId = row.querySelector('.bundle-item-select').value;
                const quantity = parseInt(row.querySelector('.bundle-item-qty').value) || 1;
                if (menuItemId) itemData.push({ menuItemId, quantity });
            });
            if (itemData.length === 0) {
                App.toast('Add at least one item to the bundle', 'error');
                return;
            }

            // Image
            const imgEl = document.getElementById('bundleImageUpload');
            const imgTag = imgEl.querySelector('img');
            const image = imgTag ? imgTag.src : '';

            const bundleData = { name, description, price, image, enabled: true };

            if (bundle) {
                DB.update('bundles', id, bundleData);
                // Replace bundle items
                const oldItems = DB.query('bundle_items', bi => bi.bundleId === id);
                oldItems.forEach(i => DB.remove('bundle_items', i.id));
                itemData.forEach(i => DB.insert('bundle_items', { bundleId: id, menuItemId: i.menuItemId, quantity: i.quantity }));
                DB.logAction('bundle_update', 'bundles', id, { name, items: itemData });
                App.toast('Bundle updated');
            } else {
                const newBundle = DB.insert('bundles', bundleData);
                itemData.forEach(i => DB.insert('bundle_items', { bundleId: newBundle.id, menuItemId: i.menuItemId, quantity: i.quantity }));
                DB.logAction('bundle_add', 'bundles', newBundle.id, { name, items: itemData });
                App.toast('Bundle created');
            }

            App.closeModal();
            render();
        });

        document.getElementById('bundleName').focus();
        updatePricePreview();
    }

    function renderBundleItems(bundleId, menuItems) {
        const bundleItems = DB.query('bundle_items', bi => bi.bundleId === bundleId);
        if (bundleItems.length === 0) {
            return '<p class="text-muted">Add items to this bundle</p>';
        }
        return bundleItems.map(bi => bundleItemRow(bi.menuItemId, '', bi.quantity, menuItems)).join('');
    }

    function bundleItemRow(menuItemId, price, quantity, menuItems) {
        return `
            <div class="form-row bundle-item-row" style="margin-bottom:10px;align-items:end;">
                <div class="form-group" style="margin-bottom:0;flex:2;">
                    <label>Menu Item</label>
                    <select class="form-control bundle-item-select">
                        <option value="">Select item</option>
                        ${menuItems.map(item => `
                            <option value="${item.id}" ${menuItemId === item.id ? 'selected' : ''}>${App.escapeHtml(item.name)}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="form-group" style="margin-bottom:0;flex:1;">
                    <label>Qty</label>
                    <input type="number" class="form-control bundle-item-qty" value="${quantity}" min="1" max="99" style="width:80px;">
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label>&nbsp;</label>
                    <button class="btn btn-ghost btn-sm remove-bundle-item-btn" style="color:var(--danger);">✕</button>
                </div>
            </div>
        `;
    }

    function bindBundleItemRemove() {
        document.querySelectorAll('.remove-bundle-item-btn').forEach(btn => {
            btn.onclick = function () {
                const rows = document.querySelectorAll('.bundle-item-row');
                if (rows.length > 1) {
                    this.closest('.bundle-item-row').remove();
                    updatePricePreview();
                } else {
                    App.toast('Need at least one item', 'warning');
                }
            };
        });
    }

    function updatePricePreview() {
        const bundlePrice = parseFloat(document.getElementById('bundlePrice').value) || 0;
        const menuItems = DB.getAll('menu_items');
        let individualTotal = 0;

        document.querySelectorAll('.bundle-item-row').forEach(row => {
            const menuItemId = row.querySelector('.bundle-item-select').value;
            const quantity = parseInt(row.querySelector('.bundle-item-qty').value) || 1;
            if (menuItemId) {
                const item = menuItems.find(m => m.id === menuItemId);
                if (item) {
                    const sizes = DB.query('menu_sizes', s => s.menuItemId === item.id);
                    const minPrice = sizes.length ? Math.min(...sizes.map(s => parseFloat(s.price) || 0)) : 0;
                    individualTotal += minPrice * quantity;
                }
            }
        });

        const previewIndividual = document.getElementById('previewIndividualTotal');
        const previewBundle = document.getElementById('previewBundlePrice');
        const previewSavings = document.getElementById('previewSavings');

        if (previewIndividual) previewIndividual.textContent = `Individual Total: ${App.formatCurrency(individualTotal)}`;
        if (previewBundle) previewBundle.textContent = `Bundle Price: ${App.formatCurrency(bundlePrice)}`;

        const savings = individualTotal - bundlePrice;
        const savingsPct = individualTotal > 0 ? ((savings / individualTotal) * 100).toFixed(0) : 0;
        if (previewSavings) {
            previewSavings.textContent = `Savings: ${App.formatCurrency(savings)} (${savingsPct}%)`;
            previewSavings.className = `badge ${savings >= 0 ? 'badge-success' : 'badge-warning'}`;
        }
    }

    function handleBundleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            App.toast('Image must be under 2MB', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = function (ev) {
            const upload = document.getElementById('bundleImageUpload');
            upload.innerHTML = `<img src="${App.safeImageUrl(ev.target.result)}"><input type="file" accept="image/*" id="bundleImage">`;
            document.getElementById('bundleImage').addEventListener('change', handleBundleImageUpload);
        };
        reader.readAsDataURL(file);
    }

    async function toggleBundle(id) {
        const bundle = DB.getById('bundles', id);
        if (bundle) {
            DB.update('bundles', id, { enabled: !bundle.enabled });
            App.toast(`Bundle ${bundle.enabled ? 'disabled' : 'enabled'}`);
            render();
        }
    }

    async function deleteBundle(id) {
        const bundle = DB.getById('bundles', id);
        const yes = await App.confirm('Delete Bundle?', 'This will permanently remove this bundle and its items.');
        if (yes) {
            DB.remove('bundles', id);
            DB.query('bundle_items', bi => bi.bundleId === id).forEach(i => DB.remove('bundle_items', i.id));
            DB.logAction('bundle_delete', 'bundles', id, { name: bundle ? bundle.name : null });
            App.toast('Bundle deleted');
            render();
        }
    }

    return { render };
})();