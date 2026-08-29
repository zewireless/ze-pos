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

        // Void order (see canVoidOrder() for who's allowed, on which orders)
        el.querySelectorAll('[data-action="void"]').forEach(btn => {
            btn.addEventListener('click', () => openVoidModal(btn.dataset.id));
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

    // ── Void Order ───────────────────────────────────────────
    // Admins can void any completed order, any time. Cashiers can only
    // void an order that belongs to their own currently-open shift, and
    // must enter an admin's Manager PIN to authorize it. Voiding never
    // deletes the order — it's marked "Voided" (kept for the audit
    // trail/history) and excluded from revenue everywhere else in the
    // app, and any stock it deducted is restored.
    function canVoidOrder(order) {
        if (order.status !== 'Completed') return false;
        if (Auth.isAdmin()) return true;
        const user = Auth.currentUser();
        const openShift = Shifts.getOpenShift(user.id);
        return !!openShift && order.shiftId === openShift.id;
    }

    function openVoidModal(id) {
        const order = DB.getById('orders', id);
        if (!order || !canVoidOrder(order)) return;
        const isAdmin = Auth.isAdmin();

        App.openModal(`
            <div class="modal-header">
                <h3>↩️ Void Order #${order.orderNumber}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p class="text-muted" style="margin-bottom:16px;">
                    This marks the order as <strong>Voided</strong> — it's removed from sales totals and any stock it deducted is put back. The order stays in history for your records; it isn't deleted.
                </p>
                <div class="form-group">
                    <label>Reason <span class="required">*</span></label>
                    <textarea class="form-control" id="voidReason" rows="3" placeholder="e.g. Wrong item rung up, customer changed order..."></textarea>
                </div>
                ${!isAdmin ? `
                <div class="form-group">
                    <label>Admin PIN <span class="required">*</span></label>
                    <input type="password" inputmode="numeric" maxlength="6" class="form-control" id="voidPin" placeholder="Ask a manager for their PIN">
                </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-danger" id="btnConfirmVoid">Void Order</button>
            </div>
        `);

        document.getElementById('btnConfirmVoid').addEventListener('click', () => voidOrder(id, isAdmin));
    }

    function voidOrder(id, isAdmin) {
        const order = DB.getById('orders', id);
        if (!order || !canVoidOrder(order)) {
            App.toast('This order can no longer be voided', 'error');
            App.closeModal();
            return;
        }

        const reason = document.getElementById('voidReason').value.trim();
        if (!reason) {
            App.toast('A reason is required to void an order', 'error');
            return;
        }

        const user = Auth.currentUser();
        let authorizedBy = user.name;

        if (!isAdmin) {
            const pin = document.getElementById('voidPin').value.trim();
            if (!pin) {
                App.toast('Admin PIN is required', 'error');
                return;
            }
            const admin = DB.query('users', u => u.role === 'admin' && u.enabled !== false && u.managerPin && u.managerPin === pin)[0];
            if (!admin) {
                App.toast('Incorrect PIN', 'error');
                return;
            }
            authorizedBy = admin.name;
        }

        // Restore stock for every line item that had stock tracking enabled
        const items = DB.query('order_items', i => i.orderId === id);
        items.forEach(item => restoreStockForVoid(item, order, user));

        DB.update('orders', id, {
            status: 'Voided',
            voidedAt: new Date().toISOString(),
            voidedBy: user.name,
            voidAuthorizedBy: authorizedBy,
            voidReason: reason,
        });

        DB.logAction('order_void', 'orders', id, {
            orderNumber: order.orderNumber,
            total: order.total,
            reason,
            voidedBy: user.name,
            authorizedBy,
        });

        App.toast(`Order #${order.orderNumber} voided`);
        App.closeModal();
        render();
    }

    // Mirrors POS.deductStockForSale() in reverse — adds the sold quantity
    // back to whichever level (size or item) stock was actually tracked
    // at, and logs a 'void' stock movement for the audit trail. No-ops
    // for items/sizes that don't track stock.
    function restoreStockForVoid(orderItem, order, user) {
        const item = DB.getById('menu_items', orderItem.menuItemId);
        if (!item) return;

        const size = orderItem.size
            ? DB.query('menu_sizes', s => s.menuItemId === item.id && s.name === orderItem.size)[0]
            : null;

        let menuItemId = item.id;
        let menuSizeId = null;
        let prevQty, newQty;

        if (size && size.track_stock) {
            prevQty = parseFloat(size.stock_quantity) || 0;
            newQty = prevQty + orderItem.quantity;
            DB.update('menu_sizes', size.id, { stock_quantity: newQty });
            menuSizeId = size.id;
        } else if (item.track_stock) {
            prevQty = parseFloat(item.stock_quantity) || 0;
            newQty = prevQty + orderItem.quantity;
            DB.update('menu_items', item.id, { stock_quantity: newQty });
        } else {
            return;
        }

        DB.insert('stock_movements', {
            menuItemId,
            menuSizeId,
            movementType: 'return',
            quantityChange: newQty - prevQty,
            previousQuantity: prevQty,
            newQuantity: newQty,
            referenceId: order.id,
            referenceType: 'order',
            notes: `Restored — order #${order.orderNumber} voided`,
            userId: user.id,
            userName: user.name,
        });
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
                                <tr class="${isSelected ? 'row-selected' : ''}" style="${o.status === 'Voided' ? 'opacity:0.6;' : ''}">
                                    <td><input type="checkbox" data-action="select" data-id="${o.id}" ${isSelected ? 'checked' : ''} ${o.status === 'Voided' ? 'disabled' : ''}></td>
                                    <td><strong>#${o.orderNumber}</strong> ${o.status === 'Voided' ? '<span class="badge badge-danger" title="'+App.escapeHtml(o.voidReason || '')+'">Voided</span>' : ''}</td>
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
                                            ${canVoidOrder(o) ? `<button class="btn btn-ghost btn-sm" data-action="void" data-id="${o.id}" title="Void Order" style="color:var(--danger);">↩️</button>` : ''}
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
                    <div><strong>Status:</strong> <span class="badge ${order.status === 'Voided' ? 'badge-danger' : 'badge-success'}">${App.escapeHtml(order.status)}</span></div>
                    <div><strong>Date:</strong> ${App.formatDateTime(order.createdAt)}</div>
                    <div><strong>Cashier:</strong> ${App.escapeHtml(order.userName || '—')}</div>
                </div>
                ${order.status === 'Voided' ? `
                <div style="background:#fee2e2;border:1px solid #fecaca;border-radius:var(--radius);padding:12px;margin-bottom:16px;">
                    <div><strong>Voided by:</strong> ${App.escapeHtml(order.voidedBy || '—')} ${order.voidAuthorizedBy && order.voidAuthorizedBy !== order.voidedBy ? `(authorized by ${App.escapeHtml(order.voidAuthorizedBy)})` : ''}</div>
                    <div><strong>When:</strong> ${order.voidedAt ? App.formatDateTime(order.voidedAt) : '—'}</div>
                    <div><strong>Reason:</strong> ${App.escapeHtml(order.voidReason || '—')}</div>
                </div>
                ` : ''}
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
                ${canVoidOrder(order) ? `<button class="btn btn-danger" onclick="App.closeModal();Orders.openVoidModal('${id}');">↩️ Void Order</button>` : ''}
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

    return { render, openVoidModal };
})();
