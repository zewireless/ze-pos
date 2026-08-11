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

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
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
        condiments: 'Condiments',
        tax: 'Tax Setup',
        orders: 'Order History',
        reports: 'Sales Reports',
        shifts: 'Shift Management',
        schedules: 'Shift Schedules',
        payroll: 'Payroll',
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

        // Call module init
        switch (page) {
            case 'dashboard': Dashboard.render(); break;
            case 'pos': POS.render(); break;
            case 'staff': Staff.render(); break;
            case 'categories': Categories.render(); break;
            case 'menu': Menu.render(); break;
            case 'condiments': Condiments.render(); break;
            case 'tax': Tax.render(); break;
            case 'orders': Orders.render(); break;
            case 'reports': Reports.render(); break;
            case 'shifts': Shifts.render(); break;
            case 'schedules': Schedules.render(); break;
            case 'payroll': Payroll.render(); break;
            case 'billing': Billing.render(); break;
            case 'settings': App.renderSettings(); break;
        }

        // Close mobile sidebar
        $('#sidebar').classList.remove('open');
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
        `;

        $('#btnSaveSettings').addEventListener('click', () => {
            DB.setSetting('restaurant_name', $('#settName').value.trim());
            DB.setSetting('restaurant_address', $('#settAddress').value.trim());
            DB.setSetting('restaurant_phone', $('#settPhone').value.trim());
            DB.setSetting('currency_symbol', $('#settCurrency').value.trim() || '$');
            toast('Settings saved successfully');
        });

        $('#btnResetData').addEventListener('click', async () => {
            const yes = await App.confirm('Reset All Data?', 'This will permanently delete all your data and restore defaults.', 'Reset');
            if (yes) {
                DB.resetAll();
                toast('All data has been reset');
                navigateTo('dashboard');
            }
        });

        $('#btnClearHistory').addEventListener('click', async () => {
            const yes = await App.confirm('Clear Order & Shift History?', 'This will delete all orders, shifts, and payroll runs. Your staff, menu, tax, schedules, and settings will be kept.', 'Clear History');
            if (yes) {
                DB.clear('orders');
                DB.clear('order_items');
                DB.clear('shifts');
                DB.clear('payrolls');
                toast('Order & shift history cleared');
                navigateTo('dashboard');
            }
        });
    }

    // ── Staff Clock-In / Switch User ───────────────────────────
    function updateUserUI() {
        const user = Auth.currentUser();
        if (!user) return;
        $('#userName').textContent = user.name;
        $('#userRole').textContent = user.role === 'admin' ? 'Admin' : 'Cashier';
        $('#userAvatar').textContent = user.name.charAt(0).toUpperCase();

        // "Back to Owner" only makes sense on a shared register (owner session
        // present). Direct cashier logins have no owner marker — just clock-in.
        $('#btnSwitchUser').innerHTML = (Auth.isStaffSession() && Auth.hasOwnerSession())
            ? '🔙 Back to Owner'
            : '👤 Switch User';

        // Show/hide admin elements
        $$('.admin-only').forEach(el => el.style.display = Auth.isAdmin() ? '' : 'none');
        $$('.super-admin-only').forEach(el => el.style.display = Auth.isSuperAdmin() ? '' : 'none');
    }

    function openSwitchUserModal() {
        // Shared-register staff session with an owner present → switch back.
        if (Auth.isStaffSession() && Auth.hasOwnerSession()) {
            Auth.switchToOwner();
            updateUserUI();
            toast(`Signed back in as ${Auth.currentUser().name}`);
            navigateTo('dashboard');
            return;
        }

        App.openModal(`
            <div class="modal-header">
                <h3>Staff Clock In</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p class="text-muted" style="margin-bottom:16px;">Enter your staff username and password to clock in at this register. Sales you make will be recorded to your shift.</p>
                <div class="form-group">
                    <label>Username</label>
                    <input type="text" class="form-control" id="staffLoginUsername" placeholder="e.g. juan123" autocomplete="username">
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" class="form-control" id="staffLoginPassword" placeholder="Enter password" autocomplete="current-password">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnStaffLogin">Clock In</button>
            </div>
        `);

        document.getElementById('btnStaffLogin').addEventListener('click', async () => {
            const username = document.getElementById('staffLoginUsername').value.trim();
            const password = document.getElementById('staffLoginPassword').value;
            if (!username || !password) {
                toast('Enter your username and password', 'error');
                return;
            }
            const btn = document.getElementById('btnStaffLogin');
            btn.disabled = true;
            btn.textContent = 'Checking…';
            const { user, error } = await Auth.loginAsStaff(username, password);
            btn.disabled = false;
            btn.textContent = 'Clock In';
            if (error || !user) {
                toast(error.message || 'Invalid username or password', 'error');
                return;
            }
            App.closeModal();
            updateUserUI();
            toast(`Signed in as ${user.name}`);
            navigateTo('pos');
        });

        document.getElementById('staffLoginUsername').focus();
    }

    // ── Init ───────────────────────────────────────────────────
    async function init() {
        Supabase.init();

        const session = await Supabase.getSession();
        if (!session) { window.location.href = 'index.html'; return; }

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

        // Staff clock-in / switch user
        $('#btnSwitchUser').addEventListener('click', openSwitchUserModal);

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
                    <strong>📲 Install FoodZone POS</strong>
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
            toast('FoodZone POS has been installed!');
        });
    }

    // ── Public API ─────────────────────────────────────────────
    return {
        init,
        navigateTo,
        openModal,
        closeModal,
        confirm,
        toast,
        formatCurrency,
        formatDate,
        formatDateTime,
        escapeHtml,
        renderSettings,
        $,
        $$,
    };
})();

// Boot
document.addEventListener('DOMContentLoaded', App.init);
