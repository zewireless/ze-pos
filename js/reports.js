/**
 * Reports – Daily & Monthly sales reports
 */
const Reports = (() => {
    let reportType = 'daily';
    let filterDateFrom = '';
    let filterDateTo = '';
    let filterCashier = '';

    function render() {
        const el = document.getElementById('page-reports');
        const today = new Date().toISOString().split('T')[0];

        if (!filterDateFrom) {
            if (reportType === 'daily') {
                filterDateFrom = today;
                filterDateTo = today;
            } else {
                // Default to current month
                const d = new Date();
                filterDateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                filterDateTo = today;
            }
        }

        const orders = getFilteredOrders();
        const summary = calcSummary(orders);

        // Working hours & OT for the same period (closed shifts)
        const workShifts = getShiftsInRange();
        const daysInRange = filterDateFrom && filterDateTo
            ? Math.round((new Date(`${filterDateTo}T23:59:59`) - new Date(`${filterDateFrom}T00:00:00`)) / 86400000) + 1
            : 1;
        const workSummary = workShifts.length ? Payroll.summaryForShifts(workShifts, daysInRange) : [];

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Sales Reports</h3>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        <div class="btn-group">
                            <button class="btn btn-sm ${reportType === 'daily' ? 'btn-primary' : 'btn-outline'}" id="rptDaily">Daily</button>
                            <button class="btn btn-sm ${reportType === 'monthly' ? 'btn-primary' : 'btn-outline'}" id="rptMonthly">Monthly</button>
                            <button class="btn btn-sm ${reportType === 'custom' ? 'btn-primary' : 'btn-outline'}" id="rptCustom">Custom Range</button>
                        </div>
                        ${Auth.isAdmin() ? `
                            <select class="form-control" id="rptCashier" style="width:180px;">
                                <option value="">All Cashiers</option>
                                ${DB.getAll('users')
                                    .filter(u => u.role === 'cashier' && u.enabled !== false)
                                    .map(u => `<option value="${u.id}" ${filterCashier === u.id ? 'selected' : ''}>${App.escapeHtml(u.name)}</option>`)
                                    .join('')}
                            </select>
                        ` : ''}
                        <input type="date" class="form-control" id="rptDateFrom" value="${filterDateFrom}" style="width:150px;">
                        <span class="text-muted">to</span>
                        <input type="date" class="form-control" id="rptDateTo" value="${filterDateTo}" style="width:150px;">
                        <button class="btn btn-primary btn-sm" id="rptApply">Apply</button>
                    </div>
                </div>
                <div class="card-body">
                    <div class="report-summary">
                        <div class="stat-card">
                            <div class="stat-icon green">💵</div>
                            <div class="stat-info">
                                <div class="stat-label">Total Revenue</div>
                                <div class="stat-value">${App.formatCurrency(summary.revenue)}</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon blue">📦</div>
                            <div class="stat-info">
                                <div class="stat-label">Total Orders</div>
                                <div class="stat-value">${summary.orderCount}</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon purple">📊</div>
                            <div class="stat-info">
                                <div class="stat-label">Avg Order Value</div>
                                <div class="stat-value">${summary.orderCount > 0 ? App.formatCurrency(summary.revenue / summary.orderCount) : App.formatCurrency(0)}</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon orange">💰</div>
                            <div class="stat-info">
                                <div class="stat-label">Tax Collected</div>
                                <div class="stat-value">${App.formatCurrency(summary.taxTotal)}</div>
                            </div>
                        </div>
                    </div>

                    ${orders.length > 0 ? `
                        <h4 style="margin-bottom:12px;">Order Details</h4>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Order #</th>
                                        <th>Type</th>
                                        <th>Subtotal</th>
                                        <th>Tax</th>
                                        <th>Total</th>
                                        <th>Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${orders.map(o => `
                                        <tr>
                                            <td><strong>#${o.orderNumber}</strong></td>
                                            <td><span class="badge badge-info">${App.escapeHtml(o.type)}</span></td>
                                            <td>${App.formatCurrency(o.subtotal)}</td>
                                            <td>${App.formatCurrency(o.taxAmount)}</td>
                                            <td><strong>${App.formatCurrency(o.total)}</strong></td>
                                            <td class="text-muted">${App.formatDateTime(o.createdAt)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                                <tfoot>
                                    <tr style="background:var(--bg);font-weight:700;">
                                        <td colspan="2">Total</td>
                                        <td>${App.formatCurrency(summary.subtotal)}</td>
                                        <td>${App.formatCurrency(summary.taxTotal)}</td>
                                        <td>${App.formatCurrency(summary.revenue)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    ` : `
                        <div class="empty-state">
                            <span class="icon">📈</span>
                            <h3>No data for this period</h3>
                            <p>Try a different date range.</p>
                        </div>
                    `}

                    ${Auth.isAdmin() && orders.length > 0 ? renderCashierBreakdown(orders) : ''}
                </div>
            </div>

            ${workSummary.length ? renderHoursCard(workSummary, filterDateFrom, filterDateTo) : ''}
        `;

        // Bind events
        document.getElementById('rptDaily').addEventListener('click', () => {
            reportType = 'daily';
            filterDateFrom = today;
            filterDateTo = today;
            render();
        });
        document.getElementById('rptMonthly').addEventListener('click', () => {
            reportType = 'monthly';
            const d = new Date();
            filterDateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
            filterDateTo = today;
            render();
        });
        document.getElementById('rptCustom').addEventListener('click', () => {
            reportType = 'custom';
        });
        document.getElementById('rptApply').addEventListener('click', () => {
            filterDateFrom = document.getElementById('rptDateFrom').value;
            filterDateTo = document.getElementById('rptDateTo').value;
            const cashierSelect = document.getElementById('rptCashier');
            filterCashier = cashierSelect ? cashierSelect.value : '';
            render();
        });

        const cashierSelect = document.getElementById('rptCashier');
        if (cashierSelect) {
            cashierSelect.addEventListener('change', (e) => {
                filterCashier = e.target.value;
            });
        }

        const exportHoursBtn = document.getElementById('btnExportHoursCsv');
        if (exportHoursBtn) {
            exportHoursBtn.addEventListener('click', exportHoursCsv);
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
        // Non-admins only see their own orders
        if (!Auth.isAdmin()) {
            const user = Auth.currentUser();
            orders = orders.filter(o => o.userId === user.id);
        } else if (filterCashier) {
            orders = orders.filter(o => o.userId === filterCashier);
        }
        return orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    function getShiftsInRange() {
        let shifts = DB.getAll('shifts').filter(s => s.status === 'closed' && s.endTime);
        // Non-admins only see their own shifts
        if (!Auth.isAdmin()) {
            const user = Auth.currentUser();
            shifts = shifts.filter(s => s.userId === user.id);
        } else if (filterCashier) {
            shifts = shifts.filter(s => s.userId === filterCashier);
        }
        if (filterDateFrom) {
            shifts = shifts.filter(s => s.startTime && s.startTime.split('T')[0] >= filterDateFrom);
        }
        if (filterDateTo) {
            shifts = shifts.filter(s => s.startTime && s.startTime.split('T')[0] <= filterDateTo);
        }
        return shifts;
    }

    function renderHoursCard(summary, from, to) {
        const totalHours = summary.reduce((s, r) => s + r.hours, 0);
        const totalOt = summary.reduce((s, r) => s + r.otHours, 0);
        const totalPay = summary.reduce((s, r) => s + r.pay, 0);

        return `
            <div class="card" style="margin-top:20px;">
                <div class="card-header" style="flex-wrap:wrap;gap:10px;">
                    <h3>Working Hours & Overtime</h3>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="text-muted">${App.formatDate(from)} – ${App.formatDate(to)}</span>
                        <button class="btn btn-outline btn-sm" id="btnExportHoursCsv" title="Download per-cashier CSV">⬇ Export CSV</button>
                    </div>
                </div>
                <div class="card-body">
                    <div class="report-summary">
                        <div class="stat-card">
                            <div class="stat-icon orange">🕐</div>
                            <div class="stat-info">
                                <div class="stat-label">Working Hours</div>
                                <div class="stat-value">${totalHours.toFixed(2)}h</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon purple">⏱</div>
                            <div class="stat-info">
                                <div class="stat-label">Overtime Hours</div>
                                <div class="stat-value">${totalOt.toFixed(2)}h</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon green">💰</div>
                            <div class="stat-info">
                                <div class="stat-label">Est. Labor Cost</div>
                                <div class="stat-value">${App.formatCurrency(totalPay)}</div>
                            </div>
                        </div>
                    </div>

                    <div class="table-container" style="margin-top:16px;">
                        <table>
                            <thead>
                                <tr>
                                    <th>Cashier</th>
                                    <th>Shifts</th>
                                    <th>Hours</th>
                                    <th>OT Hours</th>
                                    <th>Gross Pay</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${summary.map(r => `
                                    <tr>
                                        <td><strong>${App.escapeHtml(r.name)}</strong></td>
                                        <td>${r.shifts}</td>
                                        <td>${r.hours.toFixed(2)}h</td>
                                        <td>${r.otHours > 0 ? `<span class="badge badge-warning">${r.otHours.toFixed(2)}h</span>` : '<span class="text-muted">0h</span>'}</td>
                                        <td><strong>${App.formatCurrency(r.pay)}</strong></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    function exportHoursCsv() {
        const workShifts = getShiftsInRange();
        const daysInRange = filterDateFrom && filterDateTo
            ? Math.round((new Date(`${filterDateTo}T23:59:59`) - new Date(`${filterDateFrom}T00:00:00`)) / 86400000) + 1
            : 1;
        const summary = workShifts.length ? Payroll.summaryForShifts(workShifts, daysInRange) : [];
        const totalHours = summary.reduce((s, r) => s + r.hours, 0);
        const totalOt = summary.reduce((s, r) => s + r.otHours, 0);
        const totalPay = summary.reduce((s, r) => s + r.pay, 0);

        const escape = c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`;
        const lines = [
            ['Cashier', 'Shifts', 'Hours', 'OT Hours', 'Gross Pay'],
            ...summary.map(r => [escape(r.name), r.shifts, r.hours.toFixed(2), r.otHours.toFixed(2), r.pay.toFixed(2)]),
            ['TOTALS', '', totalHours.toFixed(2), totalOt.toFixed(2), totalPay.toFixed(2)],
        ];
        const csv = lines.map(l => l.join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hours-${filterDateFrom || 'all'}-${filterDateTo || 'all'}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function renderCashierBreakdown(orders) {
        // Group orders by cashier
        const cashierMap = {};
        orders.forEach(o => {
            const key = o.userId || 'unknown';
            if (!cashierMap[key]) {
                cashierMap[key] = { name: o.userName || 'Unknown', count: 0, revenue: 0 };
            }
            cashierMap[key].count++;
            cashierMap[key].revenue += parseFloat(o.total) || 0;
        });

        const cashiers = Object.values(cashierMap).sort((a, b) => b.revenue - a.revenue);

        if (cashiers.length <= 1) return '';

        return `
            <div style="margin-top:24px;">
                <h4 style="margin-bottom:12px;">Cashier Performance</h4>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Cashier</th>
                                <th>Orders</th>
                                <th>Revenue</th>
                                <th>Avg Order Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cashiers.map(c => `
                                <tr>
                                    <td><strong>${App.escapeHtml(c.name)}</strong></td>
                                    <td>${c.count}</td>
                                    <td><strong>${App.formatCurrency(c.revenue)}</strong></td>
                                    <td>${App.formatCurrency(c.count > 0 ? c.revenue / c.count : 0)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function calcSummary(orders) {
        return {
            orderCount: orders.length,
            revenue: orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0),
            subtotal: orders.reduce((s, o) => s + (parseFloat(o.subtotal) || 0), 0),
            taxTotal: orders.reduce((s, o) => s + (parseFloat(o.taxAmount) || 0), 0),
        };
    }

    return { render };
})();
