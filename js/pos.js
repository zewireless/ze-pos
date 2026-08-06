/**
 * POS – Point of Sale screen with product grid, cart, and order processing
 */
const POS = (() => {
    let cart = [];
    let activeCategory = '';
    let searchQuery = '';
    let orderType = 'Dine-In';

    function render() {
        const el = document.getElementById('page-pos');
        const user = Auth.currentUser();
        const openShift = Shifts.getOpenShift(user.id);

        // Cashiers must start a shift before they can use the POS
        if (user.role === 'cashier' && !openShift) {
            el.innerHTML = `${renderShiftBar(null, 0, 0)}${renderLockScreen(user.id)}`;
            bindLockEvents();
            return;
        }

        const categories = DB.getAll('categories').filter(c => c.enabled);
        const items = getFilteredItems();

        // Compute shift stats for the bar
        let shiftOrderCount = 0;
        let shiftTotalSales = 0;
        if (openShift) {
            const shiftOrders = DB.query('orders', o => o.shiftId === openShift.id);
            shiftOrderCount = shiftOrders.length;
            shiftTotalSales = shiftOrders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
        }

        el.innerHTML = `
            ${renderShiftBar(openShift, shiftOrderCount, shiftTotalSales)}
            <div class="pos-layout">
                <!-- Left: Products -->
                <div class="pos-products">
                    <div class="pos-categories-bar">
                        <button class="pos-cat-btn ${activeCategory === '' ? 'active' : ''}" data-cat="">All</button>
                        ${categories.map(c => `
                            <button class="pos-cat-btn ${activeCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${App.escapeHtml(c.name)}</button>
                        `).join('')}
                    </div>
                    <div class="pos-search-bar">
                        <input type="text" id="posSearch" placeholder="Search menu items..." value="${App.escapeHtml(searchQuery)}">
                    </div>
                    <div class="pos-product-grid" id="posProductGrid">
                        ${items.length === 0
                            ? '<div class="empty-state" style="grid-column:1/-1;"><span class="icon">🔍</span><h3>No items found</h3><p>Try a different search or category.</p></div>'
                            : items.map(item => productCard(item)).join('')
                        }
                    </div>
                </div>

                <!-- Right: Cart -->
                <div class="pos-cart">
                    <div class="pos-cart-header">
                        <h3>Current Order</h3>
                        <span class="pos-cart-count" id="cartCount">${cart.length}</span>
                    </div>
                    <div class="pos-cart-items" id="cartItems">
                        ${cart.length === 0
                            ? '<div class="pos-cart-empty"><span class="icon">🛒</span><p>Cart is empty.<br>Click items to add.</p></div>'
                            : cart.map((item, idx) => cartItemRow(item, idx)).join('')
                        }
                    </div>
                    <div class="pos-cart-footer">
                        <div class="pos-order-types">
                            <button class="pos-order-type ${orderType === 'Dine-In' ? 'active' : ''}" data-type="Dine-In">🍽 Dine-In</button>
                            <button class="pos-order-type ${orderType === 'Takeaway' ? 'active' : ''}" data-type="Takeaway">🥡 Takeaway</button>
                            <button class="pos-order-type ${orderType === 'Delivery' ? 'active' : ''}" data-type="Delivery">🚴 Delivery</button>
                        </div>
                        <div class="pos-totals" id="posTotals">
                            ${renderTotals()}
                        </div>
                        <button class="btn-complete-order" id="btnCompleteOrder" ${cart.length === 0 ? 'disabled' : ''}>
                            Complete Order
                        </button>
                    </div>
                </div>
            </div>
        `;

        bindEvents();
    }

    // ── Shift Bar ──────────────────────────────────────────────
    function renderShiftBar(openShift, orderCount, totalSales) {
        if (openShift) {
            return `
                <div class="shift-status-bar active">
                    <div class="shift-status-info">
                        <span class="badge badge-success" style="font-size:0.8rem;">● Shift Active</span>
                        <span>Started <strong>${App.formatDateTime(openShift.startTime)}</strong></span>
                        <span class="shift-meta">${orderCount} order${orderCount !== 1 ? 's' : ''} · ${App.formatCurrency(totalSales)}</span>
                    </div>
                    <button class="btn btn-danger btn-sm" data-action="pos-end-shift">End Shift</button>
                </div>
            `;
        }
        return `
            <div class="shift-status-bar inactive">
                <div class="shift-status-info">
                    <span class="badge badge-warning" style="font-size:0.8rem;">○ No Active Shift</span>
                    <span class="shift-meta">Start a shift before taking orders</span>
                </div>
                <button class="btn btn-success btn-sm" data-action="pos-start-shift">Start Shift</button>
            </div>
        `;
    }

    // ── Shift Lock Screen (cashiers only) ─────────────────────
    function renderLockScreen(userId) {
        const scheduled = Schedules.isCurrentlyScheduled(userId);
        const today = Schedules.getTodaySchedules(userId);
        const next = scheduled ? null : Schedules.getNextShift(userId);

        return `
            <div class="pos-lock">
                <div class="pos-lock-icon">🔒</div>
                <h3>POS Locked</h3>
                <p>Start your shift before taking orders, so every sale is recorded to your shift.</p>

                ${today.length ? `
                    <div class="pos-lock-sched">
                        <strong>Today's schedule:</strong>
                        ${today.map(t => {
                            const badge = t.status === 'active' ? 'badge-success'
                                : t.status === 'upcoming' ? 'badge-info' : 'badge-warning';
                            return `<span class="badge ${badge}">${App.escapeHtml(t.startTime)} – ${App.escapeHtml(t.endTime)} (${t.status})</span>`;
                        }).join(' ')}
                    </div>
                ` : ''}

                ${scheduled ? `
                    <div class="pos-lock-ok">✅ You're scheduled now — start your shift to begin taking orders.</div>
                ` : `
                    <div class="pos-lock-warning">
                        ⚠️ You're not scheduled to work right now.
                        ${next
                            ? `<br>Next shift: <strong>${next.dayLabel} ${next.startTime} – ${next.endTime}</strong>`
                            : '<br>You have no scheduled shifts. Contact your manager.'
                        }
                    </div>
                `}

                <div class="pos-lock-actions">
                    <button class="btn btn-success btn-lg" data-action="pos-start-shift" ${scheduled ? '' : 'disabled'}>▶ Start Shift</button>
                    <button class="btn btn-outline btn-lg" data-action="pos-go-shifts">📅 View My Schedule</button>
                </div>
            </div>
        `;
    }

    function bindLockEvents() {
        const el = document.getElementById('page-pos');
        el.querySelectorAll('[data-action="pos-start-shift"]').forEach(btn => {
            btn.addEventListener('click', openStartShiftModal);
        });
        el.querySelectorAll('[data-action="pos-go-shifts"]').forEach(btn => {
            btn.addEventListener('click', () => App.navigateTo('shifts'));
        });
    }

    function openStartShiftModal() {
        const user = Auth.currentUser();

        // Already have an open shift?
        if (Shifts.getOpenShift(user.id)) {
            App.toast('You already have an open shift', 'error');
            return;
        }

        // Cashiers must be currently scheduled (strict enforcement)
        if (user.role === 'cashier' && !Schedules.isCurrentlyScheduled(user.id)) {
            const next = Schedules.getNextShift(user.id);
            App.toast(
                next
                    ? `You're not scheduled right now. Next shift: ${next.dayLabel} ${next.startTime}–${next.endTime}`
                    : "You're not scheduled to work right now.",
                'error'
            );
            return;
        }

        const scheduledWindow = user.role === 'cashier'
            ? Schedules.getTodaySchedules(user.id).filter(t => t.status === 'active')[0]
            : null;

        App.openModal(`
            <div class="modal-header">
                <h3>Start New Shift</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Cashier</label>
                    <input type="text" class="form-control" value="${App.escapeHtml(user.name)}" readonly style="background:#f1f5f9;cursor:not-allowed;">
                </div>
                ${scheduledWindow ? `
                    <div class="form-group">
                        <label>Scheduled Shift</label>
                        <input type="text" class="form-control" value="${App.escapeHtml(scheduledWindow.startTime)} – ${App.escapeHtml(scheduledWindow.endTime)}" readonly style="background:#f1f5f9;cursor:not-allowed;">
                    </div>
                ` : ''}
                <div class="form-group">
                    <label>Starting Cash Float ($)</label>
                    <input type="number" class="form-control" id="startingCashInput" step="0.01" min="0"
                           placeholder="Enter the starting cash amount (optional)" value="0">
                    <small class="form-hint">The amount of cash in the drawer at the start of your shift.</small>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-success" id="btnConfirmStartShift">Start Shift</button>
            </div>
        `);

        document.getElementById('btnConfirmStartShift').addEventListener('click', () => {
            const startingCashVal = document.getElementById('startingCashInput').value;
            const startingCash = startingCashVal !== '' ? parseFloat(startingCashVal) : 0;

            const res = Shifts.startShift(user.id, user.name, startingCash);
            if (res.ok) {
                App.closeModal();
                App.toast('Shift started successfully');
                render();
            } else {
                App.toast(res.message, 'error');
            }
        });

        document.getElementById('startingCashInput').focus();
    }

    function openEndShiftModal() {
        const user = Auth.currentUser();
        const openShift = Shifts.getOpenShift(user.id);
        if (!openShift) return;

        const orders = DB.query('orders', o => o.shiftId === openShift.id);
        const totalSales = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);

        App.openModal(`
            <div class="modal-header">
                <h3>End Shift</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="stats-grid" style="margin-bottom:20px;">
                    <div class="stat-card">
                        <div class="stat-icon blue">📦</div>
                        <div class="stat-info">
                            <div class="stat-label">Orders Taken</div>
                            <div class="stat-value">${orders.length}</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon green">💵</div>
                        <div class="stat-info">
                            <div class="stat-label">Total Sales</div>
                            <div class="stat-value">${App.formatCurrency(totalSales)}</div>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Starting Cash Float</label>
                    <input type="text" class="form-control" value="${App.formatCurrency(openShift.startingCash || 0)}" readonly style="background:#f1f5f9;cursor:not-allowed;">
                </div>
                <div class="form-group">
                    <label>Counted Cash ($)</label>
                    <input type="number" class="form-control" id="posEndingCashInput" step="0.01" min="0"
                           placeholder="Enter the counted cash amount">
                    <small class="form-hint">Optional — skip if you don't want to reconcile cash.</small>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-danger" id="btnConfirmPosEndShift">End Shift</button>
            </div>
        `);

        document.getElementById('btnConfirmPosEndShift').addEventListener('click', () => {
            const endingCashVal = document.getElementById('posEndingCashInput').value;
            const endingCash = endingCashVal !== '' ? parseFloat(endingCashVal) : null;

            Shifts.endShift(openShift.id, endingCash);
            App.closeModal();
            App.toast('Shift ended');
            render();
        });

        document.getElementById('posEndingCashInput').focus();
    }

    function getFilteredItems() {
        let items = DB.getAll('menu_items').filter(i => i.enabled);
        if (activeCategory) {
            items = items.filter(i => i.categoryId === activeCategory);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            items = items.filter(i => i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q));
        }
        return items;
    }

    function productCard(item) {
        const sizes = DB.query('menu_sizes', s => s.menuItemId === item.id);
        const minPrice = sizes.length ? Math.min(...sizes.map(s => parseFloat(s.price) || 0)) : 0;
        const category = DB.getById('categories', item.categoryId);

        return `
            <div class="pos-product-card" data-item-id="${item.id}">
                <div class="pos-product-img">
                    ${item.image
                        ? `<img src="${item.image}" alt="${App.escapeHtml(item.name)}">`
                        : '🍽'
                    }
                </div>
                <div class="pos-product-name" title="${App.escapeHtml(item.name)}">${App.escapeHtml(item.name)}</div>
                <div class="pos-product-price">${App.formatCurrency(minPrice)}</div>
                ${category ? `<div class="pos-product-cat">${App.escapeHtml(category.name)}</div>` : ''}
            </div>
        `;
    }

    function cartItemRow(item, idx) {
        const condText = item.condiments && item.condiments.length > 0
            ? item.condiments.map(c => c.name).join(', ')
            : '';

        return `
            <div class="pos-cart-item">
                <div class="pos-cart-item-header">
                    <div>
                        <div class="pos-cart-item-name">${App.escapeHtml(item.name)}</div>
                        <div class="pos-cart-item-meta">
                            ${item.size ? App.escapeHtml(item.size) : ''}
                            ${condText ? ' · ' + App.escapeHtml(condText) : ''}
                            ${item.notes ? ' · ' + App.escapeHtml(item.notes) : ''}
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span class="pos-cart-item-price">${App.formatCurrency(item.lineTotal)}</span>
                        <button class="pos-cart-item-remove" data-remove="${idx}" title="Remove">✕</button>
                    </div>
                </div>
                <div class="pos-cart-item-controls">
                    <button class="btn-icon btn-sm" data-qty="-1" data-idx="${idx}">−</button>
                    <span class="qty">${item.quantity}</span>
                    <button class="btn-icon btn-sm" data-qty="1" data-idx="${idx}">+</button>
                </div>
            </div>
        `;
    }

    function renderTotals() {
        const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
        const taxInfo = getActiveTax();
        const taxAmount = taxInfo.enabled ? subtotal * taxInfo.percentage / 100 : 0;
        const total = subtotal + taxAmount;

        return `
            <div class="pos-total-row">
                <span>Subtotal</span>
                <span>${App.formatCurrency(subtotal)}</span>
            </div>
            ${taxInfo.enabled ? `
                <div class="pos-total-row">
                    <span>${App.escapeHtml(taxInfo.name)} (${taxInfo.percentage}%)</span>
                    <span>${App.formatCurrency(taxAmount)}</span>
                </div>
            ` : ''}
            <div class="pos-total-row grand">
                <span>Total</span>
                <span>${App.formatCurrency(total)}</span>
            </div>
        `;
    }

    function getActiveTax() {
        const taxes = DB.getAll('taxes').filter(t => t.enabled);
        return taxes[0] || { name: 'Tax', percentage: 0, enabled: false };
    }

    // ── Add to Cart Modal ──────────────────────────────────────
    function openItemModal(itemId) {
        // Cashiers cannot add items outside an active shift
        const user = Auth.currentUser();
        if (user.role === 'cashier' && !Shifts.getOpenShift(user.id)) {
            App.toast('Start your shift before taking orders', 'error');
            return;
        }

        const item = DB.getById('menu_items', itemId);
        if (!item) return;

        const sizes = DB.query('menu_sizes', s => s.menuItemId === itemId);
        const condiments = DB.getAll('condiments').filter(c => c.enabled);
        const selectedSize = sizes.length > 0 ? sizes[0] : null;

        App.openModal(`
            <div class="modal-header">
                <h3>${App.escapeHtml(item.name)}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                ${item.description ? `<p class="text-muted" style="margin-bottom:16px;">${App.escapeHtml(item.description)}</p>` : ''}

                ${sizes.length > 1 ? `
                    <label style="font-weight:600;margin-bottom:8px;display:block;">Select Size</label>
                    <div class="size-options" id="sizeOptions">
                        ${sizes.map((s, i) => `
                            <div class="size-option ${i === 0 ? 'active' : ''}" data-size-name="${App.escapeHtml(s.name)}" data-size-price="${s.price}">
                                <span class="size-name">${App.escapeHtml(s.name)}</span>
                                <span class="size-price">${App.formatCurrency(s.price)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : sizes.length === 1 ? `
                    <input type="hidden" id="selectedSizeName" value="${App.escapeHtml(sizes[0].name)}">
                    <input type="hidden" id="selectedSizePrice" value="${sizes[0].price}">
                ` : ''}

                ${condiments.length > 0 ? `
                    <label style="font-weight:600;margin-bottom:8px;display:block;">Add-ons</label>
                    <div class="condiment-list" id="condimentList">
                        ${condiments.map(c => `
                            <label class="condiment-item" data-cond-id="${c.id}" data-cond-name="${App.escapeHtml(c.name)}" data-cond-price="${c.price}">
                                <input type="checkbox" value="${c.id}">
                                <span class="condiment-name">${App.escapeHtml(c.name)}</span>
                                <span class="condiment-price">+${App.formatCurrency(c.price)}</span>
                            </label>
                        `).join('')}
                    </div>
                ` : ''}

                <div class="form-group" style="margin-top:16px;margin-bottom:0;">
                    <label>Notes</label>
                    <input type="text" class="form-control" id="itemNotes" placeholder="e.g. No onions, extra crispy...">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary btn-lg" id="btnAddToCart">Add to Order</button>
            </div>
        `);

        // Size selection
        document.querySelectorAll('.size-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.size-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
            });
        });

        // Condiment toggle
        document.querySelectorAll('.condiment-item').forEach(ci => {
            ci.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const cb = ci.querySelector('input');
                    cb.checked = !cb.checked;
                }
                ci.classList.toggle('active', ci.querySelector('input').checked);
            });
        });

        // Add to cart
        document.getElementById('btnAddToCart').addEventListener('click', () => {
            // Get selected size
            let sizeName = '', sizePrice = 0;
            const activeSize = document.querySelector('.size-option.active');
            if (activeSize) {
                sizeName = activeSize.dataset.sizeName;
                sizePrice = parseFloat(activeSize.dataset.sizePrice) || 0;
            } else if (sizes.length === 1) {
                sizeName = sizes[0].name;
                sizePrice = parseFloat(sizes[0].price) || 0;
            }

            // Get selected condiments
            const selectedConds = [];
            document.querySelectorAll('.condiment-item.active').forEach(ci => {
                selectedConds.push({
                    id: ci.dataset.condId,
                    name: ci.dataset.condName,
                    price: parseFloat(ci.dataset.condPrice) || 0,
                });
            });

            const notes = document.getElementById('itemNotes').value.trim();
            const condTotal = selectedConds.reduce((sum, c) => sum + c.price, 0);
            const unitPrice = sizePrice + condTotal;

            cart.push({
                itemId: item.id,
                name: item.name,
                size: sizeName,
                sizePrice: sizePrice,
                quantity: 1,
                condiments: selectedConds,
                notes: notes,
                unitPrice: unitPrice,
                lineTotal: unitPrice,
            });

            App.closeModal();
            updateCart();
            App.toast(`${item.name} added to order`);
        });
    }

    // ── Cart Updates ───────────────────────────────────────────
    function updateCart() {
        const countEl = document.getElementById('cartCount');
        const itemsEl = document.getElementById('cartItems');
        const totalsEl = document.getElementById('posTotals');
        const completeBtn = document.getElementById('btnCompleteOrder');

        if (countEl) countEl.textContent = cart.length;
        if (itemsEl) {
            itemsEl.innerHTML = cart.length === 0
                ? '<div class="pos-cart-empty"><span class="icon">🛒</span><p>Cart is empty.<br>Click items to add.</p></div>'
                : cart.map((item, idx) => cartItemRow(item, idx)).join('');
            bindCartEvents();
        }
        if (totalsEl) totalsEl.innerHTML = renderTotals();
        if (completeBtn) completeBtn.disabled = cart.length === 0;
    }

    function bindCartEvents() {
        // Quantity buttons
        document.querySelectorAll('[data-qty]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                const delta = parseInt(btn.dataset.qty);
                cart[idx].quantity = Math.max(1, cart[idx].quantity + delta);
                cart[idx].lineTotal = cart[idx].unitPrice * cart[idx].quantity;
                updateCart();
            });
        });

        // Remove buttons
        document.querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.remove);
                cart.splice(idx, 1);
                updateCart();
            });
        });
    }

    // ── Complete Order ─────────────────────────────────────────
    function completeOrder() {
        if (cart.length === 0) return;

        const user = Auth.currentUser();
        // Cashiers cannot complete orders outside an active shift
        if (user.role === 'cashier' && !Shifts.getOpenShift(user.id)) {
            App.toast('Start your shift before taking orders', 'error');
            return;
        }
        const orderNumber = DB.nextOrderNumber();
        const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
        const taxInfo = getActiveTax();
        const taxAmount = taxInfo.enabled ? subtotal * taxInfo.percentage / 100 : 0;
        const total = subtotal + taxAmount;

        // Create order
        const openShift = Shifts.getOpenShift(user.id);
        const order = DB.insert('orders', {
            orderNumber,
            type: orderType,
            status: 'Completed',
            subtotal,
            taxName: taxInfo.name,
            taxPercentage: taxInfo.percentage,
            taxAmount,
            total,
            userId: user.id,
            userName: user.name,
            shiftId: openShift ? openShift.id : null,
        });

        // Create order items
        cart.forEach(item => {
            DB.insert('order_items', {
                orderId: order.id,
                menuItemId: item.itemId,
                name: item.name,
                size: item.size,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                condiments: item.condiments,
                notes: item.notes,
                lineTotal: item.lineTotal,
            });
        });

        // Show receipt
        Receipt.show(order);

        // Clear cart
        cart = [];
        updateCart();
        App.toast(`Order #${orderNumber} completed!`);
    }

    // ── Bind Events ────────────────────────────────────────────
    function bindEvents() {
        // Product clicks
        document.querySelectorAll('.pos-product-card').forEach(card => {
            card.addEventListener('click', () => {
                openItemModal(card.dataset.itemId);
            });
        });

        // Category filter
        document.querySelectorAll('.pos-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeCategory = btn.dataset.cat;
                render();
            });
        });

        // Search
        const searchInput = document.getElementById('posSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value;
                // Re-render just the product grid
                const grid = document.getElementById('posProductGrid');
                const items = getFilteredItems();
                grid.innerHTML = items.length === 0
                    ? '<div class="empty-state" style="grid-column:1/-1;"><span class="icon">🔍</span><h3>No items found</h3><p>Try a different search or category.</p></div>'
                    : items.map(item => productCard(item)).join('');
                // Rebind product clicks
                document.querySelectorAll('.pos-product-card').forEach(card => {
                    card.addEventListener('click', () => openItemModal(card.dataset.itemId));
                });
            });
        }

        // Order type
        document.querySelectorAll('.pos-order-type').forEach(btn => {
            btn.addEventListener('click', () => {
                orderType = btn.dataset.type;
                document.querySelectorAll('.pos-order-type').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Complete order
        document.getElementById('btnCompleteOrder').addEventListener('click', completeOrder);

        // Shift bar buttons
        const startShiftBtn = document.querySelector('[data-action="pos-start-shift"]');
        if (startShiftBtn) {
            startShiftBtn.addEventListener('click', openStartShiftModal);
        }
        const endShiftBtn = document.querySelector('[data-action="pos-end-shift"]');
        if (endShiftBtn) {
            endShiftBtn.addEventListener('click', openEndShiftModal);
        }

        // Bind cart events
        bindCartEvents();
    }

    return { render };
})();
