/**
 * App – Main controller: routing, sidebar, modals, toasts, helpers
 */
const App = (() => {
    let currentPage = 'dashboard';

    // ── Helpers ────────────────────────────────────────────────
    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

    function formatCurrency(amount) {
        const symbol = DB.getSetting('currency_symbol') || '$';
        return symbol + parseFloat(amount || 0).toFixed(2);
    }

    function formatDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function formatDateTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // HTML-escape for BOTH text-node and attribute contexts. Escaping quotes as
    // well means any `value="..."` / `title="..."` / data-* interpolation in the
    // templates is safe against attribute-injection (stored XSS). Harmless in
    // text nodes (the browser decodes &quot; back to ").
    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Whitelist an image src: only inline image data-URLs and http(s) URLs.
    // Anything else (javascript:, data:text/html, svg data-URLs) is dropped so a
    // tampered menu_items.image can't break out of the attribute or load a
    // script-bearing document.
    function safeImageUrl(src) {
        if (!src) return '';
        const s = String(src);
        if (/^https?:\/\//i.test(s)) return s;
        if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(s)) return s;
        return '';
    }

    // ── Toast ──────────────────────────────────────────────────
    function toast(message, type = 'success') {
        const container = $('#toastContainer');
        const el = document.createElement('div');
        el.className = 'toast' + (type !== 'success' ? ' ' + type : '');
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => { el.remove(); }, 3000);
    }

    // ── Modal ──────────────────────────────────────────────────
    function openModal(html) {
        const backdrop = $('#modalBackdrop');
        const content = $('#modalContent');
        content.innerHTML = html;
        backdrop.classList.add('show');
    }

    function closeModal() {
        $('#modalBackdrop').classList.remove('show');
    }

    // ── Subscription ───────────────────────────────────────────
    let subscription = null;

    // Accepts the get_my_billing RPC snapshot ({ status, period_end }) or a
    // profiles row (subscription_status / current_period_end) as a fallback.
    function setSubscription(b) {
        if (!b) { subscription = null; return; }
        subscription = {
            status: b.status || b.subscription_status || 'never',
            periodEnd: b.period_end || b.current_period_end || null,
        };
    }

    function subscriptionActive() {
        if (!subscription) return false;
        if (subscription.status !== 'active') return false;
        if (subscription.periodEnd) {
            return new Date(subscription.periodEnd).getTime() > Date.now();
        }
        return true;
    }

    // ── Confirm Dialog ─────────────────────────────────────────
    let confirmResolve = null;

    function confirm(title, text, okLabel = 'Delete') {
        return new Promise(resolve => {
            confirmResolve = resolve;
            $('#confirmTitle').textContent = title;
            $('#confirmText').textContent = text;
            $('#confirmOk').textContent = okLabel;
            $('#confirmBackdrop').classList.add('show');
        });
    }

    // ── Routing ────────────────────────────────────────────────
    const pageTitles = {
        dashboard: 'Dashboard',
        pos: 'POS Screen',
        staff: 'Staff Management',
        categories: 'Categories',
        menu: 'Menu Items',
        bundles: 'Bundles / Combos',
        condiments: 'Condiments',
        tax: 'Tax Setup',
        stock: 'Stock & Inventory',
        orders: 'Order History',
        reports: 'Sales Reports',
        shifts: 'Shift Management',
        schedules: 'Shift Schedules',
        payroll: 'Payroll',
        leaderboards: 'Leaderboards',
        multistore: 'Multi-Store Reports',
        billing: 'Billing & Subscription',
        settings: 'Settings',
    };

    function navigateTo(page) {
        // Subscription gate: without an active plan, only the billing page is reachable.
        if (page !== 'billing' && !subscriptionActive()) {
            page = 'billing';
        }
        currentPage = page;

        // Update sidebar active
        $$('.sidebar-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });

        // Show/hide modules
        $$('.page-module').forEach(mod => {
            mod.classList.toggle('active', mod.id === 'page-' + page);
        });

        // Update title
        $('#pageTitle').textContent = pageTitles[page] || page;

        // Clear header actions
        $('#headerActions').innerHTML = '';
        renderStoreSwitcher();

        // Call module init
        switch (page) {
            case 'dashboard':
                POS.destroyKeyboardShortcuts?.();
                Dashboard.render();
                break;
            case 'pos':
                POS.render();
                break;
            case 'staff':
                POS.destroyKeyboardShortcuts?.();
                Staff.render();
                break;
            case 'categories':
                POS.destroyKeyboardShortcuts?.();
                Categories.render();
                break;
            case 'menu':
                POS.destroyKeyboardShortcuts?.();
                Menu.render();
                break;
            case 'bundles':
                POS.destroyKeyboardShortcuts?.();
                Bundles.render();
                break;
            case 'condiments':
                POS.destroyKeyboardShortcuts?.();
                Condiments.render();
                break;
            case 'tax':
                POS.destroyKeyboardShortcuts?.();
                Tax.render();
                break;
            case 'orders':
                POS.destroyKeyboardShortcuts?.();
                Orders.render();
                break;
            case 'reports':
                POS.destroyKeyboardShortcuts?.();
                RecipeCost.render();
                break;
            case 'shifts':
                POS.destroyKeyboardShortcuts?.();
                Shifts.render();
                break;
            case 'schedules':
                POS.destroyKeyboardShortcuts?.();
                Schedules.render();
                break;
            case 'payroll':
                POS.destroyKeyboardShortcuts?.();
                Payroll.render();
                break;
            case 'leaderboards':
                POS.destroyKeyboardShortcuts?.();
                Leaderboards.render();
                break;
            case 'multistore':
                POS.destroyKeyboardShortcuts?.();
                MultiStoreReports.render();
                break;
            case 'billing':
                POS.destroyKeyboardShortcuts?.();
                Billing.render();
                break;
            case 'settings':
                POS.destroyKeyboardShortcuts?.();
                App.renderSettings();
                break;
            case 'stock':
                POS.destroyKeyboardShortcuts?.();
                Stock.render();
                break;
        }

        // Close mobile sidebar
        $('#sidebar').classList.remove('open');
    }

    function refreshCurrentPage() {
        navigateTo(currentPage);
    }

    // Render the store switcher in header actions (only if user has >1 assigned store)
    // Render the store switcher in header actions (only if user has >1 assigned store)
    async function renderStoreSwitcher() {
        const headerActions = $('#headerActions');
        if (!headerActions) return;

        // navigateTo() wipes #headerActions.innerHTML on every page change, so
        // the static #storeSwitcher markup from app.html gets deleted along
        // with it. Recreate it here instead of assuming it still exists.
        let container = $('#storeSwitcher');
        if (!container) {
            container = document.createElement('div');
            container.className = 'store-switcher';
            container.id = 'storeSwitcher';
            container.style.display = 'none';
            container.innerHTML = `
                <span class="store-switcher-label">🏪 Store</span>
                <select id="storeSelect" class="form-control form-control-sm" title="Switch store">
                    <option value="">Select Store…</option>
                </select>
            `;
            headerActions.appendChild(container);
        }
        const select = $('#storeSelect', container);

        const assigned = DB.getAssignedStores();
        if (assigned.length <= 1) {
            container.style.display = 'none';
            return;
        }

        // Load all workspace stores (admin) or just assigned (cashier)
        let stores = [];
        if (Auth.isAdmin()) {
            try {
                stores = await DB.loadAllWorkspaceStores();
            } catch (e) {
                console.warn('loadAllWorkspaceStores:', e.message);
                stores = [];
            }
        } else {
            // For cashiers, we only have store IDs; fetch names
            for (const sid of assigned) {
                try {
                    const client = Supabase.getClient();
                    const { data } = await client
                        .from('stores')
                        .select('id, name')
                        .eq('id', sid)
                        .single();
                    if (data) stores.push({ id: data.id, name: data.name });
                } catch {}
            }
        }

        if (!stores.length) {
            container.style.display = 'none';
            return;
        }

        const current = DB.getCurrentStore();
        select.innerHTML = stores.map(s =>
            `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${s.name}</option>`
        ).join('');
        container.style.display = 'flex';

        // Bind change event (only once per element — a fresh element is
        // created each nav, so this always re-binds cleanly, no duplicates)
        if (!select.dataset.bound) {
            select.addEventListener('change', async () => {
                const storeId = select.value;
                if (!storeId || storeId === current) return;
                try {
                    await DB.setCurrentStore(storeId);
                    toast(`Switched to ${select.options[select.selectedIndex].text}`);
                } catch (err) {
                    toast(err.message || 'Failed to switch store', 'error');
                    renderStoreSwitcher(); // Reset dropdown
                }
            });
            select.dataset.bound = 'true';
        }
    }

    // ── Settings Page ──────────────────────────────────────────
    function renderSettings() {
        const el = $('#page-settings');
        const name = DB.getSetting('restaurant_name') || '';
        const address = DB.getSetting('restaurant_address') || '';
        const phone = DB.getSetting('restaurant_phone') || '';
        const currency = DB.getSetting('currency_symbol') || '$';

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Restaurant Settings</h3>
                </div>
                <div class="card-body">
                    <div class="settings-grid">
                        <div>
                            <div class="form-group">
                                <label>Restaurant Name</label>
                                <input type="text" class="form-control" id="settName" value="${escapeHtml(name)}">
                            </div>
                            <div class="form-group">
                                <label>Address</label>
                                <input type="text" class="form-control" id="settAddress" value="${escapeHtml(address)}">
                            </div>
                            <div class="form-group">
                                <label>Phone</label>
                                <input type="text" class="form-control" id="settPhone" value="${escapeHtml(phone)}">
                            </div>
                            <div class="form-group">
                                <label>Currency Symbol</label>
                                <input type="text" class="form-control" id="settCurrency" value="${escapeHtml(currency)}" style="width:80px">
                            </div>
                            <button class="btn btn-primary" id="btnSaveSettings">Save Settings</button>
                        </div>
                        <div>
                            <div class="card" style="border:2px solid var(--danger);">
                                <div class="card-header">
                                    <h3 style="color:var(--danger)">Danger Zone</h3>
                                </div>
                                <div class="card-body">
                                    <p class="text-muted" style="margin-bottom:16px;"><strong>Clear Order & Shift History</strong> — deletes all orders, shifts, and payroll runs to refresh your data. Your staff, menu, categories, tax, schedules, and settings are kept.</p>
                                    <button class="btn btn-outline btn-danger" id="btnClearHistory" style="margin-right:8px;">🗑 Clear Order & Shift History</button>
                                    <button class="btn btn-danger" id="btnResetData">Reset All Data</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            ${Auth.isAdmin() ? `
            <div class="card" style="margin-top:24px;">
                <div class="card-header">
                    <h3>🏪 Store Management</h3>
                    <span class="badge badge-info">Multi-store</span>
                </div>
                <div class="card-body">
                    <div class="settings-grid" style="margin-bottom:24px;">
                        <div>
                            <h4 style="margin-bottom:12px;">Your Stores</h4>
                            <div id="storeList"></div>
                            <button class="btn btn-outline btn-sm" id="btnAddStore" style="margin-top:12px;">+ Add Store</button>
                        </div>
                        <div>
                            <h4 style="margin-bottom:12px;">Staff Assignments</h4>
                            <div id="storeAssignments"></div>
                        </div>
                    </div>
                </div>
            </div>
            ` : ''}
        `;

        $('#btnSaveSettings').addEventListener('click', () => {
            DB.setSetting('restaurant_name', $('#settName').value.trim());
            DB.setSetting('restaurant_address', $('#settAddress').value.trim());
            DB.setSetting('restaurant_phone', $('#settPhone').value.trim());
            DB.setSetting('currency_symbol', $('#settCurrency').value.trim() || '$');
            DB.logAction('settings_update', 'settings', null, {
                restaurant_name: $('#settName').value.trim(),
                restaurant_address: $('#settAddress').value.trim(),
                restaurant_phone: $('#settPhone').value.trim(),
                currency_symbol: $('#settCurrency').value.trim() || '$',
            });
            toast('Settings saved successfully');
        });

        $('#btnResetData').addEventListener('click', async () => {
            const yes = await App.confirm('Reset All Data?', 'This will permanently delete all your data and restore defaults.', 'Reset');
            if (yes) {
                DB.logAction('settings_reset_all', 'settings', null, {});
                DB.resetAll();
                toast('All data has been reset');
                navigateTo('dashboard');
            }
        });

        $('#btnClearHistory').addEventListener('click', async () => {
            const yes = await App.confirm('Clear Order & Shift History?', 'This will delete all orders, shifts, and payroll runs. Your staff, menu, tax, schedules, and settings will be kept.', 'Clear History');
            if (yes) {
                DB.logAction('history_clear', null, null, {
                    orders: DB.count('orders'),
                    shifts: DB.count('shifts'),
                    payrolls: DB.count('payrolls'),
                });
                DB.clear('orders');
                DB.clear('order_items');
                DB.clear('shifts');
                DB.clear('payrolls');
                toast('Order & shift history cleared');
                navigateTo('dashboard');
            }
        });

        // ── Store Management (admin only) ──────────────────────────
        if (Auth.isAdmin()) {
            renderStoreList();
            renderStoreAssignments();
        }
    }

    // ── Store Management UI ───────────────────────────────────────
    async function renderStoreList() {
        const container = $('#storeList');
        if (!container) return;

        const stores = await DB.loadAllWorkspaceStores();
        const currentStore = DB.getCurrentStore();

        container.innerHTML = stores.map(s => `
            <div class="store-row" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:10px;">
                    <input type="text" class="form-control store-name-input" data-id="${s.id}" value="${escapeHtml(s.name)}" style="width:180px;" ${s.id === 's1' ? 'readonly' : ''}>
                    ${s.id === 's1' ? '<span class="badge badge-info" style="font-size:0.7rem;">Default</span>' : ''}
                    ${s.id === currentStore ? '<span class="badge badge-success" style="font-size:0.7rem;">Active</span>' : ''}
                    ${!s.enabled ? '<span class="badge badge-warning" style="font-size:0.7rem;">Disabled</span>' : ''}
                </div>
                <div style="display:flex;gap:6px;">
                    <button class="btn btn-outline btn-sm store-save-btn" data-id="${s.id}" style="display:none;">Save</button>
                    ${s.id !== 's1' ? `<button class="btn btn-ghost btn-sm store-delete-btn" data-id="${s.id}" style="color:var(--danger);">🗑</button>` : ''}
                </div>
            </div>
        `).join('');

        // Bind name change detection
        container.querySelectorAll('.store-name-input').forEach(input => {
            input.addEventListener('input', () => {
                const saveBtn = container.querySelector(`.store-save-btn[data-id="${input.dataset.id}"]`);
                if (saveBtn) saveBtn.style.display = 'inline-flex';
            });
        });

        // Bind save
        container.querySelectorAll('.store-save-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const nameInput = container.querySelector(`.store-name-input[data-id="${id}"]`);
                const name = nameInput.value.trim();
                if (!name) { toast('Store name required', 'error'); return; }
             try {
                    await DB.upsertStore({ id, name });
                    await DB.refreshAssignedStores();
                    toast('Store saved');
                    renderStoreList();
                    renderStoreSwitcher();
                } catch (err) {
                    toast(err.message || 'Failed to save store', 'error');
                }
            });
        });

        // Bind delete
        container.querySelectorAll('.store-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const yes = await App.confirm('Delete Store?', `Delete this store and all its data? This cannot be undone.`, 'Delete');
                if (!yes) return;
                               try {
                    await DB.deleteStore(id);
                    await DB.refreshAssignedStores();
                    toast('Store deleted');
                    renderStoreList();
                    renderStoreSwitcher();
                } catch (err) {
                    toast(err.message || 'Failed to delete store', 'error');
                }
            });
        });

        // Add new store
        $('#btnAddStore')?.addEventListener('click', async () => {
            const name = prompt('New store name:');
            if (!name) return;
            const id = 's' + Date.now().toString(36);
                        try {
                await DB.upsertStore({ id, name });
                await DB.refreshAssignedStores();
                toast('Store created');
                renderStoreList();
                renderStoreSwitcher();
            } catch (err) {
                toast(err.message || 'Failed to create store', 'error');
            }
        });
    }

    async function renderStoreAssignments() {
        const container = $('#storeAssignments');
        if (!container) return;

        const stores = await DB.loadAllWorkspaceStores();
        const users = DB.getAll('users').filter(u => u.enabled !== false);

        // Pre-fetch assignments for all users
        const userAssignments = {};
        for (const u of users) {
            userAssignments[u.id] = await DB.getUserStoreAssignments(u.id);
        }

        // Build assignment matrix
        let html = '<div style="overflow-x:auto;"><table class="table-container"><thead><tr><th>Staff</th><th>Role</th>';
        stores.forEach(s => { html += `<th style="text-align:center;width:80px;">${escapeHtml(s.name)}</th>`; });
        html += '</tr></thead><tbody>';

        users.forEach(u => {
            const isAdmin = u.role === 'admin';
            html += `<tr><td><strong>${escapeHtml(u.name)}</strong></td><td><span class="badge ${isAdmin ? 'badge-primary' : 'badge-success'}">${isAdmin ? 'Admin' : 'Cashier'}</span></td>`;
            stores.forEach(s => {
                const assigned = isAdmin || userAssignments[u.id]?.includes(s.id);
                html += `<td style="text-align:center;">
                    <input type="checkbox" class="assign-checkbox" data-user="${u.id}" data-store="${s.id}" ${assigned ? 'checked' : ''} ${isAdmin ? 'disabled' : ''}>
                    ${isAdmin ? '<span class="text-muted" style="font-size:0.75rem;">(admin)</span>' : ''}
                </td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

        // Bind checkbox changes
        container.querySelectorAll('.assign-checkbox').forEach(cb => {
            cb.addEventListener('change', async () => {
                const userId = cb.dataset.user;
                const storeId = cb.dataset.store;
                               try {
                    if (cb.checked) {
                        await DB.assignUserToStore(userId, storeId);
                        await DB.refreshAssignedStores();
                        toast('Assigned');
                    } else {
                        await DB.unassignUserFromStore(userId, storeId);
                        await DB.refreshAssignedStores();
                        toast('Unassigned');
                    }
                } catch (err) {
                    toast(err.message || 'Failed', 'error');
                    cb.checked = !cb.checked; // revert
                }
            });
        });
    }

    // ── User UI ─────────────────────────────────────────────────
    function updateUserUI() {
        const user = Auth.currentUser();
        if (!user) return;
        $('#userName').textContent = user.name;
        $('#userRole').textContent = user.role === 'admin' ? 'Admin' : 'Cashier';
        $('#userAvatar').textContent = user.name.charAt(0).toUpperCase();

        // Show/hide admin elements. UI-only gating — real enforcement is RLS
        // (migration 003) keyed to the signed-in account, not this marker.
        $$('.admin-only').forEach(el => el.style.display = Auth.isAdmin() ? '' : 'none');
        $$('.super-admin-only').forEach(el => el.style.display = Auth.isSuperAdmin() ? '' : 'none');
    }

    // ── Init ───────────────────────────────────────────────────
    async function init() {
        Supabase.init();

        const session = await Supabase.getSession();
        if (!session) { window.location.href = 'login.html'; return; }

        try {
            await DB.init();
        } catch (err) {
            console.error(err);
            alert('Could not load your workspace. Check your connection and reload.');
            return;
        }

        const { profile } = await Supabase.getProfile();
        await Auth.setSession(profile);

        // Subscription belongs to the workspace (the owner's profile), so a
        // cashier must see the business's billing — not their own stub profile.
        const client = Supabase.getClient();
        const { data: billing } = client ? await client.rpc('get_my_billing') : { data: null };
        setSubscription(billing || profile);

        if (!Auth.requireAuth()) return;

        updateUserUI();

        // Sidebar navigation (href links like the Admin Dashboard are external pages)
        $$('.sidebar-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                if (href) { window.location.href = href; return; }
                navigateTo(link.dataset.page);
            });
        });

        // Logout
        $('#btnLogout').addEventListener('click', () => Auth.logout());

        // Modal close
        $('#modalBackdrop').addEventListener('click', (e) => {
            if (e.target === $('#modalBackdrop')) closeModal();
        });

        // Confirm dialog
        $('#confirmCancel').addEventListener('click', () => {
            $('#confirmBackdrop').classList.remove('show');
            if (confirmResolve) confirmResolve(false);
        });
        $('#confirmOk').addEventListener('click', () => {
            $('#confirmBackdrop').classList.remove('show');
            if (confirmResolve) confirmResolve(true);
        });

        // Mobile menu toggle
        $('#menuToggle').addEventListener('click', () => {
            $('#sidebar').classList.toggle('open');
        });

        // Responsive: show toggle on small screens
        function checkWidth() {
            const toggle = $('#menuToggle');
            if (window.innerWidth <= 768) {
                toggle.style.display = 'flex';
            } else {
                toggle.style.display = 'none';
                $('#sidebar').classList.remove('open');
            }
        }
        window.addEventListener('resize', checkWidth);
        checkWidth();

        // Keyboard shortcut: Escape closes modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
                $('#confirmBackdrop').classList.remove('show');
            }
        });

        // Navigate to dashboard, or the paywall if there's no active subscription
        navigateTo(subscriptionActive() ? 'dashboard' : 'billing');

        // PWA install prompt
        let deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            // Show install banner after a short delay
            setTimeout(() => showInstallBanner(), 2000);
        });

        function showInstallBanner() {
            if (localStorage.getItem('pos_pwa_dismissed')) return;
            if (window.matchMedia('(display-mode: standalone)').matches) return;

            const banner = document.createElement('div');
            banner.className = 'pwa-install-banner';
            banner.innerHTML = `
                <div class="pwa-text">
                    <strong>📲 Install ZE-POS</strong>
                    <small>Add to your home screen for the best experience</small>
                </div>
                <button class="btn" id="pwaInstallBtn">Install</button>
                <button class="btn btn-dismiss" id="pwaDismissBtn">✕</button>
            `;
            document.body.appendChild(banner);

            document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
                if (deferredPrompt) {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    deferredPrompt = null;
                    banner.remove();
                    if (outcome === 'accepted') {
                        toast('App installed successfully!');
                    }
                }
            });

            document.getElementById('pwaDismissBtn').addEventListener('click', () => {
                localStorage.setItem('pos_pwa_dismissed', '1');
                banner.remove();
            });
        }

        window.addEventListener('appinstalled', () => {
            deferredPrompt = null;
            toast('ZE-POS has been installed!');
        });
    }

    // ── Public API ─────────────────────────────────────────────
    return {
        init,
        navigateTo,
        refreshCurrentPage,
        openModal,
        closeModal,
        confirm,
        toast,
        formatCurrency,
        formatDate,
        formatDateTime,
        escapeHtml,
        safeImageUrl,
        renderSettings,
        $,
        $$,
    };
})();

// Boot
document.addEventListener('DOMContentLoaded', App.init);
