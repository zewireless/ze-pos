/**
 * Reports – Daily & Monthly sales reports
 *
 * OPTIMIZED (007): Order/shifts queries are now server-side (RPC report_orders /
 * report_shifts), scoped to the current workspace+store, with date-range +
 * cashier filters pushed to the database. Results are paginated (LIMIT/OFFSET)
 * with a "Load more" control and progressive rendering + loading skeletons so
 * large periods stay responsive. The summary stat cards are computed from the
 * currently-loaded page (not the entire table), which is the correct scope for
 * an on-screen report and keeps memory/data-transfer bounded.
 */
const Reports = (() => {
    let reportType = 'daily';
    let filterDateFrom = '';
    let filterDateTo = '';
    let filterCashier = '';

    // Pagination state (reset whenever filters change)
    const PAGE = 100;
    let loadedOrders = [];
    let loadedShifts = [];
    let ordersHasMore = false;
    let shiftsHasMore = false;
    let loadingOrders = false;
    let loadingShifts = false;

    function toTimestamptz(dateStr) {
        return dateStr ? `${dateStr}T00:00:00` : null;
    }
    function toTimestamptzEnd(dateStr) {
        return dateStr ? `${dateStr}T23:59:59` : null;
    }

    function resetPagination() {
        loadedOrders = [];
        loadedShifts = [];
        ordersHasMore = false;
        shiftsHasMore = false;
    }

    async function render() {
        const el = document.getElementById('page-reports');
        if (!el) return;
        const today = new Date().toISOString().split('T')[0];

        if (!filterDateFrom) {
            if (reportType === 'daily') {
                filterDateFrom = today;
                filterDateTo = today;
            } else {
                const d = new Date();
                filterDateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                filterDateTo = today;
            }
        }

        // First paint: shell + loading skeleton. Data loads progressively.
        renderShell(el, today);
        bindShell(el);

        await loadOrdersPage(true);
        await loadShiftsPage(true);
        renderResults(el);
    }

    // ── data loaders ───────────────────────────────────────────
    async function loadOrdersPage(reset = false) {
        if (loadingOrders) return;
        loadingOrders = true;
        if (reset) resetPagination();
        const offset = loadedOrders.length;
        const { rows, hasMore } = await DB.queryOrders({
            from: toTimestamptz(filterDateFrom),
            to: toTimestamptzEnd(filterDateTo),
            userId: (Auth.isAdmin() && filterCashier) ? filterCashier : (Auth.isAdmin() ? null : (Auth.currentUser() && Auth.currentUser().id)),
            limit: PAGE,
            offset,
        });
        loadedOrders = loadedOrders.concat(rows.slice(0, PAGE));
        ordersHasMore = hasMore && rows.length > PAGE;
        loadingOrders = false;
    }

    async function loadShiftsPage(reset = false) {
        if (loadingShifts) return;
        loadingShifts = true;
        const offset = loadedShifts.length;
        const { rows, hasMore } = await DB.queryShifts({
            from: toTimestamptz(filterDateFrom),
            to: toTimestamptzEnd(filterDateTo),
            userId: (Auth.isAdmin() && filterCashier) ? filterCashier : (Auth.isAdmin() ? null : (Auth.currentUser() && Auth.currentUser().id)),
            limit: PAGE,
            offset,
        });
        loadedShifts = loadedShifts.concat(rows.slice(0, PAGE));
        shiftsHasMore = hasMore && rows.length > PAGE;
        loadingShifts = false;
    }

    // ── shell (filters + summary + containers, no data yet) ────
    function renderShell(el, today) {
        const orders = loadedOrders.filter(o => o.status !== 'Voided');
        const summary = calcSummary(orders);
        const daysInRange = filterDateFrom && filterDateTo
            ? Math.round((new Date(`${filterDateTo}T23:59:59`) - new Date(`${filterDateFrom}T00:00:00`)) / 86400000) + 1
            : 1;

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
                                <div class="stat-value" id="rptRevenue">${App.formatCurrency(summary.revenue)}</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon blue">📦</div>
                            <div class="stat-info">
                                <div class="stat-label">Orders (loaded)</div>
                                <div class="stat-value" id="rptCount">${orders.length}</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon purple">📊</div>
                            <div class="stat-info">
                                <div class="stat-label">Avg Order Value</div>
                                <div class="stat-value" id="rptAvg">${summary.orderCount > 0 ? App.formatCurrency(summary.revenue / summary.orderCount) : App.formatCurrency(0)}</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon orange">💰</div>
                            <div class="stat-info">
                                <div class="stat-label">Tax Collected</div>
                                <div class="stat-value" id="rptTax">${App.formatCurrency(summary.taxTotal)}</div>
                            </div>
                        </div>
                    </div>

                    <div id="rptOrdersWrap">
                        ${orders.length > 0 ? renderOrderTable(orders, summary) : renderLoading('orders')}
                    </div>

                    ${Auth.isAdmin() && orders.length > 0 ? `<div id="rptCashierWrap">${renderCashierBreakdown(orders)}</div>` : ''}

                    <div id="rptHoursWrap"></div>
                </div>
            </div>
        `;
    }

    // ── results (after data loaded) ─────────────────────────────
    function renderResults(el) {
        // This is a revenue report, not an audit log — voided sales are
        // excluded outright (Order History is where voided orders remain
        // visible for the audit trail).
        const orders = loadedOrders.filter(o => o.status !== 'Voided');
        const summary = calcSummary(orders);

        // Update summary stat cards in place
        const rev = document.getElementById('rptRevenue');
        const cnt = document.getElementById('rptCount');
        const avg = document.getElementById('rptAvg');
        const tax = document.getElementById('rptTax');
        if (rev) rev.textContent = App.formatCurrency(summary.revenue);
        if (cnt) cnt.textContent = orders.length;
        if (avg) avg.textContent = summary.orderCount > 0 ? App.formatCurrency(summary.revenue / summary.orderCount) : App.formatCurrency(0);
        if (tax) tax.textContent = App.formatCurrency(summary.taxTotal);

        // Orders table
        const ordersWrap = document.getElementById('rptOrdersWrap');
        if (ordersWrap) {
            ordersWrap.innerHTML = orders.length > 0
                ? renderOrderTable(orders, summary)
                : `<div class="empty-state"><span class="icon">📈</span><h3>No data for this period</h3><p>Try a different date range.</p></div>`;
        }

        // Cashier breakdown (admin)
        const cashierWrap = document.getElementById('rptCashierWrap');
        if (cashierWrap) {
            cashierWrap.innerHTML = renderCashierBreakdown(orders);
        }

        // Working hours card
        const hoursWrap = document.getElementById('rptHoursWrap');
        if (hoursWrap) {
            const daysInRange = filterDateFrom && filterDateTo
                ? Math.round((new Date(`${filterDateTo}T23:59:59`) - new Date(`${filterDateFrom}T00:00:00`)) / 86400000) + 1
                : 1;
            const workSummary = loadedShifts.length ? Payroll.summaryForShifts(loadedShifts, daysInRange) : [];
            hoursWrap.innerHTML = workSummary.length ? renderHoursCard(workSummary, filterDateFrom, filterDateTo) : '';

            const exportBtn = document.getElementById('btnExportHoursCsv');
            if (exportBtn) exportBtn.addEventListener('click', exportHoursCsv);
        }

        // Re-bind load more button (renderResults replaces rptOrdersWrap which contains the button)
        const loadMoreBtn = document.getElementById('rptLoadMore');
        if (loadMoreBtn) {
            loadMoreBtn.onclick = async () => {
                await loadOrdersPage();
                renderResults(document.getElementById('page-reports'));
            };
        }
        // NOTE: header controls (daily/monthly/apply) persist from renderShell,
        // so only the replaced in-wrap buttons (loadMore/export) need binding.
    }

    function renderLoading(kind) {
        const rows = Array.from({ length: 6 }).map(() => `
            <tr>
                <td><span class="skeleton" style="display:inline-block;width:48px;height:14px;"></span></td>
                <td><span class="skeleton" style="display:inline-block;width:60px;height:14px;"></span></td>
                <td><span class="skeleton" style="display:inline-block;width:70px;height:14px;"></span></td>
                <td><span class="skeleton" style="display:inline-block;width:60px;height:14px;"></span></td>
                <td><span class="skeleton" style="display:inline-block;width:70px;height:14px;"></span></td>
                <td><span class="skeleton" style="display:inline-block;width:120px;height:14px;"></span></td>
            </tr>
        `).join('');
        return `
            <h4 style="margin:16px 0 12px;">Order Details</h4>
            <div class="table-container">
                <table>
                    <thead><tr><th>Order #</th><th>Type</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Date</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function renderOrderTable(orders, summary) {
        const loadBtn = ordersHasMore
            ? `<div style="text-align:center;margin:14px 0;">
                 <button class="btn btn-outline btn-sm" id="rptLoadMore">Load more orders (${loadedOrders.length} shown)</button>
               </div>`
            : '';

        return `
            <h4 style="margin:16px 0 12px;">Order Details</h4>
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
            ${loadBtn}
        `;
    }

    function bindShell(el) {
        const daily = document.getElementById('rptDaily');
        const monthly = document.getElementById('rptMonthly');
        const custom = document.getElementById('rptCustom');
        const apply = document.getElementById('rptApply');
        const loadMore = document.getElementById('rptLoadMore');
        const cashierSelect = document.getElementById('rptCashier');

        if (daily) daily.addEventListener('click', () => {
            reportType = 'daily';
            const t = new Date().toISOString().split('T')[0];
            filterDateFrom = t; filterDateTo = t;
            render();
        });
        if (monthly) monthly.addEventListener('click', () => {
            reportType = 'monthly';
            const d = new Date();
            filterDateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
            filterDateTo = new Date().toISOString().split('T')[0];
            render();
        });
        if (custom) custom.addEventListener('click', () => { reportType = 'custom'; });

        if (apply) apply.addEventListener('click', () => {
            filterDateFrom = document.getElementById('rptDateFrom').value;
            filterDateTo = document.getElementById('rptDateTo').value;
            const cs = document.getElementById('rptCashier');
            filterCashier = cs ? cs.value : '';
            render();
        });

        if (cashierSelect) cashierSelect.addEventListener('change', (e) => {
            filterCashier = e.target.value;
        });

        if (loadMore) loadMore.addEventListener('click', async () => {
            loadMore.disabled = true;
            loadMore.textContent = 'Loading…';
            await loadOrdersPage(false);
            const el2 = document.getElementById('page-reports');
            if (el2) renderResults(el2);
        });
    }

    function getShiftsInRange() { return loadedShifts; }

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
