/**
 * POS – Point of Sale screen with product grid, cart, and order processing
 */
const POS = (() => {
    let cart = [];
    let activeCategory = '';
    let searchQuery = '';
    let orderType = 'Dine-In';
    let selectedCartIndex = -1; // For keyboard navigation
    let keyboardHandlerAttached = false;
    let favorites = []; // Array of menu item IDs
    const FAVORITES_KEY = 'ze-pos-favorites';

    // Customer-display broadcast channel (Supabase Realtime). Scoped by
    // workspace_id + store_id so two different businesses never land on the
    // same channel name. Re-created lazily if the active store changes.
    let cdChannel = null;
    let cdChannelKey = null;

    // ── Keyboard Shortcuts ────────────────────────────────────────
    function initKeyboardShortcuts() {
        if (keyboardHandlerAttached) return;
        keyboardHandlerAttached = true;

        document.addEventListener('keydown', handleKeyDown);
    }

    function destroyKeyboardShortcuts() {
        if (!keyboardHandlerAttached) return;
        keyboardHandlerAttached = false;
        document.removeEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e) {
        // Only handle shortcuts when POS is visible and no modal/input is focused
        const posEl = document.getElementById('page-pos');
        if (!posEl || posEl.offsetParent === null) return;

        const activeEl = document.activeElement;
        const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable);
        const isModalOpen = document.querySelector('.modal-backdrop:not(.hidden)') || document.querySelector('.modal-backdrop.confirm-dialog:not(.hidden)');

        // Global shortcuts that work even with input focus
        if (e.key === 'F1' || (e.key === '?' && e.shiftKey)) {
            e.preventDefault();
            showKeyboardHelp();
            return;
        }

        if (isInputFocused || isModalOpen) {
            // In modal/input: only allow Escape to close
            if (e.key === 'Escape') {
                if (isModalOpen) App.closeModal();
            }
            return;
        }

        // POS-specific shortcuts
        switch (e.key) {
            case 'Enter':
                e.preventDefault();
                if (cart.length > 0) completeOrder();
                break;

            case 'Escape':
                e.preventDefault();
                if (selectedCartIndex >= 0) {
                    clearCartSelection();
                } else if (cart.length > 0) {
                    clearCart();
                }
                break;

            case 'Backspace':
            case 'Delete':
                e.preventDefault();
                if (selectedCartIndex >= 0) {
                    removeCartItem(selectedCartIndex);
                } else if (cart.length > 0) {
                    removeCartItem(cart.length - 1);
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                navigateCart(-1);
                break;

            case 'ArrowDown':
                e.preventDefault();
                navigateCart(1);
                break;

            case 'ArrowLeft':
                e.preventDefault();
                adjustQuantity(-1);
                break;

            case 'ArrowRight':
                e.preventDefault();
                adjustQuantity(1);
                break;

            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
                // Numpad or number row: set quantity for selected item
                if (selectedCartIndex >= 0) {
                    e.preventDefault();
                    setQuantity(parseInt(e.key));
                }
                break;

            case '0':
                if (selectedCartIndex >= 0) {
                    e.preventDefault();
                    setQuantity(10);
                }
                break;

            case '+':
            case '=':
                e.preventDefault();
                adjustQuantity(1);
                break;

            case '-':
            case '_':
                e.preventDefault();
                adjustQuantity(-1);
                break;

            case 'c':
            case 'C':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    clearCart();
                }
                break;

            case 'd':
            case 'D':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    toggleOrderType();
                }
                break;

            case 's':
            case 'S':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    focusSearch();
                }
                break;

            default:
                // Numpad keys (when NumLock is on)
                if (e.key >= '0' && e.key <= '9' && e.location === KeyboardEvent.DOM_KEY_LOCATION_NUMPAD) {
                    if (selectedCartIndex >= 0) {
                        e.preventDefault();
                        setQuantity(parseInt(e.key));
                    }
                }
        }
    }

    function showKeyboardHelp() {
        App.openModal(`
            <div class="modal-header">
                <h3>⌨ Keyboard Shortcuts</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="max-height:70vh;overflow:auto;">
                <table class="shortcut-table" style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                    <thead>
                        <tr style="border-bottom:2px solid var(--border);text-align:left;">
                            <th style="padding:8px 12px;color:var(--text-muted);font-weight:600;">Key</th>
                            <th style="padding:8px 12px;color:var(--text-muted);font-weight:600;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">Enter</kbd></td><td style="padding:8px 12px;">Complete Order</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">Escape</kbd></td><td style="padding:8px 12px;">Clear Selection / Clear Cart</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">↑ ↓</kbd></td><td style="padding:8px 12px;">Navigate Cart Items</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">← →</kbd></td><td style="padding:8px 12px;">Decrease / Increase Quantity</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">1-9, 0</kbd></td><td style="padding:8px 12px;">Set Quantity (1-10) for Selected Item</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">+ / -</kbd></td><td style="padding:8px 12px;">Increase / Decrease Quantity</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">Backspace / Delete</kbd></td><td style="padding:8px 12px;">Remove Selected/Last Item</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">Ctrl+C</kbd></td><td style="padding:8px 12px;">Clear Cart</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">Ctrl+D</kbd></td><td style="padding:8px 12px;">Toggle Order Type (Dine-In/Takeaway/Delivery)</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">Ctrl+S</kbd></td><td style="padding:8px 12px;">Focus Search</td></tr>
                        <tr><td style="padding:8px 12px;"><kbd style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">? / Shift+/</kbd></td><td style="padding:8px 12px;">Show This Help</td></tr>
                    </tbody>
                </table>
                <p style="margin-top:16px;color:var(--text-muted);font-size:0.85rem;">
                    <strong>Tip:</strong> Click any cart item to select it, then use number keys to quickly set quantity.
                    Works with both number row and numpad.
                </p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" onclick="App.closeModal()">Got it</button>
            </div>
        `);
    }

    function navigateCart(direction) {
        if (cart.length === 0) return;
        selectedCartIndex = Math.max(0, Math.min(cart.length - 1, selectedCartIndex + direction));
        updateCartSelection();
    }

    function adjustQuantity(delta) {
        if (selectedCartIndex < 0 || selectedCartIndex >= cart.length) return;
        const ci = cart[selectedCartIndex];
        if (delta > 0) {
            const limit = getStockLimit(ci.itemId, ci.size);
            if (limit !== null && cartQuantityFor(ci.itemId, ci.size, selectedCartIndex) + ci.quantity + delta > limit) {
                App.toast(`Only ${formatStockQty(limit)} ${DB.getById('menu_items', ci.itemId)?.unit || 'pcs'} left in stock`, 'error');
                return;
            }
        }
        ci.quantity = Math.max(1, ci.quantity + delta);
        ci.lineTotal = ci.unitPrice * ci.quantity;
        updateCart();
    }

    function setQuantity(qty) {
        if (selectedCartIndex < 0 || selectedCartIndex >= cart.length) return;
        cart[selectedCartIndex].quantity = Math.max(1, Math.min(99, qty));
        cart[selectedCartIndex].lineTotal = cart[selectedCartIndex].unitPrice * cart[selectedCartIndex].quantity;
        updateCart();
    }

    function removeCartItem(idx) {
        if (idx < 0 || idx >= cart.length) return;
        cart.splice(idx, 1);
        selectedCartIndex = Math.min(selectedCartIndex, cart.length - 1);
        updateCart();
    }

    function clearCartSelection() {
        selectedCartIndex = -1;
        updateCartSelection();
    }

    function clearCart() {
        cart = [];
        selectedCartIndex = -1;
        updateCart();
    }

    function toggleOrderType() {
        const types = ['Dine-In', 'Takeaway', 'Delivery'];
        const currentIdx = types.indexOf(orderType);
        orderType = types[(currentIdx + 1) % types.length];
        render(); // Re-render to update active button
    }

    function focusSearch() {
        const searchInput = document.getElementById('posSearch');
        if (searchInput) searchInput.focus();
    }

    function updateCartSelection() {
        document.querySelectorAll('.pos-cart-item').forEach((el, idx) => {
            el.classList.toggle('selected', idx === selectedCartIndex);
        });
    }

    // ── Favorites Management ──────────────────────────────────────
    function loadFavorites() {
        try {
            const stored = localStorage.getItem(FAVORITES_KEY);
            favorites = stored ? JSON.parse(stored) : [];
        } catch {
            favorites = [];
        }
    }

    function saveFavorites() {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    }

    function toggleFavorite(itemId) {
        const idx = favorites.indexOf(itemId);
        if (idx >= 0) {
            favorites.splice(idx, 1);
        } else if (favorites.length < 10) {
            favorites.push(itemId);
        } else {
            App.toast('Maximum 10 favorites allowed', 'warning');
            return false;
        }
        saveFavorites();
        return true;
    }

    function isFavorite(itemId) {
        return favorites.includes(itemId);
    }

    function getFavoriteItems() {
        return favorites.map(id => DB.getById('menu_items', id)).filter(Boolean);
    }

    function renderFavoritesBar() {
        const favItems = getFavoriteItems();
        if (favItems.length === 0) {
            return `
                <div class="pos-favorites-bar empty">
                    <span class="pos-favorites-label">★ Favorites</span>
                    <button class="btn btn-ghost btn-sm pos-add-favorite-hint" data-action="show-favorites-help">
                        Click ★ on any item to pin it here (max 10)
                    </button>
                </div>
            `;
        }

        return `
            <div class="pos-favorites-bar">
                <span class="pos-favorites-label">★ Favorites</span>
                <div class="pos-favorites-items">
                    ${favItems.map(item => {
                        const sizes = DB.query('menu_sizes', s => s.menuItemId === item.id);
                        const minPrice = sizes.length ? Math.min(...sizes.map(s => parseFloat(s.price) || 0)) : 0;
                        return `
                            <button class="pos-favorite-item" data-item-id="${item.id}" title="${App.escapeHtml(item.name)} - ${App.formatCurrency(minPrice)}">
                                <span class="pos-favorite-img">
                                    ${App.safeImageUrl(item.image)
                                        ? `<img src="${App.safeImageUrl(item.image)}" alt="${App.escapeHtml(item.name)}">`
                                        : '🍽'
                                    }
                                </span>
                                <span class="pos-favorite-name">${App.escapeHtml(item.name)}</span>
                                <span class="pos-favorite-price">${App.formatCurrency(minPrice)}</span>
                                <button class="pos-favorite-remove" data-remove-fav="${item.id}" title="Remove from favorites" tabindex="-1">✕</button>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function render() {
        loadFavorites();
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
                    ${renderFavoritesBar()}
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
                        <div style="display:flex;gap:8px;">
                            <button class="btn-split-bill" id="btnSplitBill" ${cart.length < 2 ? 'disabled' : ''} title="Split into multiple bills">
                                ✂️ Split
                            </button>
                            <button class="btn-complete-order" id="btnCompleteOrder" ${cart.length === 0 ? 'disabled' : ''}>
                                Complete Order
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        bindEvents();
        initKeyboardShortcuts();
    }

    // ── Shift Bar ──────────────────────────────────────────────
    function renderShiftBar(openShift, orderCount, totalSales) {
        if (openShift) {
            const user = Auth.currentUser();
            const activeBreak = Shifts.getActiveBreak(openShift.id).find(b => b.userId === user.id);
            const allBreaks = Shifts.getShiftBreaks(openShift.id).filter(b => b.userId === user.id);
            const totalBreakMins = allBreaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);

            return `
                <div class="shift-status-bar active">
                    <div class="shift-status-info">
                        <span class="badge badge-success" style="font-size:0.8rem;">● Shift Active</span>
                        <span>Started <strong>${App.formatDateTime(openShift.startTime)}</strong></span>
                        <span class="shift-meta">${orderCount} order${orderCount !== 1 ? 's' : ''} · ${App.formatCurrency(totalSales)}</span>
                        <span class="shift-meta break-meta">
                            ${activeBreak
                                ? `<span class="break-active-indicator">⏸ On ${activeBreak.breakType} break</span>`
                                : `<span>Break: ${Shifts.formatBreakDuration(totalBreakMins)}</span>`
                            }
                        </span>
                    </div>
                    <div class="shift-actions">
                        ${activeBreak
                            ? `<button class="btn btn-danger btn-sm" data-action="pos-end-break" data-break-id="${activeBreak.id}">End Break</button>`
                            : `
                                <button class="btn btn-outline btn-sm" data-action="pos-start-break" data-type="rest">☕ Rest</button>
                                <button class="btn btn-outline btn-sm" data-action="pos-start-break" data-type="meal">🍽 Meal</button>
                            `}
                        <button class="btn btn-outline btn-sm" data-action="pos-shift-notes">📝 Notes</button>
                        <button class="btn btn-danger btn-sm" data-action="pos-end-shift">End Shift</button>
                    </div>
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
        const activeBreak = Shifts.getActiveBreak(openShift.id).find(b => b.userId === user.id);

        // Calculate break time
        const allBreaks = Shifts.getShiftBreaks(openShift.id).filter(b => b.userId === user.id);
        const totalBreakMins = allBreaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);

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
                    <div class="stat-card">
                        <div class="stat-icon orange">⏱</div>
                        <div class="stat-info">
                            <div class="stat-label">Break Time</div>
                            <div class="stat-value">${Shifts.formatBreakDuration(totalBreakMins)}</div>
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
                <div class="form-group">
                    <label>Shift Notes (for your records)</label>
                    <textarea class="form-control" id="posShiftNotes" rows="2" placeholder="Any notes about this shift...">${App.escapeHtml(openShift.notes || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Handover Notes (for next cashier & admins)</label>
                    <textarea class="form-control" id="posHandoverNotes" rows="2" placeholder="Important info for the next shift...">${App.escapeHtml(openShift.handover_notes || '')}</textarea>
                </div>
                ${activeBreak ? `
                    <div class="alert alert-warning" style="margin-top:12px;padding:12px;background:#fff7ed;border:1px solid #fde68a;border-radius:var(--radius);color:#92400e;">
                        ⚠️ <strong>Active Break:</strong> You have a ${activeBreak.breakType} break in progress. It will be auto-ended when you end your shift.
                    </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-danger" id="btnConfirmPosEndShift">End Shift</button>
            </div>
        `);

        document.getElementById('btnConfirmPosEndShift').addEventListener('click', () => {
            const endingCashVal = document.getElementById('posEndingCashInput').value;
            const endingCash = endingCashVal !== '' ? parseFloat(endingCashVal) : null;
            const notes = document.getElementById('posShiftNotes')?.value || '';
            const handoverNotes = document.getElementById('posHandoverNotes')?.value || '';

            // End any active break first
            if (activeBreak) {
                Shifts.endBreak(activeBreak.id);
            }

            Shifts.endShift(openShift.id, endingCash, notes, handoverNotes);
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

    // ── Stock helpers ────────────────────────────────────────────
    // Returns { qty, threshold } if this item's remaining stock should be
    // shown/enforced, or null if stock isn't tracked for it. When the item
    // itself doesn't track stock but its sizes do, qty is the sum across
    // tracked sizes (used for the tile's summary badge only — the actual
    // limit enforced at add-to-cart time is the specific size selected).
    function stockBadgeFor(item) {
        if (item.track_stock) {
            return {
                qty: Math.max(0, parseFloat(item.stock_quantity) || 0),
                threshold: parseFloat(item.low_stock_threshold) || 0,
            };
        }
        const trackedSizes = DB.query('menu_sizes', s => s.menuItemId === item.id && s.track_stock);
        if (trackedSizes.length > 0) {
            return {
                qty: trackedSizes.reduce((sum, s) => sum + Math.max(0, parseFloat(s.stock_quantity) || 0), 0),
                threshold: null,
            };
        }
        return null;
    }

    // Remaining units available to sell for a specific item + size combo.
    // Returns null when stock isn't tracked (i.e. unlimited).
    function getStockLimit(itemId, sizeName) {
        const item = DB.getById('menu_items', itemId);
        if (!item) return null;
        if (sizeName) {
            const size = DB.query('menu_sizes', s => s.menuItemId === itemId && s.name === sizeName)[0];
            if (size && size.track_stock) return Math.max(0, parseFloat(size.stock_quantity) || 0);
        }
        if (item.track_stock) return Math.max(0, parseFloat(item.stock_quantity) || 0);
        return null;
    }

    // How many of this item+size are already sitting in the cart (so we
    // don't let the cashier ring up more than what's left in stock across
    // multiple cart lines / quantity bumps).
    function cartQuantityFor(itemId, sizeName, excludeIdx = -1) {
        return cart.reduce((sum, c, i) => {
            if (i === excludeIdx) return sum;
            return sum + (c.itemId === itemId && c.size === sizeName ? c.quantity : 0);
        }, 0);
    }

    function productCard(item) {
        const sizes = DB.query('menu_sizes', s => s.menuItemId === item.id);
        const minPrice = sizes.length ? Math.min(...sizes.map(s => parseFloat(s.price) || 0)) : 0;
        const category = DB.getById('categories', item.categoryId);
        const fav = isFavorite(item.id);

        const stock = stockBadgeFor(item);
        const isOut = !!stock && stock.qty <= 0;
        const isLow = !!stock && stock.threshold != null && stock.qty > 0 && stock.qty <= stock.threshold;

        return `
            <div class="pos-product-card ${isOut ? 'out-of-stock' : ''}" data-item-id="${item.id}" ${isOut ? 'data-out-of-stock="1"' : ''}>
                <div class="pos-product-img">
                    ${App.safeImageUrl(item.image)
                        ? `<img src="${App.safeImageUrl(item.image)}" alt="${App.escapeHtml(item.name)}">`
                        : '🍽'
                    }
                    <button class="pos-favorite-toggle ${fav ? 'active' : ''}" data-fav="${item.id}" title="${fav ? 'Remove from favorites' : 'Add to favorites'}" tabindex="-1">
                        ${fav ? '★' : '☆'}
                    </button>
                </div>
                <div class="pos-product-name" title="${App.escapeHtml(item.name)}">${App.escapeHtml(item.name)}</div>
                <div class="pos-product-price">${App.formatCurrency(minPrice)}</div>
                ${category ? `<div class="pos-product-cat">${App.escapeHtml(category.name)}</div>` : ''}
                ${stock ? `<div class="pos-product-stock ${isOut ? 'out' : isLow ? 'low' : ''}">${isOut ? 'Out of stock' : `${formatStockQty(stock.qty)} ${App.escapeHtml(item.unit || 'pcs')} left`}</div>` : ''}
            </div>
        `;
    }

    function formatStockQty(qty) {
        return Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '');
    }

    function cartItemRow(item, idx) {
        const condText = item.condiments && item.condiments.length > 0
            ? item.condiments.map(c => c.name).join(', ')
            : '';

        const isSelected = idx === selectedCartIndex;

        return `
            <div class="pos-cart-item ${isSelected ? 'selected' : ''}" data-cart-idx="${idx}" tabindex="0" role="button" aria-label="${App.escapeHtml(item.name)}, quantity ${item.quantity}, ${App.formatCurrency(item.lineTotal)}">
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
                        <button class="pos-cart-item-remove" data-remove="${idx}" title="Remove" tabindex="-1">✕</button>
                    </div>
                </div>
                <div class="pos-cart-item-controls">
                    <button class="btn-icon btn-sm" data-qty="-1" data-idx="${idx}" tabindex="-1">−</button>
                    <span class="qty">${item.quantity}</span>
                    <button class="btn-icon btn-sm" data-qty="1" data-idx="${idx}" tabindex="-1">+</button>
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

            const limit = getStockLimit(item.id, sizeName);
            if (limit !== null && cartQuantityFor(item.id, sizeName) + 1 > limit) {
                App.toast(limit <= 0 ? 'This item is out of stock' : `Only ${formatStockQty(limit)} ${item.unit || 'pcs'} left in stock`, 'error');
                return;
            }

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
        updateCartSelection();

        // Sync to customer display
        syncCustomerDisplay();
    }

    // ── Customer Display Sync ─────────────────────────────────────

    // Lazily creates (or recreates, if the store changed) the Realtime
    // broadcast channel used to push live cart updates to any customer-display
    // screen — including ones on a different device, unlike localStorage.
    function getCustomerDisplayChannel(storeId) {
        const workspaceId = DB.getWorkspaceId();
        if (!storeId || !workspaceId) return null;

        const key = `${workspaceId}-${storeId}`;
        if (cdChannel && cdChannelKey === key) return cdChannel;

        const client = Supabase.getClient();
        if (!client) return null;

        if (cdChannel) {
            try { client.removeChannel(cdChannel); } catch (e) { /* ignore */ }
        }

        // Intentionally not subscribing here: the POS only ever sends on this
        // channel, never listens. Per Supabase's docs, calling send() on a
        // channel that hasn't been subscribed automatically routes the
        // message over the HTTP broadcast endpoint instead of WebSocket,
        // which is exactly the fire-and-forget behavior we want.
        cdChannel = client.channel(`cart-sync-${key}`);
        cdChannelKey = key;
        return cdChannel;
    }

    function broadcastToCustomerDisplay(event, payload) {
        const storeId = DB.getCurrentStore();
        const channel = getCustomerDisplayChannel(storeId);
        if (!channel) return;
        Promise.resolve(channel.send({ type: 'broadcast', event, payload: payload || {} }))
            .catch(e => console.warn('[POS] Customer display broadcast failed:', e.message));
    }

    function syncCustomerDisplay() {
        const storeId = DB.getCurrentStore();
        if (!storeId) return;

        const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
        const taxInfo = getActiveTax();
        const taxAmount = taxInfo.enabled ? subtotal * taxInfo.percentage / 100 : 0;
        const total = subtotal + taxAmount;

        const orderData = {
            orderNumber: 'Current Order',
            type: orderType,
            status: cart.length > 0 ? 'Pending' : 'Completed',
            subtotal,
            taxName: taxInfo.name,
            taxPercentage: taxInfo.percentage,
            taxAmount,
            total,
            items: cart.map(item => ({
                name: item.name,
                size: item.size,
                quantity: item.quantity,
                condiments: item.condiments,
                notes: item.notes,
                lineTotal: item.lineTotal,
                unitPrice: item.unitPrice,
            })),
            timestamp: Date.now(),
        };

        // Same-device fallback (instant, works even if Realtime is unreachable).
        try {
            localStorage.setItem(`cd_order_${storeId}`, JSON.stringify(orderData));
        } catch (e) {
            console.warn('[POS] Failed to sync to customer display:', e.message);
        }

        // Cross-device push via Supabase Realtime.
        broadcastToCustomerDisplay('cart_update', orderData);
    }

    function bindCartEvents() {
        // Cart item click for selection
        document.querySelectorAll('.pos-cart-item[data-cart-idx]').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                // Don't select if clicking on buttons
                if (e.target.closest('button')) return;
                const idx = parseInt(itemEl.dataset.cartIdx);
                selectedCartIndex = idx === selectedCartIndex ? -1 : idx;
                updateCartSelection();
            });
        });

        // Quantity buttons
        document.querySelectorAll('[data-qty]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                const delta = parseInt(btn.dataset.qty);
                const ci = cart[idx];
                if (delta > 0) {
                    const limit = getStockLimit(ci.itemId, ci.size);
                    if (limit !== null && cartQuantityFor(ci.itemId, ci.size, idx) + ci.quantity + delta > limit) {
                        App.toast(`Only ${formatStockQty(limit)} ${DB.getById('menu_items', ci.itemId)?.unit || 'pcs'} left in stock`, 'error');
                        return;
                    }
                }
                ci.quantity = Math.max(1, ci.quantity + delta);
                ci.lineTotal = ci.unitPrice * ci.quantity;
                updateCart();
            });
        });

        // Remove buttons
        document.querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.remove);
                cart.splice(idx, 1);
                selectedCartIndex = Math.min(selectedCartIndex, cart.length - 1);
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

        // Final stock guard: catch anything that went stale since items were
        // added (e.g. someone else sold the last of it, or a manual stock
        // adjustment happened) before we commit the sale.
        for (const ci of cart) {
            const limit = getStockLimit(ci.itemId, ci.size);
            if (limit !== null && ci.quantity > limit) {
                const itemName = DB.getById('menu_items', ci.itemId)?.name || ci.name;
                App.toast(`Not enough stock for ${itemName} — only ${formatStockQty(limit)} left. Adjust the quantity and try again.`, 'error');
                return;
            }
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

        // Deduct sold quantities from stock immediately so remaining counts
        // reflect the sale in real time (item- or size-level, whichever is tracked).
        cart.forEach(item => deductStockForSale(item, order, user));

        // Show completed status on customer display
        showCompletedOnCustomerDisplay(orderNumber, total);

        // Show receipt
        Receipt.show(order);

        // Clear cart
        cart = [];
        // Full re-render (not just updateCart) so the product grid picks up
        // the freshly deducted stock numbers / out-of-stock states.
        render();
        App.toast(`Order #${orderNumber} completed!`);
    }

    // Deducts a cart line's quantity from stock (size-level takes priority
    // over item-level, mirroring how stock is tracked in Stock & Inventory),
    // and logs a 'sale' stock movement for the audit trail. No-ops for
    // items/sizes that don't have stock tracking enabled.
    function deductStockForSale(cartItem, order, user) {
        const item = DB.getById('menu_items', cartItem.itemId);
        if (!item) return;

        const size = cartItem.size
            ? DB.query('menu_sizes', s => s.menuItemId === item.id && s.name === cartItem.size)[0]
            : null;

        let menuItemId = item.id;
        let menuSizeId = null;
        let prevQty, newQty;

        if (size && size.track_stock) {
            prevQty = parseFloat(size.stock_quantity) || 0;
            newQty = Math.max(0, prevQty - cartItem.quantity);
            DB.update('menu_sizes', size.id, { stock_quantity: newQty });
            menuSizeId = size.id;
        } else if (item.track_stock) {
            prevQty = parseFloat(item.stock_quantity) || 0;
            newQty = Math.max(0, prevQty - cartItem.quantity);
            DB.update('menu_items', item.id, { stock_quantity: newQty });
        } else {
            return; // stock not tracked for this item/size — nothing to deduct
        }

        DB.insert('stock_movements', {
            menuItemId,
            menuSizeId,
            movementType: 'sale',
            quantityChange: -(prevQty - newQty),
            previousQuantity: prevQty,
            newQuantity: newQty,
            referenceId: order.id,
            referenceType: 'order',
            notes: `Auto-deducted from order #${order.orderNumber}`,
            userId: user.id,
            userName: user.name,
        });
    }

    // ── Split Bill ─────────────────────────────────────────────
    function openSplitBillModal() {
        if (cart.length === 0) {
            App.toast('Cart is empty', 'error');
            return;
        }

        const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
        const taxInfo = getActiveTax();
        const taxAmount = taxInfo.enabled ? subtotal * taxInfo.percentage / 100 : 0;
        const total = subtotal + taxAmount;

        App.openModal(`
            <div class="modal-header">
                <h3>✂️ Split Bill</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p class="text-muted" style="margin-bottom:16px;">Divide items into separate bills. Click items to assign them to each split.</p>

                <div style="margin-bottom:16px;padding:12px;background:var(--bg);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                        <span><strong>Current Total:</strong></span>
                        <span><strong>${App.formatCurrency(total)}</strong></span>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <span class="badge badge-info">Subtotal: ${App.formatCurrency(subtotal)}</span>
                        ${taxInfo.enabled ? `<span class="badge badge-gray">${taxInfo.name}: ${App.formatCurrency(taxAmount)}</span>` : ''}
                    </div>
                </div>

                <div class="form-group">
                    <label>Number of Splits</label>
                    <select class="form-control" id="splitCount" style="width:120px;">
                        <option value="2">2 Bills</option>
                        <option value="3">3 Bills</option>
                        <option value="4">4 Bills</option>
                        <option value="5">5 Bills</option>
                    </select>
                </div>

                <h4 style="margin:16px 0 12px;">Assign Items to Each Split</h4>
                <div id="splitBillsContainer"></div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnConfirmSplit">Confirm & Pay</button>
            </div>
        `);

        document.getElementById('splitCount').addEventListener('change', (e) => {
            renderSplitBills(parseInt(e.target.value));
        });

        renderSplitBills(2);

        document.getElementById('btnConfirmSplit').addEventListener('click', () => {
            confirmSplitBill();
        });
    }

    function renderSplitBills(numSplits) {
        const container = document.getElementById('splitBillsContainer');
        if (!container) return;

        // Initialize assignments if not exists
        if (!window.splitBillAssignments || window.splitBillAssignments.length !== cart.length) {
            window.splitBillAssignments = cart.map(() => 0); // 0 = unassigned
        }

        const taxInfo = getActiveTax();

        let html = '';
        for (let i = 0; i < numSplits; i++) {
            const assignedItems = cart.filter((item, idx) => window.splitBillAssignments[idx] === i + 1);
            const splitSubtotal = assignedItems.reduce((sum, item) => sum + item.lineTotal, 0);
            const splitTax = taxInfo.enabled ? splitSubtotal * taxInfo.percentage / 100 : 0;
            const splitTotal = splitSubtotal + splitTax;

            html += `
                <div class="split-bill-card" style="margin-bottom:16px;padding:12px;border:1px solid var(--border);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <h5 style="margin:0;">Split ${i + 1}</h5>
                        <span style="font-weight:700;color:var(--primary);">${App.formatCurrency(splitTotal)}</span>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;min-height:40px;padding:8px;background:var(--bg);border-radius:4px;">
                        ${assignedItems.length > 0
                            ? assignedItems.map((item, idx) => {
                                const cartIdx = cart.findIndex(c => c === item);
                                return `<span class="badge badge-primary" style="cursor:pointer;" data-split="${i + 1}" data-cart-idx="${cartIdx}">${App.escapeHtml(item.name)} (${item.quantity}x) - ${App.formatCurrency(item.lineTotal)}</span>`;
                            }).join('')
                            : '<span class="text-muted" style="font-size:0.85rem;">Click items below to assign to this split</span>'
                        }
                    </div>
                </div>
            `;
        }

        // Unassigned items section
        const unassignedItems = cart.filter((item, idx) => window.splitBillAssignments[idx] === 0);
        html += `
            <div style="margin-top:16px;padding:12px;background:#fff7ed;border:1px solid #fde68a;border-radius:8px;">
                <h5 style="margin:0 0 8px;color:#92400e;">Unassigned Items</h5>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${unassignedItems.map((item, idx) => {
                        const cartIdx = cart.findIndex(c => c === item);
                        return `<span class="badge badge-warning" style="cursor:pointer;" data-split="0" data-cart-idx="${cartIdx}">${App.escapeHtml(item.name)} (${item.quantity}x) - ${App.formatCurrency(item.lineTotal)}</span>`;
                    }).join('') || '<span class="text-muted" style="font-size:0.85rem;">All items assigned ✓</span>'}
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Bind click events to reassign items
        container.querySelectorAll('[data-cart-idx]').forEach(badge => {
            badge.addEventListener('click', () => {
                const cartIdx = parseInt(badge.dataset.cartIdx);
                const currentSplit = window.splitBillAssignments[cartIdx];
                const numSplits = parseInt(document.getElementById('splitCount').value);
                // Cycle through splits: 0 -> 1 -> 2 -> ... -> numSplits -> 0
                const newSplit = (currentSplit + 1) % (numSplits + 1);
                window.splitBillAssignments[cartIdx] = newSplit;
                renderSplitBills(numSplits);
            });
        });
    }

    async function confirmSplitBill() {
        const numSplits = parseInt(document.getElementById('splitCount').value);
        const user = Auth.currentUser();
        const openShift = Shifts.getOpenShift(user.id);

        if (user.role === 'cashier' && !openShift) {
            App.toast('Start your shift before taking orders', 'error');
            return;
        }

        // Check all items are assigned
        const unassigned = window.splitBillAssignments.filter(a => a === 0).length;
        if (unassigned > 0) {
            App.toast(`${unassigned} item(s) not assigned to any split`, 'error');
            return;
        }

        const taxInfo = getActiveTax();

        // Create orders for each split
        const createdOrders = [];
        for (let i = 0; i < numSplits; i++) {
            const assignedItems = cart.filter((item, idx) => window.splitBillAssignments[idx] === i + 1);
            if (assignedItems.length === 0) continue;

            const orderNumber = DB.nextOrderNumber();
            const subtotal = assignedItems.reduce((sum, item) => sum + item.lineTotal, 0);
            const taxAmount = taxInfo.enabled ? subtotal * taxInfo.percentage / 100 : 0;
            const total = subtotal + taxAmount;

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
                splitFrom: `split_${Date.now()}`,
            });

            assignedItems.forEach(item => {
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

            createdOrders.push(order);
        }

        App.closeModal();
        cart = [];
        window.splitBillAssignments = [];
        updateCart();

        App.toast(`${createdOrders.length} orders created from split bill`);

        // Show receipt for the first order
        if (createdOrders.length > 0) {
            Receipt.show(createdOrders[0]);
        }
    }

    function showCompletedOnCustomerDisplay(orderNumber, total) {
        const storeId = DB.getCurrentStore();
        if (!storeId) return;

        const orderData = {
            orderNumber,
            type: orderType,
            status: 'Completed',
            subtotal: 0,
            taxName: '',
            taxPercentage: 0,
            taxAmount: 0,
            total,
            items: [],
            timestamp: Date.now(),
        };

        try {
            localStorage.setItem(`cd_order_${storeId}`, JSON.stringify(orderData));
            // Clear after 5 seconds
            setTimeout(() => {
                localStorage.removeItem(`cd_order_${storeId}`);
                broadcastToCustomerDisplay('cart_clear', {});
            }, 5000);
        } catch (e) {
            console.warn('[POS] Failed to show completion on customer display:', e.message);
        }

        broadcastToCustomerDisplay('cart_update', orderData);
    }

    // ── Bind Events ────────────────────────────────────────────
    function bindEvents() {
        // Product clicks
        document.querySelectorAll('.pos-product-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // Don't open modal if clicking on favorite toggle
                if (e.target.closest('.pos-favorite-toggle')) return;
                if (card.dataset.outOfStock) {
                    App.toast('This item is out of stock', 'error');
                    return;
                }
                openItemModal(card.dataset.itemId);
            });
        });

        // Favorite toggle on product cards
        document.querySelectorAll('.pos-favorite-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.fav;
                toggleFavorite(itemId);
                btn.classList.toggle('active');
                btn.textContent = btn.classList.contains('active') ? '★' : '☆';
                btn.title = btn.classList.contains('active') ? 'Remove from favorites' : 'Add to favorites';
                // Re-render favorites bar
                const favBar = document.querySelector('.pos-favorites-bar');
                if (favBar) {
                    favBar.outerHTML = renderFavoritesBar();
                    bindFavoriteEvents();
                }
            });
        });

        // Favorite items in favorites bar (one-tap add to cart)
        bindFavoriteEvents();

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
                    card.addEventListener('click', (e) => {
                        if (e.target.closest('.pos-favorite-toggle')) return;
                        if (card.dataset.outOfStock) {
                            App.toast('This item is out of stock', 'error');
                            return;
                        }
                        openItemModal(card.dataset.itemId);
                    });
                });
                // Rebind favorite toggles
                document.querySelectorAll('.pos-favorite-toggle').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const itemId = btn.dataset.fav;
                        toggleFavorite(itemId);
                        btn.classList.toggle('active');
                        btn.textContent = btn.classList.contains('active') ? '★' : '☆';
                        btn.title = btn.classList.contains('active') ? 'Remove from favorites' : 'Add to favorites';
                        const favBar = document.querySelector('.pos-favorites-bar');
                        if (favBar) {
                            favBar.outerHTML = renderFavoritesBar();
                            bindFavoriteEvents();
                        }
                    });
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

        // Split bill
        document.getElementById('btnSplitBill').addEventListener('click', openSplitBillModal);

        // Shift bar buttons
        const startShiftBtn = document.querySelector('[data-action="pos-start-shift"]');
        if (startShiftBtn) {
            startShiftBtn.addEventListener('click', openStartShiftModal);
        }
        const endShiftBtn = document.querySelector('[data-action="pos-end-shift"]');
        if (endShiftBtn) {
            endShiftBtn.addEventListener('click', openEndShiftModal);
        }
        document.querySelectorAll('[data-action="pos-start-break"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const user = Auth.currentUser();
                const openShift = Shifts.getOpenShift(user.id);
                if (!openShift) return;
                const result = Shifts.startBreak(openShift.id, btn.dataset.type);
                if (result.ok) {
                    render();
                } else {
                    App.toast(result.message, 'error');
                }
            });
        });
        const endBreakBtn = document.querySelector('[data-action="pos-end-break"]');
        if (endBreakBtn) {
            endBreakBtn.addEventListener('click', () => {
                const result = Shifts.endBreak(endBreakBtn.dataset.breakId);
                if (result.ok) {
                    render();
                } else {
                    App.toast(result.message, 'error');
                }
            });
        }
        const shiftNotesBtn = document.querySelector('[data-action="pos-shift-notes"]');
        if (shiftNotesBtn) {
            shiftNotesBtn.addEventListener('click', () => {
                const user = Auth.currentUser();
                const openShift = Shifts.getOpenShift(user.id);
                if (openShift) Shifts.openShiftNotesModal(openShift);
            });
        }

        // Bind cart events
        bindCartEvents();
    }

    function bindFavoriteEvents() {
        // Favorite items in favorites bar - one tap to add to cart
        document.querySelectorAll('.pos-favorite-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                if (e.target.closest('.pos-favorite-remove')) return;
                const itemId = itemEl.dataset.itemId;
                quickAddToCart(itemId);
            });
        });

        // Remove from favorites
        document.querySelectorAll('.pos-favorite-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.removeFav;
                toggleFavorite(itemId);
                const favBar = document.querySelector('.pos-favorites-bar');
                if (favBar) {
                    favBar.outerHTML = renderFavoritesBar();
                    bindFavoriteEvents();
                }
                // Also update product card favorite toggle
                document.querySelectorAll(`.pos-favorite-toggle[data-fav="${itemId}"]`).forEach(toggle => {
                    toggle.classList.remove('active');
                    toggle.textContent = '☆';
                    toggle.title = 'Add to favorites';
                });
            });
        });

        // Show favorites help
        const helpBtn = document.querySelector('[data-action="show-favorites-help"]');
        if (helpBtn) {
            helpBtn.addEventListener('click', showFavoritesHelp);
        }
    }

    function quickAddToCart(itemId) {
        const user = Auth.currentUser();
        if (user.role === 'cashier' && !Shifts.getOpenShift(user.id)) {
            App.toast('Start your shift before taking orders', 'error');
            return;
        }

        const item = DB.getById('menu_items', itemId);
        if (!item) return;

        const sizes = DB.query('menu_sizes', s => s.menuItemId === itemId);
        const selectedSize = sizes.length > 0 ? sizes[0] : null;

        const sizeName = selectedSize ? selectedSize.name : '';
        const sizePrice = selectedSize ? parseFloat(selectedSize.price) || 0 : 0;
        const unitPrice = sizePrice;
        const lineTotal = unitPrice;

        const limit = getStockLimit(itemId, sizeName);
        if (limit !== null && cartQuantityFor(itemId, sizeName) + 1 > limit) {
            App.toast(limit <= 0 ? 'This item is out of stock' : `Only ${formatStockQty(limit)} ${item.unit || 'pcs'} left in stock`, 'error');
            return;
        }

        cart.push({
            itemId: item.id,
            name: item.name,
            size: sizeName,
            sizePrice: sizePrice,
            quantity: 1,
            condiments: [],
            notes: '',
            unitPrice: unitPrice,
            lineTotal: lineTotal,
        });

        updateCart();
        App.toast(`${item.name} added to order`);
    }

    function showFavoritesHelp() {
        App.openModal(`
            <div class="modal-header">
                <h3>★ Quick-Add Favorites</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom:16px;color:var(--text-secondary);">Speed up your workflow by pinning your top-selling items for one-tap access.</p>
                <ul style="display:grid;gap:12px;">
                    <li style="display:flex;align-items:flex-start;gap:12px;">
                        <span style="background:var(--primary-50);color:var(--primary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;">1</span>
                        <div><strong>Click the star (☆)</strong> on any menu item to add it to favorites</div>
                    </li>
                    <li style="display:flex;align-items:flex-start;gap:12px;">
                        <span style="background:var(--primary-50);color:var(--primary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;">2</span>
                        <div><strong>Tap a favorite item</strong> in the bar above to instantly add it to the cart</div>
                    </li>
                    <li style="display:flex;align-items:flex-start;gap:12px;">
                        <span style="background:var(--primary-50);color:var(--primary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;">3</span>
                        <div><strong>Click ✕</strong> on a favorite to remove it</div>
                    </li>
                    <li style="display:flex;align-items:flex-start;gap:12px;">
                        <span style="background:var(--primary-50);color:var(--primary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;">4</span>
                        <div><strong>Max 10 favorites</strong> — pick your best sellers!</div>
                    </li>
                </ul>
                <p style="margin-top:16px;font-size:0.85rem;color:var(--text-muted);">
                    Favorites are saved per browser/device. Each cashier can have their own favorites.
                </p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" onclick="App.closeModal()">Got it</button>
            </div>
        `);
    }

    return {
        render,
        destroyKeyboardShortcuts,
        initKeyboardShortcuts
    };
})();
