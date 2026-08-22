/**
 * Leaderboards – Performance tracking for top sellers (Admin only)
 * Tracks sales per cashier, displays leaderboards for shifts, weeks, months
 */
const Leaderboards = (() => {
    let period = 'week'; // 'shift', 'week', 'month'

    function render() {
        const el = document.getElementById('page-leaderboards');
        if (!el) return;

        // Admin only
        if (!Auth.isAdmin()) {
            el.innerHTML = '<div class="card"><div class="card-body empty-state"><span class="icon">🔒</span><h3>Admin Only</h3><p>Performance leaderboards are restricted to administrators.</p></div></div>';
            return;
        }

        const leaderboardData = calculateLeaderboard();
        const topSeller = leaderboardData[0];

        el.innerHTML = `
            <div class="card" style="margin-bottom:20px;">
                <div class="card-header">
                    <h3>🏆 Performance Leaderboards</h3>
                    <div style="display:flex;gap:10px;">
                        <button class="btn btn-sm ${period === 'shift' ? 'btn-primary' : 'btn-outline'}" id="btnPeriodShift">This Shift</button>
                        <button class="btn btn-sm ${period === 'week' ? 'btn-primary' : 'btn-outline'}" id="btnPeriodWeek">This Week</button>
                        <button class="btn btn-sm ${period === 'month' ? 'btn-primary' : 'btn-outline'}" id="btnPeriodMonth">This Month</button>
                    </div>
                </div>
                <div class="card-body">
                    ${topSeller ? renderTopSellerCard(topSeller) : '<div class="empty-state"><span class="icon">📊</span><h3>No sales data yet</h3><p>Leaderboards will appear after orders are completed.</p></div>'}
                </div>
            </div>

            ${leaderboardData.length > 0 ? renderLeaderboardTable(leaderboardData) : ''}
        `;

        // Bind period buttons
        document.getElementById('btnPeriodShift')?.addEventListener('click', () => { period = 'shift'; render(); });
        document.getElementById('btnPeriodWeek')?.addEventListener('click', () => { period = 'week'; render(); });
        document.getElementById('btnPeriodMonth')?.addEventListener('click', () => { period = 'month'; render(); });
    }

    function renderTopSellerCard(seller) {
        const medal = period === 'week' ? '🥇' : '🏆';
        const periodLabel = period === 'shift' ? 'This Shift' : period === 'week' ? 'This Week' : 'This Month';

        return `
            <div class="top-seller-card" style="display:flex;align-items:center;gap:20px;padding:20px;background:linear-gradient(135deg, var(--primary-50) 0%, var(--bg) 100%);border-radius:var(--radius-lg);border:2px solid var(--primary);">
                <div style="width:80px;height:80px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.5rem;color:white;">
                    ${medal}
                </div>
                <div style="flex:1;">
                    <div class="text-muted" style="font-size:0.85rem;margin-bottom:4px;">Top Seller ${periodLabel}</div>
                    <h2 style="margin:0 0 8px;font-size:1.5rem;">${App.escapeHtml(seller.name)}</h2>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;">
                        <span class="badge badge-success" style="font-size:1rem;padding:6px 12px;">
                            💵 ${App.formatCurrency(seller.revenue)} Revenue
                        </span>
                        <span class="badge badge-info" style="font-size:1rem;padding:6px 12px;">
                            📦 ${seller.orders} Orders
                        </span>
                        <span class="badge badge-purple" style="font-size:1rem;padding:6px 12px;">
                            📊 ${App.formatCurrency(seller.avgOrderValue)} Avg Order
                        </span>
                    </div>
                </div>
            </div>
        `;
    }

    function renderLeaderboardTable(data) {
        return `
            <div class="card">
                <div class="card-header">
                    <h3>All Staff Performance</h3>
                </div>
                <div class="card-body" style="padding:0;">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Cashier</th>
                                    <th>Orders</th>
                                    <th>Revenue</th>
                                    <th>Avg Order Value</th>
                                    <th>Items Sold</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.map((seller, idx) => {
                                    const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                                    const rowClass = idx < 3 ? 'style="background:var(--primary-50);"' : '';
                                    return `
                                        <tr ${rowClass}>
                                            <td><span style="font-size:1.25rem;">${rankBadge}</span></td>
                                            <td><strong>${App.escapeHtml(seller.name)}</strong></td>
                                            <td>${seller.orders}</td>
                                            <td><strong>${App.formatCurrency(seller.revenue)}</strong></td>
                                            <td>${App.formatCurrency(seller.avgOrderValue)}</td>
                                            <td>${seller.itemsSold}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    function calculateLeaderboard() {
        const now = new Date();
        let startDate, endDate;

        if (period === 'shift') {
            // Get orders from current open shifts
            const openShifts = DB.getAll('shifts').filter(s => s.status === 'open');
            if (openShifts.length === 0) {
                // If no open shift, use today
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                endDate = now;
            } else {
                startDate = new Date(Math.min(...openShifts.map(s => new Date(s.startTime))));
                endDate = now;
            }
        } else if (period === 'week') {
            // Start of this week (Sunday or Monday depending on locale)
            const dayOfWeek = now.getDay();
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
            endDate = now;
        } else {
            // This month
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = now;
        }

        // Get orders in date range
        const orders = DB.getAll('orders').filter(o => {
            const orderDate = new Date(o.createdAt);
            return orderDate >= startDate && orderDate <= endDate && o.status === 'Completed';
        });

        // Group by user
        const userStats = {};
        orders.forEach(order => {
            const userId = order.userId || 'unknown';
            if (!userStats[userId]) {
                userStats[userId] = {
                    name: order.userName || 'Unknown',
                    orders: 0,
                    revenue: 0,
                    itemsSold: 0,
                };
            }
            userStats[userId].orders++;
            userStats[userId].revenue += parseFloat(order.total) || 0;

            // Count items
            const orderItems = DB.query('order_items', i => i.orderId === order.id);
            userStats[userId].itemsSold += orderItems.reduce((sum, i) => sum + (i.quantity || 1), 0);
        });

        // Convert to array and sort by revenue
        const leaderboard = Object.values(userStats).map(s => ({
            ...s,
            avgOrderValue: s.orders > 0 ? s.revenue / s.orders : 0,
        })).sort((a, b) => b.revenue - a.revenue);

        return leaderboard;
    }

    return { render };
})();