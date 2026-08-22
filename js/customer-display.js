/**
 * Customer Display – Second screen showing order details to customers
 * Syncs with POS via localStorage (same device) or Supabase Realtime (different devices)
 */
const CustomerDisplay = (() => {
    let currentOrder = null;
    let supabaseChannel = null;
    let storeId = null;
    let syncMethod = 'localStorage'; // 'localStorage' or 'realtime'
    let lastSyncTime = 0;

    // DOM Elements
    const elements = {
        items: null,
        subtotal: null,
        taxRow: null,
        taxLabel: null,
        taxAmount: null,
        total: null,
        orderType: null,
        storeName: null,
        paymentStatus: null,
        thankYou: null,
        connection: null,
        connectionDot: null,
        connectionText: null,
        emptyState: null,
    };

    function init() {
        // Cache DOM elements
        elements.items = document.getElementById('cdItems');
        elements.subtotal = document.getElementById('cdSubtotal');
        elements.taxRow = document.getElementById('cdTaxRow');
        elements.taxLabel = document.getElementById('cdTaxLabel');
        elements.taxAmount = document.getElementById('cdTaxAmount');
        elements.total = document.getElementById('cdTotal');
        elements.orderType = document.getElementById('cdOrderType');
        elements.storeName = document.getElementById('cdStoreName');
        elements.paymentStatus = document.getElementById('cdPaymentStatus');
        elements.thankYou = document.getElementById('cdThankYou');
        elements.connection = document.getElementById('cdConnection');
        elements.connectionDot = elements.connection.querySelector('.cd-connection-dot');
        elements.connectionText = elements.connection.querySelector('.cd-connection-text');
        elements.emptyState = elements.items.querySelector('.cd-empty-state');

        // Get store ID from URL or localStorage
        const urlParams = new URLSearchParams(window.location.search);
        storeId = urlParams.get('store') || localStorage.getItem('cd_store_id') || DB.getCurrentStore();

        if (storeId) {
            localStorage.setItem('cd_store_id', storeId);
        }

        // Load store name
        loadStoreName();

        // Try to connect via Supabase Realtime first, fallback to localStorage polling
        initSupabaseRealtime();

        // Start polling as fallback
        startPolling();

        // Handle visibility change to reduce polling when hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('[CustomerDisplay] Tab hidden, reducing poll frequency');
            } else {
                console.log('[CustomerDisplay] Tab visible, checking for updates');
                pollForUpdates();
            }
        });

        // Listen for storage events (cross-tab communication)
        window.addEventListener('storage', (e) => {
            if (e.key === `cd_order_${storeId}`) {
                console.log('[CustomerDisplay] Storage event received');
                pollForUpdates();
            }
        });

        console.log('[CustomerDisplay] Initialized for store:', storeId);
    }

    async function loadStoreName() {
        try {
            const client = Supabase.getClient();
            const { data } = await client.from('stores').select('name').eq('id', storeId).single();
            if (data && elements.storeName) {
                elements.storeName.textContent = data.name;
            }
        } catch (e) {
            console.warn('[CustomerDisplay] Could not load store name:', e.message);
            elements.storeName.textContent = 'Store #' + storeId.slice(-6);
        }
    }

    function initSupabaseRealtime() {
        try {
            const client = Supabase.getClient();
            if (!client) return;

            // Subscribe to orders changes for this store
            supabaseChannel = client
                .channel(`customer-display-${storeId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'orders',
                        filter: `store_id=eq.${storeId}`,
                    },
                    (payload) => {
                        console.log('[CustomerDisplay] Realtime update:', payload);
                        handleRealtimeUpdate(payload);
                    }
                )
                .subscribe((status) => {
                    console.log('[CustomerDisplay] Realtime subscription status:', status);
                    updateConnectionStatus(status === 'SUBSCRIBED' ? 'connected' : 'connecting');
                });

            syncMethod = 'realtime';
        } catch (e) {
            console.warn('[CustomerDisplay] Realtime not available, using localStorage:', e.message);
            syncMethod = 'localStorage';
            updateConnectionStatus('localStorage');
        }
    }

    function handleRealtimeUpdate(payload) {
        // For customer display, we care about the latest active order
        // The POS will write to localStorage for immediate sync
        // This is mainly for cross-device sync
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const order = payload.new;
            if (order && (order.status === 'Pending' || order.status === 'In Progress')) {
                // Trigger a poll to get full order with items
                setTimeout(pollForUpdates, 100);
            }
        }
    }

    function startPolling() {
        // Initial poll
        pollForUpdates();

        // Poll every 500ms for localStorage, 2s for realtime
        const interval = syncMethod === 'realtime' ? 2000 : 500;
        setInterval(pollForUpdates, interval);
    }

    function pollForUpdates() {
        const stored = localStorage.getItem(`cd_order_${storeId}`);
        if (!stored) {
            showEmptyState();
            return;
        }

        try {
            const orderData = JSON.parse(stored);
            // Check if data is fresh (updated in last 30 seconds)
            if (orderData.timestamp && Date.now() - orderData.timestamp < 30000) {
                if (!currentOrder || currentOrder.orderNumber !== orderData.orderNumber ||
                    JSON.stringify(currentOrder.items) !== JSON.stringify(orderData.items)) {
                    displayOrder(orderData);
                }
            } else {
                // Stale data
                showEmptyState();
            }
        } catch (e) {
            console.error('[CustomerDisplay] Error parsing order:', e);
            showEmptyState();
        }
    }

    function displayOrder(orderData) {
        currentOrder = orderData;
        hideEmptyState();

        // Update order type
        if (elements.orderType) {
            elements.orderType.textContent = orderData.type || 'Dine-In';
            elements.orderType.className = 'cd-order-type ' + (orderData.type || 'dine-in').toLowerCase().replace(' ', '-');
        }

        // Update items
        renderItems(orderData.items || []);

        // Update totals
        updateTotals(orderData);

        // Update payment status
        updatePaymentStatus(orderData.status);

        // Update connection status
        updateConnectionStatus('synced');
    }

    function renderItems(items) {
        if (!elements.items) return;

        if (items.length === 0) {
            showEmptyState();
            return;
        }

        hideEmptyState();

        elements.items.innerHTML = items.map((item, idx) => `
            <div class="cd-item" style="animation: slideIn 0.3s ease ${idx * 0.05}s both;">
                <div class="cd-item-main">
                    <span class="cd-item-qty">${item.quantity}x</span>
                    <span class="cd-item-name">${escapeHtml(item.name)}</span>
                </div>
                <div class="cd-item-details">
                    ${item.size ? `<span class="cd-item-size">${escapeHtml(item.size)}</span>` : ''}
                    ${item.condiments && item.condiments.length > 0
                        ? `<span class="cd-item-condiments">+ ${item.condiments.map(c => escapeHtml(c.name)).join(', ')}</span>`
                        : ''}
                    ${item.notes ? `<span class="cd-item-notes">${escapeHtml(item.notes)}</span>` : ''}
                </div>
                <span class="cd-item-price">${formatCurrency(item.lineTotal)}</span>
            </div>
        `).join('');
    }

    function updateTotals(orderData) {
        const subtotal = orderData.subtotal || 0;
        const taxAmount = orderData.taxAmount || 0;
        const taxName = orderData.taxName || 'Tax';
        const taxPercentage = orderData.taxPercentage || 0;
        const total = orderData.total || 0;

        if (elements.subtotal) elements.subtotal.textContent = formatCurrency(subtotal);

        if (taxAmount > 0 && elements.taxRow && elements.taxLabel && elements.taxAmount) {
            elements.taxLabel.textContent = `${taxName} (${taxPercentage}%)`;
            elements.taxAmount.textContent = formatCurrency(taxAmount);
            elements.taxRow.style.display = 'flex';
        } else if (elements.taxRow) {
            elements.taxRow.style.display = 'none';
        }

        if (elements.total) elements.total.textContent = formatCurrency(total);
    }

    function updatePaymentStatus(status) {
        if (!elements.paymentStatus || !elements.thankYou) return;

        if (status === 'Completed') {
            elements.paymentStatus.classList.add('hidden');
            elements.thankYou.classList.remove('hidden');
            // Auto-hide thank you after 5 seconds
            setTimeout(() => {
                if (currentOrder && currentOrder.status === 'Completed') {
                    showEmptyState();
                }
            }, 5000);
        } else {
            elements.paymentStatus.classList.remove('hidden');
            elements.thankYou.classList.add('hidden');

            const badge = elements.paymentStatus.querySelector('.cd-status-badge');
            const text = elements.paymentStatus.querySelector('.cd-status-text');

            if (status === 'Pending') {
                badge.textContent = 'Awaiting Payment';
                badge.className = 'cd-status-badge pending';
                text.textContent = 'Please proceed to counter';
            } else if (status === 'In Progress') {
                badge.textContent = 'Preparing';
                badge.className = 'cd-status-badge preparing';
                text.textContent = 'Your order is being prepared';
            }
        }
    }

    function showEmptyState() {
        if (elements.emptyState) elements.emptyState.style.display = 'flex';
        if (elements.items) {
            // Keep items but dim them
            elements.items.querySelectorAll('.cd-item').forEach(el => el.style.opacity = '0.4');
        }
        if (elements.paymentStatus) elements.paymentStatus.classList.remove('hidden');
        if (elements.thankYou) elements.thankYou.classList.add('hidden');
        currentOrder = null;
    }

    function hideEmptyState() {
        if (elements.emptyState) elements.emptyState.style.display = 'none';
        if (elements.items) {
            elements.items.querySelectorAll('.cd-item').forEach(el => el.style.opacity = '1');
        }
    }

    function updateConnectionStatus(status) {
        if (!elements.connectionDot || !elements.connectionText) return;

        elements.connectionDot.className = 'cd-connection-dot ' + status;

        switch (status) {
            case 'connected':
                elements.connectionText.textContent = 'Live';
                break;
            case 'synced':
                elements.connectionText.textContent = 'Synced';
                break;
            case 'localStorage':
                elements.connectionText.textContent = 'Local Sync';
                break;
            case 'connecting':
                elements.connectionText.textContent = 'Connecting...';
                break;
            default:
                elements.connectionText.textContent = status;
        }
    }

    // Helper functions
    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"')
            .replace(/'/g, ''');
    }

    function formatCurrency(amount) {
        const symbol = DB.getSetting('currency_symbol') || '₱';
        return symbol + parseFloat(amount || 0).toFixed(2);
    }

    // Cleanup
    function destroy() {
        if (supabaseChannel) {
            const client = Supabase.getClient();
            if (client) {
                client.removeChannel(supabaseChannel);
            }
        }
    }

    // Expose for debugging
    window.CustomerDisplay = { init, destroy, pollForUpdates };

    return { init };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    CustomerDisplay.init();
});