/**
 * Orders – Order history with details, split bill, and merge orders
 */
const Orders = (() => {
    let filterDateFrom = '';
    let filterDateTo = '';
    let filterType = '';
    let selectedOrders = []; // For merge functionality

    function render() {
        const el = document.getElementById('page-orders');
        const orders = getFilteredOrders();

        // Set default date range to today
        const today = new Date().toISOString().split('T')[0];
        if (!filterDateFrom && !filterDateTo) {
            filterDateFrom = today;
            filterDateTo = today;
        }

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Order History</h3>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        <select class="form-control" id="orderTypeFilter" style="width:150px;">
                            <option value="">All Types</option>
                            <option value="Dine-In" ${filterType === 'Dine-In' ? 'selected' : ''}>Dine-In</option>
                            <option value="Takeaway" ${filterType === 'Takeaway' ? 'selected' : ''}>Takeaway</option>
                            <option value="Delivery" ${filterType === 'Delivery' ? 'selected' : ''}>Delivery</option>
                        </select>
                        <input type="date" class="form-control" id="orderDateFrom" value="${filterDateFrom}" style="width:160px;">
                        <input type="date" class="form-control" id="orderDateTo" value="${filterDateTo}" style="width:160px;">
                        <button class="btn btn-outline btn-sm" id="btnClearOrderFilter">Clear</button>
                        ${selectedOrders.length >= 2 ? `<button class="btn btn-primary btn-sm" id="btnMergeOrders">🔗 Merge (${selectedOrders.length})</button>` : ''}
                        ${selectedOrders.length > 0 ? `<button class="btn btn-outline btn-sm" id="btnClearSelection">Clear Selection</button>` : ''}
                        ${Auth.isAdmin() ? '<button class="btn btn-danger btn-sm" id="btnDeleteAllOrders" title="Delete all order history">🗑 Delete All</button>' : ''}
                    </div>
                </div>
                <div class="card-body" style="padding:0;">
                    ${orders.length === 0
                        ? '<div class="empty-state"><span class="icon">📑</span><h3>No orders found</h3><p>Orders will appear here after completing a sale.</p></div>'
                        : renderTable(orders)
                    }
                </div>
            </div>
        `;

        // Bind filter events
        document.getElementById('orderTypeFilter').addEventListener('change', (e) => {
            filterType = e.target.value;
            render();
        });
        document.getElementById('orderDateFrom').addEventListener('change', (e) => {
            filterDateFrom = e.target.value;
            render();
        });
        document.getElementById('orderDateTo').addEventListener('change', (e) => {
            filterDateTo = e.target.value;
            render();
        });
        document.getElementById('btnClearOrderFilter').addEventListener('click', () => {
            filterDateFrom = '';
            filterDateTo = '';
            filterType = '';
            render();
        });

        // View details
        el.querySelectorAll('[data-action="view"]').forEach(btn => {
            btn.addEventListener('click', () => viewOrder(btn.dataset.id));
        });

        // Print receipt
        el.querySelectorAll('[data-action="print"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const order = DB.getById('orders', btn.dataset.id);
                if (order) Receipt.show(order);
            });
        });

        // Delete single order (admin only)
        el.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteOrder(btn.dataset.id));
        });

        // Delete all order history (admin only)
        const deleteAllBtn = document.getElementById('btnDeleteAllOrders');
        if (deleteAllBtn) {
            deleteAllBtn.addEventListener('click', deleteAllOrders);
        }

        // Merge orders
        const mergeBtn = document.getElementById('btnMergeOrders');
        if (mergeBtn) {
            mergeBtn.addEventListener('click', openMergeModal);
        }

        // Clear selection
        const clearSelBtn = document.getElementById('btnClearSelection');
        if (clearSelBtn) {
            clearSelBtn.addEventListener('click', () => {
                selectedOrders = [];
                render();
            });
        }

        // Select orders for merge
        el.querySelectorAll('[data-action="select"]').forEach(chk => {
            chk.addEventListener('change', () => {
                const orderId = chk.dataset.id;
                if (chk.checked) {
                    if (!selectedOrders.includes(orderId)) {
                        selectedOrders.push(orderId);
                    }
                } else {
                    selectedOrders = selectedOrders.filter(id => id !== orderId);
                }
                render();
            });
        });
    }

    function getFilteredOrders() {
        let orders = DB.getAll('orders');

        if (filterDateFrom) {
            orders = orders.filter(o => o.createdAt && o.createdAt.split('T')[0] >= filterDateFrom);
        }
        if (filterDateTo) {
            orders = orders.filter(o => o.createdAt && o.createdAt.split('T')[0] <= filterDateTo);
        }
        if (filterType) {
            orders = orders.filter(o => o.type === filterType);
        }

        return orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    async function deleteOrder(id) {
        const order = DB.getById('orders', id);
        if (!order) return;
        const yes = await App.confirm(
            'Delete Order?',
            `Delete order #${order.orderNumber} (${App.formatCurrency(order.total)})? This will also remove it from sales reports and cannot be undone.`,
            'Delete'
        );
        if (!yes) return;
        DB.remove('orders', id);
        DB.getAll('order_items')
            .filter(i => i.orderId === id)
            .forEach(i => DB.remove('order_items', i.id));
        DB.logAction('order_delete', 'orders', id, { orderNumber: order.orderNumber, total: order.total });
        App.toast('Order deleted');
        render();
    }

    async function deleteAllOrders() {
        const count = DB.getAll('orders').length;
        if (count === 0) return;
        const yes = await App.confirm(
            'Delete All Orders?',
            `Delete all ${count} order(s) and their items? This will clear order history and sales reports and cannot be undone.`,
            'Delete All'
        );
        if (!yes) return;
        DB.clear('orders');
        DB.clear('order_items');
        DB.logAction('orders_delete_all', 'orders', null, { count });
        App.toast('All orders deleted');
        render();
    }

    function renderTable(orders) {
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width:40px;"><input type="checkbox" id="selectAllOrders" title="Select all"></th>
                            <th>Order #</th>
                            <th>Type</th>
                            <th>Items</th>
                            <th>Subtotal</th>
                            <th>Tax</th>
                            <th>Total</th>
                            <th>Cashier</th>
                            <th>Date</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${orders.map(o => {
                            const items = DB.query('order_items', i => i.orderId === o.id);
                            const isSelected = selectedOrders.includes(o.id);
                            return `
                                <tr class="${isSelected ? 'row-selected' : ''}">
                                    <td><input type="checkbox" data-action="select" data-id="${o.id}" ${isSelected ? 'checked' : ''}></td>
                                    <td><strong>#${o.orderNumber}</strong></td>
                                    <td><span class="badge badge-info">${App.escapeHtml(o.type)}</span></td>
                                    <td>${items.reduce((sum, i) => sum + (i.quantity || 1), 0)} item(s)</td>
                                    <td>${App.formatCurrency(o.subtotal)}</td>
                                    <td>${App.formatCurrency(o.taxAmount)}</td>
                                    <td><strong>${App.formatCurrency(o.total)}</strong></td>
                                    <td class="text-muted">${App.escapeHtml(o.userName || '—')}</td>
                                    <td class="text-muted">${App.formatDateTime(o.createdAt)}</td>
                                    <td class="text-right">
                                        <div class="btn-group" style="justify-content:flex-end;">
                                            <button class="btn btn-outline btn-sm" data-action="view" data-id="${o.id}">View</button>
                                            <button class="btn btn-ghost btn-sm" data-action="print" data-id="${o.id}" title="Print Receipt">🖨</button>
                                            ${Auth.isAdmin() ? `<button class="btn btn-ghost btn-sm" data-action="delete" data-id="${o.id}" title="Delete Order" style="color:var(--danger);">🗑</button>` : ''}
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

    function viewOrder(id) {
        const order = DB.getById('orders', id);
        if (!order) return;
        const items = DB.query('order_items', i => i.orderId === id);

        App.openModal(`
            <div class="modal-header">
                <h3>Order #${order.orderNumber}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                    <div><strong>Type:</strong> <span class="badge badge-info">${App.escapeHtml(order.type)}</span></div>
                    <div><strong>Status:</strong> <span class="badge badge-success">${App.escapeHtml(order.status)}</span></div>
                    <div><strong>Date:</strong> ${App.formatDateTime(order.createdAt)}</div>
                    <div><strong>Cashier:</strong> ${App.escapeHtml(order.userName || '—')}</div>
                </div>
                <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
                <h4 style="margin-bottom:8px;">Items</h4>
                ${items.map(item => `
                    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
                        <div>
                            <strong>${App.escapeHtml(item.name)}</strong>
                            ${item.size ? `<small class="text-muted"> (${App.escapeHtml(item.size)})</small>` : ''}
                            ${item.condiments && item.condiments.length ? `<br><small class="text-muted">${item.condiments.map(c => App.escapeHtml(c.name)).join(', ')}</small>` : ''}
                            ${item.notes ? `<br><small class="text-muted">📝 ${App.escapeHtml(item.notes)}</small>` : ''}
                        </div>
                        <div class="text-right">
                            <div>x${item.quantity}</div>
                            <strong>${App.formatCurrency(item.lineTotal)}</strong>
                        </div>
                    </div>
                `).join('')}
                <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
                <div class="d-flex justify-between"><span>Subtotal:</span><span>${App.formatCurrency(order.subtotal)}</span></div>
                <div class="d-flex justify-between"><span>${App.escapeHtml(order.taxName || 'Tax')} (${order.taxPercentage || 0}%):</span><span>${App.formatCurrency(order.taxAmount)}</span></div>
                <div class="d-flex justify-between font-bold" style="font-size:1.1rem;margin-top:8px;padding-top:8px;border-top:2px solid var(--border);">
                    <span>Total:</span><span>${App.formatCurrency(order.total)}</span>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
                <button class="btn btn-primary" onclick="Receipt.show(DB.getById('orders','${id}'));App.closeModal();">🖨 Print Receipt</button>
            </div>
        `);
    }

    // ── Merge Orders ─────────────────────────────────────────
    function openMergeModal() {
        if (selectedOrders.length < 2) {
            App.toast('Select at least 2 orders to merge', 'error');
            return;
        }

        const orders = selectedOrders.map(id => DB.getById('orders', id)).filter(Boolean);
        const totalItems = [];
        let combinedSubtotal = 0;
        let combinedTax = 0;

        orders.forEach(order => {
            const items = DB.query('order_items', i => i.orderId === order.id);
            items.forEach(item => totalItems.push({ ...item, fromOrder: order.orderNumber }));
            combinedSubtotal += order.subtotal || 0;
            combinedTax += order.taxAmount || 0;
        });

        const combinedTotal = combinedSubtotal + combinedTax;

        App.openModal(`
            <div class="modal-header">
                <h3>🔗 Merge ${orders.length} Orders</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="max-height:60vh;overflow:auto;">
                <p class="text-muted" style="margin-bottom:16px;">Combine these orders into a single order. The original orders will be deleted.</p>

                <div style="margin-bottom:16px;padding:12px;background:var(--bg);border-radius:8px;">
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                        ${orders.map(o => `<span class="badge badge-info">#${o.orderNumber}</span>`).join('')}
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span><strong>Combined Total:</strong></span>
                        <span><strong>${App.formatCurrency(combinedTotal)}</strong></span>
                    </div>
                </div>

                <div class="form-group">
                    <label>Order Type</label>
                    <select class="form-control" id="mergeOrderType">
                        <option value="Dine-In">🍽 Dine-In</option>
                        <option value="Takeaway">🥡 Takeaway</option>
                        <option value="Delivery">🚴 Delivery</option>
                    </select>
                </div>

                <h4 style="margin:16px 0 8px;">Combined Items (${totalItems.length})</h4>
                <div class="table-container" style="max-height:300px;overflow:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>From Order</th>
                                <th>Qty</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${totalItems.map(item => `
                                <tr>
                                    <td>
                                        <strong>${App.escapeHtml(item.name)}</strong>
                                        ${item.size ? `<small class="text-muted"> (${App.escapeHtml(item.size)})</small>` : ''}
                                    </td>
                                    <td><span class="badge badge-gray">#${item.fromOrder}</span></td>
                                    <td>${item.quantity}</td>
                                    <td>${App.formatCurrency(item.lineTotal)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnConfirmMerge">Merge Orders</button>
            </div>
        `);

        document.getElementById('btnConfirmMerge').addEventListener('click', () => {
            confirmMerge(orders, totalItems);
        });
    }

    function confirmMerge(orders, items) {
        const user = Auth.currentUser();
        const orderType = document.getElementById('mergeOrderType').value;
        const orderNumber = DB.nextOrderNumber();

        const combinedSubtotal = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
        const combinedTax = orders.reduce((sum, o) => sum + (o.taxAmount || 0), 0);
        const combinedTotal = combinedSubtotal + combinedTax;
        const taxInfo = {
            name: orders[0]?.taxName || 'Tax',
            percentage: orders[0]?.taxPercentage || 0,
        };

        // Create merged order
        const mergedOrder = DB.insert('orders', {
            orderNumber,
            type: orderType,
            status: 'Completed',
            subtotal: combinedSubtotal,
            taxName: taxInfo.name,
            taxPercentage: taxInfo.percentage,
            taxAmount: combinedTax,
            total: combinedTotal,
            userId: user.id,
            userName: user.name,
            shiftId: orders[0]?.shiftId || null,
            mergedFrom: selectedOrders,
        });

        // Copy items to merged order
        items.forEach(item => {
            DB.insert('order_items', {
                orderId: mergedOrder.id,
                menuItemId: item.menuItemId,
                name: item.name,
                size: item.size,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                condiments: item.condiments,
                notes: item.notes,
                lineTotal: item.lineTotal,
            });
        });

        // Delete original orders and their items
        orders.forEach(order => {
            DB.query('order_items', i => i.orderId === order.id).forEach(item => {
                DB.remove('order_items', item.id);
            });
            DB.remove('orders', order.id);
        });

        DB.logAction('orders_merge', 'orders', mergedOrder.id, {
            mergedOrderNumber: orderNumber,
            originalOrders: orders.map(o => o.orderNumber),
            total: combinedTotal,
        });

        App.closeModal();
        selectedOrders = [];
        App.toast(`Orders merged into #${orderNumber}`);
        render();
    }

    return { render };
})();
