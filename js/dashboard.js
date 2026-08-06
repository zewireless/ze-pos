/**
 * Dashboard – Stats cards + revenue chart
 */
const Dashboard = (() => {
    let chartInstance = null;

    function render() {
        const el = document.getElementById('page-dashboard');
        const today = new Date().toISOString().split('T')[0];

        // Calculate stats
        const orders = DB.getAll('orders');
        const todayOrders = orders.filter(o => o.createdAt && o.createdAt.startsWith(today));
        const todayRevenue = todayOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
        const totalProducts = DB.count('menu_items');
        const totalCategories = DB.count('categories');
        const user = Auth.currentUser();
        const openShifts = DB.query('shifts', s => s.status === 'open');
        const userOpenShift = Shifts.getOpenShift(user.id);

        el.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon green">💵</div>
                    <div class="stat-info">
                        <div class="stat-label">Today's Revenue</div>
                        <div class="stat-value">${App.formatCurrency(todayRevenue)}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon blue">📦</div>
                    <div class="stat-info">
                        <div class="stat-label">Today's Orders</div>
                        <div class="stat-value">${todayOrders.length}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon ${userOpenShift ? 'green' : 'orange'}">🕐</div>
                    <div class="stat-info">
                        <div class="stat-label">${Auth.isAdmin() ? 'Open Shifts' : 'My Shift'}</div>
                        <div class="stat-value">${Auth.isAdmin() ? openShifts.length : (userOpenShift ? 'Active' : 'None')}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon purple">📋</div>
                    <div class="stat-info">
                        <div class="stat-label">Total Products</div>
                        <div class="stat-value">${totalProducts}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon orange">📁</div>
                    <div class="stat-info">
                        <div class="stat-label">Total Categories</div>
                        <div class="stat-value">${totalCategories}</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>Revenue Overview (Last 7 Days)</h3>
                </div>
                <div class="card-body">
                    <div class="chart-container">
                        <canvas id="revenueChart"></canvas>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-top:24px;">
                <div class="card-header">
                    <h3>Recent Orders</h3>
                </div>
                <div class="card-body" style="padding:0;">
                    ${renderRecentOrders(orders)}
                </div>
            </div>
        `;

        renderChart(orders);
    }

    function renderRecentOrders(orders) {
        const recent = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
        if (recent.length === 0) {
            return '<div class="empty-state"><span class="icon">📭</span><h3>No orders yet</h3><p>Orders will appear here once you start selling.</p></div>';
        }
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Order #</th>
                            <th>Type</th>
                            <th>Total</th>
                            <th>Status</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recent.map(o => `
                            <tr>
                                <td><strong>#${o.orderNumber}</strong></td>
                                <td><span class="badge badge-info">${App.escapeHtml(o.type)}</span></td>
                                <td><strong>${App.formatCurrency(o.total)}</strong></td>
                                <td><span class="badge badge-success">${App.escapeHtml(o.status)}</span></td>
                                <td class="text-muted">${App.formatDateTime(o.createdAt)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderChart(orders) {
        const canvas = document.getElementById('revenueChart');
        if (!canvas) return;

        // Destroy previous chart instance
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        // Build last 7 days data
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().split('T')[0]);
        }

        const labels = days.map(d => {
            const date = new Date(d + 'T12:00:00');
            return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        });

        const data = days.map(day => {
            return orders
                .filter(o => o.createdAt && o.createdAt.startsWith(day))
                .reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
        });

        chartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Revenue',
                    data,
                    backgroundColor: 'rgba(79, 70, 229, 0.8)',
                    borderColor: 'rgba(79, 70, 229, 1)',
                    borderWidth: 1,
                    borderRadius: 6,
                    barPercentage: 0.6,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => App.formatCurrency(ctx.raw),
                        },
                    },
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (v) => App.formatCurrency(v),
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' },
                    },
                    x: {
                        grid: { display: false },
                    },
                },
            },
        });
    }

    return { render };
})();
