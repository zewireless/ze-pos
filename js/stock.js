/**
 * Stock & Inventory – Stock management with low-stock alerts and movement history
 */
const Stock = (() => {
    let activeTab = 'items';
    let searchTerm = '';
    let filterCategory = '';
    let filterStockStatus = '';
    let movementFilterType = '';
    let movementDateFrom = '';
    let movementDateTo = '';

    const MOVEMENT_TYPES = ['sale', 'adjustment', 'restock', 'waste', 'return'];

    function render() {
        const el = document.getElementById('page-stock');
        const isAdmin = Auth.isAdmin();

        if (!isAdmin) {
            el.innerHTML = '<div class="card"><div class="card-body empty-state"><span class="icon">🔒</span><h3>Admin Only</h3><p>Stock management is restricted to administrators.</p></div></div>';
            return;
        }

        const items = getStockItems();
        const categories = DB.getAll('categories');
        const movements = getFilteredMovements();

        const lowStockCount = items.filter(i => i.track_stock && i.stock_quantity <= i.low_stock_threshold && i.stock_quantity > 0).length;
        const outOfStockCount = items.filter(i => i.track_stock && i.stock_quantity <= 0).length;

        // Header actions
        document.getElementById('headerActions').innerHTML = `
            <button class="btn btn-primary" id="btnRestockAllLow" ${lowStockCount === 0 ? 'disabled' : ''}>
                📦 Restock All Low (${lowStockCount})
            </button>
            <button class="btn btn-primary" id="btnExportStock">📥 Export CSV</button>
        `;

        document.getElementById('btnRestockAllLow').addEventListener('click', () => openBulkRestockModal());
        document.getElementById('btnExportStock').addEventListener('click', () => exportStockCSV());

        el.innerHTML = `
            ${renderLowStockBanner(lowStockCount, outOfStockCount)}

            <div class="card">
                <div class="card-header">
                    <div class="tabs" role="tablist">
                        <button class="tab-btn ${activeTab === 'items' ? 'active' : ''}" data-tab="items" role="tab" aria-selected="${activeTab === 'items'}">📋 Items (${items.length})</button>
                        <button class="tab-btn ${activeTab === 'movements' ? 'active' : ''}" data-tab="movements" role="tab" aria-selected="${activeTab === 'movements'}">📜 Movements (${movements.length})</button>
                    </div>
                </div>
                <div class="card-body">
                    ${activeTab === 'items' ? renderItemsTab(items, categories) : renderMovementsTab(movements)}
                </div>
            </div>
        `;

        // Tab switching
        el.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                render();
            });
        });

        // Items tab events
        if (activeTab === 'items') {
            bindItemsEvents(items, categories);
        } else {
            bindMovementsEvents();
        }
    }

    function renderLowStockBanner(lowCount, outCount) {
        if (lowCount === 0 && outCount === 0) return '';

        const totalAlert = lowCount + outCount;
        return `
            <div class="card" style="margin-bottom:20px;border-left:4px solid ${outCount > 0 ? 'var(--danger)' : 'var(--warning)'};">
                <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
                    <div>
                        <strong>⚠️ Stock Alert: ${totalAlert} item(s) need attention</strong>
                        ${outCount > 0 ? `<span class="badge badge-danger" style="margin-left:8px;">${outCount} Out of Stock</span>` : ''}
                        ${lowCount > 0 ? `<span class="badge badge-warning" style="margin-left:8px;">${lowCount} Low Stock</span>` : ''}
                    </div>
                    <button class="btn btn-outline btn-sm" id="btnViewLowStock">View All</button>
                </div>
            </div>
        `;
    }

    function getStockItems() {
        const menuItems = DB.getAll('menu_items');
        const categories = DB.getAll('categories');
        const catMap = {};
        categories.forEach(c => catMap[c.id] = c.name);

        return menuItems.map(item => {
            const sizes = DB.query('menu_sizes', s => s.menuItemId === item.id);
            const hasSizeStock = sizes.some(s => s.track_stock);

            return {
                ...item,
                categoryName: catMap[item.categoryId] || '—',
                sizes,
                hasSizeStock,
                // Determine overall status
                get status() {
                    if (!this.track_stock) return 'untracked';
                    if (this.stock_quantity <= 0) return 'out';
                    if (this.stock_quantity <= this.low_stock_threshold) return 'low';
                    return 'ok';
                }
            };
        }).filter(item => {
            if (searchTerm && !item.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            if (filterCategory && item.categoryId !== filterCategory) return false;
            if (filterStockStatus) {
                if (filterStockStatus === 'untracked' && item.track_stock) return false;
                if (filterStockStatus === 'tracked' && !item.track_stock) return false;
                if (filterStockStatus === 'low' && item.status !== 'low') return false;
                if (filterStockStatus === 'out' && item.status !== 'out') return false;
                if (filterStockStatus === 'ok' && item.status !== 'ok') return false;
            }
            return true;
        });
    }

    function getFilteredMovements() {
        let movements = DB.getAll('stock_movements');
        const menuItems = DB.getAll('menu_items');
        const menuSizes = DB.getAll('menu_sizes');
        const itemMap = {};
        menuItems.forEach(i => itemMap[i.id] = i.name);
        const sizeMap = {};
        menuSizes.forEach(s => sizeMap[s.id] = s.name);

        movements = movements.map(m => ({
            ...m,
            itemName: itemMap[m.menuItemId] || 'Unknown Item',
            sizeName: m.menuSizeId ? (sizeMap[m.menuSizeId] || 'Unknown Size') : null,
            createdAt: m.createdAt || m.created_at
        })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        if (movementFilterType) {
            movements = movements.filter(m => m.movementType === movementFilterType);
        }
        if (movementDateFrom) {
            movements = movements.filter(m => m.createdAt && m.createdAt.split('T')[0] >= movementDateFrom);
        }
        if (movementDateTo) {
            movements = movements.filter(m => m.createdAt && m.createdAt.split('T')[0] <= movementDateTo);
        }

        return movements;
    }

    function renderItemsTab(items, categories) {
        if (items.length === 0) {
            return `
                <div class="empty-state">
                    <span class="icon">📦</span>
                    <h3>No items found</h3>
                    <p>${searchTerm || filterCategory || filterStockStatus ? 'Try adjusting your filters.' : 'Add menu items from the Menu page to start tracking stock.'}</p>
                </div>
            `;
        }

        return `
            <div style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                <input type="text" class="form-control" id="stockSearch" placeholder="Search items..." value="${App.escapeHtml(searchTerm)}" style="width:220px;">
                <select class="form-control" id="stockCatFilter" style="width:180px;">
                    <option value="">All Categories</option>
                    ${categories.map(c => `<option value="${c.id}" ${filterCategory === c.id ? 'selected' : ''}>${App.escapeHtml(c.name)}</option>`).join('')}
                </select>
                <select class="form-control" id="stockStatusFilter" style="width:160px;">
                    <option value="">All Status</option>
                    <option value="tracked" ${filterStockStatus === 'tracked' ? 'selected' : ''}>Tracked</option>
                    <option value="untracked" ${filterStockStatus === 'untracked' ? 'selected' : ''}>Not Tracked</option>
                    <option value="out" ${filterStockStatus === 'out' ? 'selected' : ''}>🔴 Out of Stock</option>
                    <option value="low" ${filterStockStatus === 'low' ? 'selected' : ''}>🟠 Low Stock</option>
                    <option value="ok" ${filterStockStatus === 'ok' ? 'selected' : ''}>🟢 OK</option>
                </select>
            </div>

            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Category</th>
                            <th style="width:100px;">Track Stock</th>
                            <th style="width:120px;">Quantity</th>
                            <th style="width:120px;">Low Threshold</th>
                            <th style="width:80px;">Unit</th>
                            <th style="width:130px;">Status</th>
                            <th style="width:140px;text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(item => renderItemRow(item)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderItemRow(item) {
        const status = item.status;
        let statusBadge = '';
        let rowClass = '';

        if (!item.track_stock) {
            statusBadge = '<span class="badge badge-gray">Not Tracked</span>';
        } else if (status === 'out') {
            statusBadge = '<span class="badge badge-danger">🔴 Out of Stock</span>';
            rowClass = 'style="background:#fff0f0;"';
        } else if (status === 'low') {
            statusBadge = '<span class="badge badge-warning">🟠 Low Stock</span>';
            rowClass = 'style="background:#fffbf0;"';
        } else {
            statusBadge = '<span class="badge badge-success">🟢 OK</span>';
        }

        const trackStockHtml = item.track_stock
            ? `<label class="toggle"><input type="checkbox" checked data-action="toggle-track" data-id="${item.id}"><span class="slider"></span></label>`
            : `<label class="toggle"><input type="checkbox" data-action="toggle-track" data-id="${item.id}"><span class="slider"></span></label>`;

        const quantity = item.track_stock ? parseFloat(item.stock_quantity || 0).toFixed(3) : '—';
        const threshold = item.track_stock ? parseFloat(item.low_stock_threshold || 10).toFixed(3) : '—';
        const unit = item.track_stock ? App.escapeHtml(item.unit || 'pcs') : '—';

        return `
            <tr ${rowClass}>
                <td><strong>${App.escapeHtml(item.name)}</strong><br><small class="text-muted">${App.escapeHtml(item.description || '')}</small></td>
                <td><span class="badge badge-purple">${App.escapeHtml(item.categoryName)}</span></td>
                <td style="text-align:center;">${trackStockHtml}</td>
                <td><strong>${quantity}</strong></td>
                <td>${threshold}</td>
                <td>${unit}</td>
                <td>${statusBadge}</td>
                <td class="text-right">
                    <div class="btn-group" style="justify-content:flex-end;">
                        ${item.track_stock ? `
                            <button class="btn btn-outline btn-sm" data-action="adjust" data-id="${item.id}">Adjust</button>
                        ` : ''}
                        ${item.hasSizeStock ? `
                            <button class="btn btn-ghost btn-sm" data-action="view-sizes" data-id="${item.id}" title="Size-level stock">📏</button>
                        ` : ''}
                        <button class="btn btn-ghost btn-sm" data-action="delete-item" data-id="${item.id}" title="Delete item entirely (removes from menu/POS too)" style="color:var(--danger);">🗑</button>
                    </div>
                </td>
            </tr>
        `;
    }

    function renderMovementsTab(movements) {
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

        if (!movementDateFrom) movementDateFrom = weekAgo;
        if (!movementDateTo) movementDateTo = today;

        if (movements.length === 0) {
            return `
                <div style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                    <select class="form-control" id="movementTypeFilter" style="width:160px;">
                        <option value="">All Types</option>
                        ${MOVEMENT_TYPES.map(t => `<option value="${t}" ${movementFilterType === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
                    </select>
                    <input type="date" class="form-control" id="movementDateFrom" value="${movementDateFrom}" style="width:150px;">
                    <span class="text-muted">to</span>
                    <input type="date" class="form-control" id="movementDateTo" value="${movementDateTo}" style="width:150px;">
                    <button class="btn btn-primary btn-sm" id="movementApplyFilters">Apply</button>
                </div>
                <div class="empty-state">
                    <span class="icon">📜</span>
                    <h3>No stock movements found</h3>
                    <p>Stock movements will appear here when stock is adjusted, restocked, or sold.</p>
                </div>
            `;
        }

        return `
            <div style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                <select class="form-control" id="movementTypeFilter" style="width:160px;">
                    <option value="">All Types</option>
                    ${MOVEMENT_TYPES.map(t => `<option value="${t}" ${movementFilterType === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
                </select>
                <input type="date" class="form-control" id="movementDateFrom" value="${movementDateFrom}" style="width:150px;">
                <span class="text-muted">to</span>
                <input type="date" class="form-control" id="movementDateTo" value="${movementDateTo}" style="width:150px;">
                <button class="btn btn-primary btn-sm" id="movementApplyFilters">Apply</button>
                <button class="btn btn-outline btn-sm" id="btnExportMovements">📥 Export CSV</button>
            </div>

            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Item</th>
                            <th>Size</th>
                            <th style="text-align:right;">Qty Change</th>
                            <th style="text-align:right;">Previous</th>
                            <th style="text-align:right;">New</th>
                            <th>Reference</th>
                            <th>User</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${movements.map(m => renderMovementRow(m)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderMovementRow(m) {
        const typeBadges = {
            sale: 'badge-primary',
            adjustment: 'badge-warning',
            restock: 'badge-success',
            waste: 'badge-danger',
            return: 'badge-info'
        };
        const badgeClass = typeBadges[m.movementType] || 'badge-gray';
        const qtyChange = parseFloat(m.quantityChange || 0);
        const qtyClass = qtyChange > 0 ? 'style="color:var(--success);"' : (qtyChange < 0 ? 'style="color:var(--danger);"' : '');

        return `
            <tr>
                <td class="text-muted">${App.formatDateTime(m.createdAt)}</td>
                <td><span class="badge ${badgeClass}">${m.movementType}</span></td>
                <td>${App.escapeHtml(m.itemName)}</td>
                <td>${m.sizeName ? App.escapeHtml(m.sizeName) : '<span class="text-muted">—</span>'}</td>
                <td class="text-right" ${qtyClass}>${qtyChange > 0 ? '+' : ''}${qtyChange.toFixed(3)}</td>
                <td class="text-right">${parseFloat(m.previousQuantity || 0).toFixed(3)}</td>
                <td class="text-right"><strong>${parseFloat(m.newQuantity || 0).toFixed(3)}</strong></td>
                <td class="text-muted">
                    ${m.referenceType ? `<span class="badge badge-gray">${m.referenceType}</span> ` : ''}
                    ${m.referenceId ? `#${m.referenceId.slice(0, 8)}` : '—'}
                </td>
                <td>${App.escapeHtml(m.userName || '—')}</td>
                <td class="text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${App.escapeHtml(m.notes || '')}">${App.escapeHtml(m.notes || '—')}</td>
            </tr>
        `;
    }

    function bindItemsEvents(items, categories) {
        // Search
        document.getElementById('stockSearch').addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
        });

        document.getElementById('stockCatFilter').addEventListener('change', (e) => {
            filterCategory = e.target.value;
            render();
        });

        document.getElementById('stockStatusFilter').addEventListener('change', (e) => {
            filterStockStatus = e.target.value;
            render();
        });

        // Toggle track stock
        document.querySelectorAll('[data-action="toggle-track"]').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const id = e.target.dataset.id;
                const item = DB.getById('menu_items', id);
                if (!item) return;

                const newTrackStock = e.target.checked;
                if (newTrackStock && !item.track_stock) {
                    // Enabling stock tracking - set defaults
                    DB.update('menu_items', id, {
                        track_stock: true,
                        stock_quantity: item.stock_quantity || 0,
                        low_stock_threshold: item.low_stock_threshold || 10,
                        unit: item.unit || 'pcs',
                        cost_price: item.cost_price || 0
                    });
                    App.toast(`Stock tracking enabled for ${item.name}`);
                } else if (!newTrackStock && item.track_stock) {
                    DB.update('menu_items', id, { track_stock: false });
                    App.toast(`Stock tracking disabled for ${item.name}`);
                }
                render();
            });
        });

        // Adjust stock
        document.querySelectorAll('[data-action="adjust"]').forEach(btn => {
            btn.addEventListener('click', () => openAdjustModal(btn.dataset.id));
        });

        // View size-level stock
        document.querySelectorAll('[data-action="view-sizes"]').forEach(btn => {
            btn.addEventListener('click', () => openSizeStockModal(btn.dataset.id));
        });

        // Delete item entirely (menu item + its sizes + its stock movement history)
        document.querySelectorAll('[data-action="delete-item"]').forEach(btn => {
            btn.addEventListener('click', () => deleteStockItem(btn.dataset.id));
        });
    }

    async function deleteStockItem(id) {
        const item = DB.getById('menu_items', id);
        if (!item) return;
        const yes = await App.confirm(
            'Delete Item?',
            `This permanently removes "${item.name}" from your menu and POS, along with all of its stock movement history. This can't be undone.`
        );
        if (!yes) return;

        // Reuse the canonical delete (removes the menu item + its sizes,
        // and logs the action) so this never drifts out of sync with the
        // Menu Items page's own delete behavior.
        await Menu.deleteItem(id, { skipConfirm: true });

        // Also clear out its movement history — deleting an item here is
        // meant to let a client start completely fresh on that item, not
        // leave orphaned movement rows still referencing it.
        DB.query('stock_movements', m => m.menuItemId === id).forEach(m => DB.remove('stock_movements', m.id));

        App.toast(`${item.name} deleted`);
        render();
    }

    function bindMovementsEvents() {
        document.getElementById('movementTypeFilter').addEventListener('change', (e) => {
            movementFilterType = e.target.value;
        });
        document.getElementById('movementDateFrom').addEventListener('change', (e) => {
            movementDateFrom = e.target.value;
        });
        document.getElementById('movementDateTo').addEventListener('change', (e) => {
            movementDateTo = e.target.value;
        });
        document.getElementById('movementApplyFilters').addEventListener('click', () => {
            movementFilterType = document.getElementById('movementTypeFilter').value;
            movementDateFrom = document.getElementById('movementDateFrom').value;
            movementDateTo = document.getElementById('movementDateTo').value;
            render();
        });
        document.getElementById('btnExportMovements').addEventListener('click', () => exportMovementsCSV());
    }

    function openAdjustModal(itemId) {
        const item = DB.getById('menu_items', itemId);
        if (!item) return;

        const sizes = DB.query('menu_sizes', s => s.menuItemId === itemId).filter(s => s.track_stock);

        App.openModal(`
            <div class="modal-header">
                <h3>Adjust Stock — ${App.escapeHtml(item.name)}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Current Stock</label>
                    <input type="text" class="form-control" value="${parseFloat(item.stock_quantity || 0).toFixed(3)} ${App.escapeHtml(item.unit || 'pcs')}" readonly style="background:#f1f5f9;">
                </div>
                <div class="form-group">
                    <label>Low Stock Threshold</label>
                    <input type="text" class="form-control" value="${parseFloat(item.low_stock_threshold || 10).toFixed(3)}" readonly style="background:#f1f5f9;">
                </div>
                <hr style="margin:16px 0;border-color:var(--border);">

                ${sizes.length > 0 ? `
                    <div class="form-group">
                        <label>Adjustment Level <span class="required">*</span></label>
                        <select class="form-control" id="adjustLevel">
                            <option value="item">Item Level (main stock)</option>
                            ${sizes.map(s => `<option value="size_${s.id}">${App.escapeHtml(s.name)} (${parseFloat(s.stock_quantity || 0).toFixed(3)} ${App.escapeHtml(item.unit || 'pcs')})</option>`).join('')}
                        </select>
                        <small class="form-hint">Select which stock level to adjust</small>
                    </div>
                ` : ''}

                <div class="form-group">
                    <label>Movement Type <span class="required">*</span></label>
                    <select class="form-control" id="adjustType">
                        ${MOVEMENT_TYPES.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label>Quantity Change <span class="required">*</span></label>
                    <input type="number" class="form-control" id="adjustQty" step="0.001" placeholder="Positive for restock/return, negative for sale/waste/adjustment">
                    <small class="form-hint">Use positive numbers to add stock, negative to reduce</small>
                </div>

                <div class="form-group">
                    <label>Notes</label>
                    <textarea class="form-control" id="adjustNotes" rows="3" placeholder="Reason for adjustment..."></textarea>
                </div>

                <div class="form-group">
                    <label>Reference (optional)</label>
                    <input type="text" class="form-control" id="adjustRef" placeholder="Order #, PO #, etc.">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnSaveAdjustment">Save Adjustment</button>
            </div>
        `);

        document.getElementById('btnSaveAdjustment').addEventListener('click', () => {
            const level = document.getElementById('adjustLevel')?.value || 'item';
            const type = document.getElementById('adjustType').value;
            const qty = parseFloat(document.getElementById('adjustQty').value);
            const notes = document.getElementById('adjustNotes').value.trim();
            const ref = document.getElementById('adjustRef').value.trim();

            if (isNaN(qty) || qty === 0) {
                App.toast('Please enter a valid quantity change', 'error');
                return;
            }

            const user = Auth.currentUser();
            let menuItemId = itemId;
            let menuSizeId = null;
            let currentQty = parseFloat(item.stock_quantity || 0);
            let newQty = currentQty + qty;

            if (level.startsWith('size_')) {
                menuSizeId = level.replace('size_', '');
                const size = DB.getById('menu_sizes', menuSizeId);
                if (!size) { App.toast('Size not found', 'error'); return; }
                currentQty = parseFloat(size.stock_quantity || 0);
                newQty = currentQty + qty;
                if (newQty < 0) { App.toast('Cannot reduce stock below zero', 'error'); return; }

                DB.update('menu_sizes', menuSizeId, { stock_quantity: newQty });
            } else {
                if (newQty < 0) { App.toast('Cannot reduce stock below zero', 'error'); return; }
                DB.update('menu_items', itemId, { stock_quantity: newQty });
            }

            // Record movement
            DB.insert('stock_movements', {
                menuItemId,
                menuSizeId,
                movementType: type,
                quantityChange: qty,
                previousQuantity: currentQty,
                newQuantity: newQty,
                referenceId: ref || null,
                referenceType: type,
                notes: notes || null,
                userId: user.id,
                userName: user.name
            });

            App.toast(`Stock ${type} recorded: ${qty > 0 ? '+' : ''}${qty.toFixed(3)} ${item.unit || 'pcs'}`);
            App.closeModal();
            render();
        });

        document.getElementById('adjustQty').focus();
    }

    function openSizeStockModal(itemId) {
        const item = DB.getById('menu_items', itemId);
        if (!item) return;

        const sizes = DB.query('menu_sizes', s => s.menuItemId === itemId && s.track_stock);
        if (sizes.length === 0) {
            App.toast('No sizes with stock tracking enabled', 'warning');
            return;
        }

        App.openModal(`
            <div class="modal-header">
                <h3>Size-Level Stock — ${App.escapeHtml(item.name)}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="max-height:60vh;overflow:auto;">
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Size</th>
                                <th style="text-align:right;">Quantity</th>
                                <th style="text-align:right;">Threshold</th>
                                <th>Status</th>
                                <th style="text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sizes.map(s => {
                                const status = !s.track_stock ? 'untracked' : (s.stock_quantity <= 0 ? 'out' : (s.stock_quantity <= s.low_stock_threshold ? 'low' : 'ok'));
                                let badge = '';
                                if (!s.track_stock) badge = '<span class="badge badge-gray">Not Tracked</span>';
                                else if (status === 'out') badge = '<span class="badge badge-danger">🔴 Out</span>';
                                else if (status === 'low') badge = '<span class="badge badge-warning">🟠 Low</span>';
                                else badge = '<span class="badge badge-success">🟢 OK</span>';

                                return `
                                    <tr ${status === 'out' ? 'style="background:#fff0f0;"' : status === 'low' ? 'style="background:#fffbf0;"' : ''}>
                                        <td><strong>${App.escapeHtml(s.name)}</strong></td>
                                        <td class="text-right"><strong>${parseFloat(s.stock_quantity || 0).toFixed(3)}</strong> ${App.escapeHtml(item.unit || 'pcs')}</td>
                                        <td class="text-right">${parseFloat(s.low_stock_threshold || 10).toFixed(3)}</td>
                                        <td>${badge}</td>
                                        <td class="text-right">
                                            <button class="btn btn-outline btn-sm" data-action="adjust-size" data-item="${itemId}" data-size="${s.id}">Adjust</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
            </div>
        `);

        document.querySelectorAll('[data-action="adjust-size"]').forEach(btn => {
            btn.addEventListener('click', () => {
                App.closeModal();
                openAdjustModal(btn.dataset.item); // Will pre-select the size
            });
        });
    }

    function openBulkRestockModal() {
        const items = getStockItems().filter(i => i.track_stock && i.stock_quantity <= i.low_stock_threshold && i.stock_quantity > 0);

        if (items.length === 0) {
            App.toast('No low stock items to restock', 'info');
            return;
        }

        App.openModal(`
            <div class="modal-header">
                <h3>📦 Bulk Restock Low Stock Items</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="max-height:60vh;overflow:auto;">
                <p class="text-muted" style="margin-bottom:16px;">Set restock quantities for ${items.length} low-stock item(s). Leave blank or 0 to skip.</p>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th style="text-align:right;">Current</th>
                                <th style="text-align:right;">Threshold</th>
                                <th style="text-align:right;">Restock Qty</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(item => `
                                <tr>
                                    <td><strong>${App.escapeHtml(item.name)}</strong></td>
                                    <td class="text-right">${parseFloat(item.stock_quantity || 0).toFixed(3)} ${App.escapeHtml(item.unit || 'pcs')}</td>
                                    <td class="text-right">${parseFloat(item.low_stock_threshold || 10).toFixed(3)}</td>
                                    <td class="text-right">
                                        <input type="number" class="form-control form-control-sm bulk-restock-input" data-id="${item.id}" step="0.001" min="0" placeholder="0" style="width:100px;">
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnConfirmBulkRestock">Apply Restock</button>
            </div>
        `);

        document.getElementById('btnConfirmBulkRestock').addEventListener('click', () => {
            const user = Auth.currentUser();
            let hasChanges = false;

            document.querySelectorAll('.bulk-restock-input').forEach(input => {
                const qty = parseFloat(input.value);
                if (!isNaN(qty) && qty > 0) {
                    const itemId = input.dataset.id;
                    const item = DB.getById('menu_items', itemId);
                    if (item) {
                        const currentQty = parseFloat(item.stock_quantity || 0);
                        const newQty = currentQty + qty;
                        DB.update('menu_items', itemId, { stock_quantity: newQty });
                        DB.insert('stock_movements', {
                            menuItemId: itemId,
                            menuSizeId: null,
                            movementType: 'restock',
                            quantityChange: qty,
                            previousQuantity: currentQty,
                            newQuantity: newQty,
                            referenceId: null,
                            referenceType: 'restock',
                            notes: 'Bulk restock from low stock alert',
                            userId: user.id,
                            userName: user.name
                        });
                        hasChanges = true;
                    }
                }
            });

            if (hasChanges) {
                App.toast('Bulk restock applied successfully');
            } else {
                App.toast('No quantities entered', 'warning');
            }
            App.closeModal();
            render();
        });
    }

    function exportStockCSV() {
        const items = getStockItems();
        const categories = DB.getAll('categories');
        const catMap = {};
        categories.forEach(c => catMap[c.id] = c.name);

        const headers = ['Item Name', 'Category', 'Track Stock', 'Current Quantity', 'Low Stock Threshold', 'Unit', 'Cost Price', 'Status'];
        const rows = items.map(item => [
            `"${item.name.replace(/"/g, '""')}"`,
            `"${(catMap[item.categoryId] || '').replace(/"/g, '""')}"`,
            item.track_stock ? 'Yes' : 'No',
            parseFloat(item.stock_quantity || 0).toFixed(3),
            parseFloat(item.low_stock_threshold || 10).toFixed(3),
            `"${(item.unit || 'pcs').replace(/"/g, '""')}"`,
            parseFloat(item.cost_price || 0).toFixed(2),
            item.track_stock ? (item.status === 'out' ? 'Out of Stock' : item.status === 'low' ? 'Low Stock' : 'OK') : 'Not Tracked'
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        downloadCSV(csv, `stock-report-${new Date().toISOString().split('T')[0]}.csv`);
        App.toast('Stock report exported');
    }

    function exportMovementsCSV() {
        const movements = getFilteredMovements();

        const headers = ['Date', 'Type', 'Item', 'Size', 'Quantity Change', 'Previous Quantity', 'New Quantity', 'Reference Type', 'Reference ID', 'User', 'Notes'];
        const rows = movements.map(m => [
            `"${App.formatDateTime(m.createdAt).replace(/"/g, '""')}"`,
            `"${m.movementType}"`,
            `"${m.itemName.replace(/"/g, '""')}"`,
            `"${(m.sizeName || '').replace(/"/g, '""')}"`,
            parseFloat(m.quantityChange || 0).toFixed(3),
            parseFloat(m.previousQuantity || 0).toFixed(3),
            parseFloat(m.newQuantity || 0).toFixed(3),
            `"${(m.referenceType || '').replace(/"/g, '""')}"`,
            `"${(m.referenceId || '').replace(/"/g, '""')}"`,
            `"${(m.userName || '').replace(/"/g, '""')}"`,
            `"${(m.notes || '').replace(/"/g, '""')}"`
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        downloadCSV(csv, `stock-movements-${new Date().toISOString().split('T')[0]}.csv`);
        App.toast('Movements exported');
    }

    function downloadCSV(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    return { render };
})();