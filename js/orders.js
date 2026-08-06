/**
 * Orders – Order history with details
 */
const Orders = (() => {
    let filterDateFrom = '';
    let filterDateTo = '';
    let filterType = '';

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
                    <div style="display:flex;gap:10px;flex-wrap:wrap;">
                        <select class="form-control" id="orderTypeFilter" style="width:150px;">
                            <option value="">All Types</option>
                            <option value="Dine-In" ${filterType === 'Dine-In' ? 'selected' : ''}>Dine-In</option>
                            <option value="Takeaway" ${filterType === 'Takeaway' ? 'selected' : ''}>Takeaway</option>
                            <option value="Delivery" ${filterType === 'Delivery' ? 'selected' : ''}>Delivery</option>
                        </select>
                        <input type="date" class="form-control" id="orderDateFrom" value="${filterDateFrom}" style="width:160px;">
                        <input type="date" class="form-control" id="orderDateTo" value="${filterDateTo}" style="width:160px;">
                        <button class="btn btn-outline btn-sm" id="btnClearOrderFilter">Clear</button>
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
        App.toast('All orders deleted');
        render();
    }

    function renderTable(orders) {
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
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
                            return `
                                <tr>
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

    return { render };
})();
