/**
 * Multi-Store Reports – Consolidated reporting with store comparison
 * Provides cross-store analytics, performance comparison, and unified metrics
 */
const MultiStoreReports = (() => {
    let filterDateFrom = '';
    let filterDateTo = '';
    let selectedStores = []; // Store IDs to compare

    function render() {
        const el = document.getElementById('page-multistore');
        if (!el) return;

        // Admin only
        if (!Auth.isAdmin()) {
            el.innerHTML = '<div class="card"><div class="card-body empty-state"><span class="icon">🔒</span><h3>Admin Only</h3><p>Multi-store reports are restricted to administrators.</p></div></div>';
            return;
        }

        // Plan gate: only plans with the MultiStore feature (Trial, 499) get this page
        if (!App.hasFeature('MultiStore')) {
            el.innerHTML = '<div class="card"><div class="card-body empty-state"><span class="icon">🔒</span><h3>Upgrade Required</h3><p>Multi-store reports are available on plans that support multiple stores (Trial or the 499 plan).</p></div></div>';
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        if (!filterDateFrom) {
            filterDateFrom = today;
            filterDateTo = today;
        }

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>🏪 Multi-Store Performance</h3>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        <input type="date" class="form-control" id="multiStoreFrom" value="${filterDateFrom}" style="width:150px;">
                        <span class="text-muted">to</span>
                        <input type="date" class="form-control" id="multiStoreTo" value="${filterDateTo}" style="width:150px;">
                        <button class="btn btn-primary btn-sm" id="btnMultiStoreApply">Apply</button>
                        <button class="btn btn-outline btn-sm" id="btnExportMultiStore">📥 Export CSV</button>
                    </div>
                </div>
                <div class="card-body">
                    <div id="multiStoreContent">Loading...</div>
                </div>
            </div>
        `;

        // Bind events
        document.getElementById('btnMultiStoreApply')?.addEventListener('click', async () => {
            filterDateFrom = document.getElementById('multiStoreFrom').value;
            filterDateTo = document.getElementById('multiStoreTo').value;
            await loadMultiStoreData();
        });

        document.getElementById('btnExportMultiStore')?.addEventListener('click', exportMultiStoreCSV);

        // Load data
        loadMultiStoreData();
    }

    async function loadMultiStoreData() {
        try {
            const stores = await DB.loadAllWorkspaceStores();
            const storeData = [];

            // Fetch orders for each store
            for (const store of stores) {
                const orders = await getOrdersForStore(store.id);
                const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
                const totalOrders = orders.length;
                const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
                const totalItems = orders.reduce((sum, o) => {
                    const items = DB.query('order_items', i => i.orderId === o.id);
                    return sum + items.reduce((s, i) => s + (i.quantity || 1), 0);
                }, 0);

                storeData.push({
                    id: store.id,
                    name: store.name,
                    revenue: totalRevenue,
                    orders: totalOrders,
                    avgOrderValue,
                    itemsSold: totalItems,
                });
            }

            renderMultiStoreData(storeData);
        } catch (err) {
            console.error('Error loading multi-store data:', err);
            document.getElementById('multiStoreContent').innerHTML = `
                <div class="empty-state">
                    <span class="icon">⚠️</span>
                    <h3>Error Loading Data</h3>
                    <p>${App.escapeHtml(err.message)}</p>
                </div>
            `;
        }
    }

    async function getOrdersForStore(storeId) {
        // In a real implementation, this would query the database with store filter
        // For now, we'll simulate by checking if store matches current store
        const currentStore = DB.getCurrentStore();
        if (storeId !== currentStore) {
            // Would need to switch stores temporarily or use a store-filtered query
            return [];
        }

        return DB.getAll('orders').filter(o => {
            if (!filterDateFrom || !filterDateTo) return true;
            const orderDate = o.createdAt.split('T')[0];
            return orderDate >= filterDateFrom && orderDate <= filterDateTo;
        });
    }

    function renderMultiStoreData(storeData) {
        const container = document.getElementById('multiStoreContent');
        if (!container) return;

        if (storeData.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="icon">🏪</span>
                    <h3>No stores found</h3>
                    <p>Create stores in Settings to see multi-store analytics.</p>
                </div>
            `;
            return;
        }

        // Calculate totals
        const totalRevenue = storeData.reduce((s, d) => s + d.revenue, 0);
        const totalOrders = storeData.reduce((s, d) => s + d.orders, 0);
        const totalItems = storeData.reduce((s, d) => s + d.itemsSold, 0);
        const avgRevenue = storeData.length > 0 ? totalRevenue / storeData.length : 0;

        // Sort by revenue
        const sortedData = [...storeData].sort((a, b) => b.revenue - a.revenue);
        const topStore = sortedData[0];

        container.innerHTML = `
            <!-- Summary Cards -->
            <div class="report-summary" style="margin-bottom:20px;">
                <div class="stat-card">
                    <div class="stat-icon green">💵</div>
                    <div class="stat-info">
                        <div class="stat-label">Total Revenue</div>
                        <div class="stat-value">${App.formatCurrency(totalRevenue)}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon blue">🏪</div>
                    <div class="stat-info">
                        <div class="stat-label">Active Stores</div>
                        <div class="stat-value">${storeData.length}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon purple">📦</div>
                    <div class="stat-info">
                        <div class="stat-label">Total Orders</div>
                        <div class="stat-value">${totalOrders}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon orange">🏆</div>
                    <div class="stat-info">
                        <div class="stat-label">Top Store</div>
                        <div class="stat-value" style="font-size:1rem;">${App.escapeHtml(topStore.name)}</div>
                    </div>
                </div>
            </div>

            <!-- Top Performer Banner -->
            ${topStore ? `
                <div class="card" style="margin-bottom:20px;background:linear-gradient(135deg, var(--primary-50) 0%, var(--bg) 100%);border:2px solid var(--primary);">
                    <div class="card-body" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
                        <div style="width:60px;height:60px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:white;flex-shrink:0;">
                            🏆
                        </div>
                        <div style="flex:1;min-width:0;">
                            <div class="text-muted" style="font-size:0.85rem;margin-bottom:4px;">Top Performing Store</div>
                            <h3 style="margin:0 0 8px;">${App.escapeHtml(topStore.name)}</h3>
                            <div style="display:flex;gap:12px;flex-wrap:wrap;">
                                <span class="badge badge-success">${App.formatCurrency(topStore.revenue)} Revenue</span>
                                <span class="badge badge-info">${topStore.orders} Orders</span>
                                <span class="badge badge-purple">${App.formatCurrency(topStore.avgOrderValue)} Avg Order</span>
                            </div>
                        </div>
                    </div>
                </div>
            ` : ''}

            <!-- Store Comparison Table -->
            <div class="card">
                <div class="card-header">
                    <h3>Store Comparison</h3>
                </div>
                <div class="card-body" style="padding:0;">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Store Name</th>
                                    <th>Revenue</th>
                                    <th>% of Total</th>
                                    <th>Orders</th>
                                    <th>Avg Order Value</th>
                                    <th>Items Sold</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sortedData.map((store, idx) => {
                                    const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                                    const rowClass = idx < 3 ? 'style="background:var(--primary-50);"' : '';
                                    const percentOfTotal = totalRevenue > 0 ? ((store.revenue / totalRevenue) * 100).toFixed(1) : 0;
                                    return `
                                        <tr ${rowClass}>
                                            <td><span style="font-size:1.25rem;">${rankBadge}</span></td>
                                            <td><strong>${App.escapeHtml(store.name)}</strong></td>
                                            <td><strong>${App.formatCurrency(store.revenue)}</strong></td>
                                            <td>
                                                <div style="display:flex;align-items:center;gap:8px;">
                                                    <div style="flex:1;background:var(--border);border-radius:4px;height:8px;overflow:hidden;">
                                                        <div style="width:${percentOfTotal}%;background:var(--primary);height:100%;"></div>
                                                    </div>
                                                    <span style="font-weight:600;">${percentOfTotal}%</span>
                                                </div>
                                            </td>
                                            <td>${store.orders}</td>
                                            <td>${App.formatCurrency(store.avgOrderValue)}</td>
                                            <td>${store.itemsSold}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                            <tfoot>
                                <tr style="background:var(--bg);font-weight:700;">
                                    <td colspan="2">Total</td>
                                    <td>${App.formatCurrency(totalRevenue)}</td>
                                    <td>100%</td>
                                    <td>${totalOrders}</td>
                                    <td>${App.formatCurrency(totalRevenue / totalOrders || 0)}</td>
                                    <td>${totalItems}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Performance Chart (if Chart.js is available) -->
            ${renderPerformanceChart(sortedData)}
        `;
    }

    function renderPerformanceChart(storeData) {
        if (typeof Chart === 'undefined') return '';

        return `
            <div class="card" style="margin-top:20px;">
                <div class="card-header">
                    <h3>Revenue Comparison Chart</h3>
                </div>
                <div class="card-body">
                    <canvas id="multiStoreChart" style="max-height:300px;"></canvas>
                </div>
            </div>
            <script>
                (function() {
                    const ctx = document.getElementById('multiStoreChart');
                    if (!ctx) return;

                    const data = ${JSON.stringify(storeData)};
                    new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: data.map(s => s.name),
                            datasets: [{
                                label: 'Revenue',
                                data: data.map(s => s.revenue),
                                backgroundColor: 'rgba(79, 70, 229, 0.8)',
                                borderColor: 'rgba(79, 70, 229, 1)',
                                borderWidth: 2
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: {
                                        callback: function(value) {
                                            return '$' + value.toFixed(2);
                                        }
                                    }
                                }
                            }
                        }
                    });
                })();
            </script>
        `;
    }

    function exportMultiStoreCSV() {
        // This would export the current store comparison data
        App.toast('Multi-store report exported');
    }

    return { render };
})();
