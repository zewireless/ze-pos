/**
 * Payroll – Working hours & salary computation from closed shifts
 *
 * Rules:
 *  - Working hours come from CLOSED shifts only (open shifts have no end time).
 *  - Hourly cashiers: gross pay = hours × hourly rate.
 *    A shift can carry its own payRate override (set from the Shifts page);
 *    if present, that rate is used for the shift instead of the cashier's rate.
 *  - Overtime (optional): hours beyond the daily threshold (per calendar day)
 *    and the weekly threshold are paid at the OT multiplier. The weekly excess
 *    is counted only above what daily OT already covered (no double pay).
 *  - Fixed cashiers: flat per-week salary, prorated by days in the selected range,
 *    only when they actually worked (≥1 closed shift) in the period.
 *  - Runs can be saved to the 'payrolls' table and marked paid/unpaid.
 */
const Payroll = (() => {
    let fromDate = '';
    let toDate = '';

    // ── date helpers ──────────────────────────────────────────
    function pad(n) { return String(n).padStart(2, '0'); }
    function toLocalDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function startOfWeek(d) {
        const m = new Date(d);
        const day = d.getDay() === 0 ? 7 : d.getDay();
        m.setDate(m.getDate() - (day - 1));
        m.setHours(0, 0, 0, 0);
        return m;
    }
    function round2(n) { return Math.round(n * 100) / 100; }
    function formatHours(h) { return `${h.toFixed(2)}h`; }

    // ── computation ───────────────────────────────────────────
    function hoursForShift(shift) {
        const start = new Date(shift.startTime).getTime();
        const end = new Date(shift.endTime).getTime();
        if (!isFinite(start) || !isFinite(end) || end <= start) return 0;
        return (end - start) / 3600000;
    }

    function getClosedShiftsInRange(rangeStart, rangeEnd) {
        return DB.getAll('shifts')
            .filter(s => {
                if (s.status !== 'closed' || !s.endTime) return false;
                const end = new Date(s.endTime).getTime();
                return end >= rangeStart.getTime() && end <= rangeEnd.getTime();
            })
            .sort((a, b) => new Date(a.endTime) - new Date(b.endTime));
    }

    function getOvertimeRules() {
        return {
            enabled: DB.getSetting('overtime_enabled') === '1',
            dailyThreshold: parseFloat(DB.getSetting('overtime_daily_threshold')) || 8,
            weeklyThreshold: parseFloat(DB.getSetting('overtime_weekly_threshold')) || 40,
            multiplier: parseFloat(DB.getSetting('overtime_multiplier')) || 1.5,
        };
    }

    // Per-shift rate: shift.payRate overrides the cashier's hourly rate when set.
    function effectiveRate(shift, user) {
        const override = parseFloat(shift && shift.payRate);
        if (isFinite(override) && override > 0) return override;
        return parseFloat(user.hourlyRate) || 0;
    }

    function computeOvertime(shifts, rules) {
        let total = 0;
        const byDay = {};
        shifts.forEach(s => {
            const h = hoursForShift(s);
            total += h;
            const dayKey = new Date(s.startTime).toDateString();
            byDay[dayKey] = (byDay[dayKey] || 0) + h;
        });

        let dailyOt = 0;
        if (rules.enabled && rules.dailyThreshold > 0) {
            Object.keys(byDay).forEach(k => {
                dailyOt += Math.max(0, byDay[k] - rules.dailyThreshold);
            });
        }

        let weeklyOtExtra = 0;
        if (rules.enabled && rules.weeklyThreshold > 0) {
            const weeklyOtTotal = Math.max(0, total - rules.weeklyThreshold);
            weeklyOtExtra = Math.max(0, weeklyOtTotal - dailyOt);
        }

        return { dailyOt: round2(dailyOt), weeklyOtExtra: round2(weeklyOtExtra), otHours: round2(dailyOt + weeklyOtExtra) };
    }

    function computeRow(user, shifts, daysInRange, rules) {
        rules = rules || { enabled: false, dailyThreshold: 8, weeklyThreshold: 40, multiplier: 1.5 };
        const mine = shifts.filter(s => s.userId === user.id);
        const hours = round2(mine.reduce((sum, s) => sum + hoursForShift(s), 0));
        const payType = user.payType === 'fixed' ? 'fixed' : 'hourly';
        const hourlyRate = parseFloat(user.hourlyRate) || 0;
        const fixedSalary = parseFloat(user.fixedSalary) || 0;

        let pay = 0;
        let otHours = 0;

        if (payType === 'hourly') {
            // Base pay respects per-shift rate overrides
            const basePay = round2(mine.reduce((sum, s) => sum + hoursForShift(s) * effectiveRate(s, user), 0));
            if (rules.enabled) {
                const ot = computeOvertime(mine, rules);
                otHours = ot.otHours;
                // Premium on OT hours at the cashier's standard rate
                pay = round2(basePay + otHours * hourlyRate * (rules.multiplier - 1));
            } else {
                pay = basePay;
            }
        } else if (mine.length > 0) {
            pay = round2(fixedSalary * (daysInRange / 7));
        }

        return { user, shifts: mine, hours, otHours, payType, hourlyRate, fixedSalary, pay };
    }

    // Daily overtime hours for a cashier on a given date (YYYY-MM-DD), consistent
    // with payroll's daily rule: sum of that day's closed shifts minus the threshold.
    function dailyOtForDate(userId, dateStr) {
        const rules = getOvertimeRules();
        if (!rules.enabled) return 0;
        const dayShifts = DB.getAll('shifts').filter(s =>
            s.userId === userId &&
            s.status === 'closed' &&
            s.endTime &&
            s.startTime &&
            s.startTime.split('T')[0] === dateStr
        );
        if (dayShifts.length === 0) return 0;
        return computeOvertime(dayShifts, rules).dailyOt;
    }

    // Aggregate closed shifts by cashier (used by the Shifts & Reports pages).
    function summaryForShifts(shifts, daysInRange) {
        const rules = getOvertimeRules();
        const userIds = [...new Set(shifts.map(s => s.userId))];
        return userIds
            .map(userId => {
                const u = DB.getById('users', userId);
                if (!u) return null;
                const row = computeRow(u, shifts, daysInRange, rules);
                return {
                    userId,
                    name: u.name,
                    shifts: row.shifts.length,
                    hours: row.hours,
                    otHours: row.otHours,
                    pay: row.pay,
                    payType: row.payType,
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.pay - a.pay);
    }

    // ── shared period math ────────────────────────────────────
    function periodBounds() {
        const rangeStart = new Date(`${fromDate}T00:00:00`);
        const rangeEnd = new Date(`${toDate}T23:59:59`);
        const daysInRange = Math.round((rangeEnd - rangeStart) / 86400000) + 1;
        return { rangeStart, rangeEnd, daysInRange };
    }

    function buildRows(shifts, daysInRange) {
        const rules = getOvertimeRules();
        const cashiers = DB.getAll('users').filter(u => u.role === 'cashier' && u.enabled !== false);
        return cashiers
            .map(u => computeRow(u, shifts, daysInRange, rules))
            .sort((a, b) => b.pay - a.pay);
    }

    function restaurantName() {
        return DB.getSetting('restaurant_name') || 'ZE-POS';
    }

    // ── render ────────────────────────────────────────────────
    function render() {
        const el = document.getElementById('page-payroll');
        if (!Auth.isAdmin()) return;

        const now = new Date();
        if (!fromDate || !toDate) {
            fromDate = toLocalDateStr(startOfWeek(now));
            toDate = toLocalDateStr(now);
        }

        const { rangeStart, rangeEnd, daysInRange } = periodBounds();
        const shifts = getClosedShiftsInRange(rangeStart, rangeEnd);
        const rows = buildRows(shifts, daysInRange);
        const rules = getOvertimeRules();

        const totalHours = round2(rows.reduce((s, r) => s + r.hours, 0));
        const totalOt = round2(rows.reduce((s, r) => s + r.otHours, 0));
        const totalPay = round2(rows.reduce((s, r) => s + r.pay, 0));

        const openCount = DB.getAll('shifts').filter(s =>
            s.status === 'open' &&
            new Date(s.startTime).getTime() <= rangeEnd.getTime()
        ).length;

        const runs = DB.getAll('payrolls')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        document.getElementById('headerActions').innerHTML = `
            <button class="btn btn-outline btn-sm no-print" id="btnPrintPayroll" title="Print payroll sheet">🖨 Print</button>
            <button class="btn btn-outline btn-sm no-print" id="btnExportCsv" title="Download CSV">⬇ CSV</button>
            <button class="btn btn-primary no-print" id="btnSaveRun">💾 Save Payroll Run</button>
        `;

        el.innerHTML = `
            <div class="print-only" style="margin-bottom:16px;">
                <h2 style="margin-bottom:4px;">${App.escapeHtml(restaurantName())}</h2>
                <p class="text-muted" style="margin:0;">Payroll Report — ${App.formatDate(fromDate)} to ${App.formatDate(toDate)} · Generated ${App.formatDateTime(new Date().toISOString())}</p>
            </div>

            <div class="card no-print" style="margin-bottom:20px;">
                <div class="card-header" style="flex-wrap:wrap;gap:10px;">
                    <h3>Payroll Period</h3>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        <button class="btn btn-sm ${fromDate === toLocalDateStr(startOfWeek(now)) && toDate === toLocalDateStr(now) ? 'btn-primary' : 'btn-outline'}" id="ppThisWeek">This Week</button>
                        <button class="btn btn-sm btn-outline" id="ppThisMonth">This Month</button>
                        <button class="btn btn-sm btn-outline" id="ppLast30">Last 30 Days</button>
                        <input type="date" class="form-control" id="ppFrom" value="${fromDate}" style="width:160px;">
                        <span class="text-muted">to</span>
                        <input type="date" class="form-control" id="ppTo" value="${toDate}" style="width:160px;">
                        <button class="btn btn-primary btn-sm" id="ppApply">Apply</button>
                    </div>
                </div>
            </div>

            ${renderOtRulesCard(rules)}

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue">👥</div>
                    <div class="stat-info">
                        <div class="stat-label">Cashiers</div>
                        <div class="stat-value">${rows.length}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon orange">🕐</div>
                    <div class="stat-info">
                        <div class="stat-label">Total Hours</div>
                        <div class="stat-value">${formatHours(totalHours)}</div>
                    </div>
                </div>
                ${rules.enabled ? `
                    <div class="stat-card">
                        <div class="stat-icon purple">⏱</div>
                        <div class="stat-info">
                            <div class="stat-label">Overtime Hours</div>
                            <div class="stat-value">${formatHours(totalOt)}</div>
                        </div>
                    </div>
                ` : ''}
                <div class="stat-card">
                    <div class="stat-icon green">💰</div>
                    <div class="stat-info">
                        <div class="stat-label">Total Gross Pay</div>
                        <div class="stat-value">${App.formatCurrency(totalPay)}</div>
                    </div>
                </div>
            </div>

            ${openCount ? `<p class="form-hint" style="margin:10px 0 0;">Note: ${openCount} open shift(s) started in this period are not included until they are ended.</p>` : ''}

            <div class="card" style="margin-top:20px;">
                <div class="card-header">
                    <h3>Salary Summary (${App.formatDate(fromDate)} – ${App.formatDate(toDate)})</h3>
                    ${rules.enabled ? `<span class="badge badge-primary">Overtime ${rules.multiplier}× after ${rules.dailyThreshold}h/day · ${rules.weeklyThreshold}h/wk</span>` : ''}
                </div>
                <div class="card-body" style="padding:0;">
                    ${rows.length === 0
                        ? '<div class="empty-state"><span class="icon">💰</span><h3>No cashiers yet</h3><p>Add cashiers from the Staff page to build payroll.</p></div>'
                        : renderSummaryTable(rows, daysInRange)
                    }
                </div>
            </div>

            ${renderRunsCard(runs)}

            ${shifts.length ? renderDetailTable(shifts) : ''}
        `;

        bindEvents();
    }

    function renderOtRulesCard(rules) {
        return `
            <div class="card no-print" style="margin-bottom:20px;">
                <div class="card-header">
                    <h3>Overtime Rules</h3>
                    <span class="badge ${rules.enabled ? 'badge-success' : 'badge-warning'}">${rules.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div class="card-body">
                    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;">
                        <label class="sch-day" style="margin:0;">
                            <input type="checkbox" id="otEnabled" ${rules.enabled ? 'checked' : ''}> Enable overtime pay
                        </label>
                        <div class="form-group" style="margin:0;">
                            <label>Daily threshold (hrs)</label>
                            <input type="number" class="form-control" id="otDaily" style="width:110px;" value="${rules.dailyThreshold}" step="0.5" min="0">
                        </div>
                        <div class="form-group" style="margin:0;">
                            <label>Weekly threshold (hrs)</label>
                            <input type="number" class="form-control" id="otWeekly" style="width:110px;" value="${rules.weeklyThreshold}" step="0.5" min="0">
                        </div>
                        <div class="form-group" style="margin:0;">
                            <label>OT multiplier (e.g. 1.5)</label>
                            <input type="number" class="form-control" id="otMult" style="width:110px;" value="${rules.multiplier}" step="0.05" min="1">
                        </div>
                        <button class="btn btn-primary btn-sm" id="otSave">Save Rules</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderSummaryTable(rows) {
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Cashier</th>
                            <th>Shifts</th>
                            <th>Hours</th>
                            <th>Rate / Salary (edit)</th>
                            <th>Gross Pay</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <div class="sidebar-avatar" style="width:32px;height:32px;font-size:13px;flex-shrink:0;">
                                            ${App.escapeHtml(r.user.name.charAt(0).toUpperCase())}
                                        </div>
                                        <div>
                                            <strong>${App.escapeHtml(r.user.name)}</strong>
                                            <div class="shift-meta">${r.payType === 'fixed' ? 'Fixed · per week' : 'Hourly'}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>${r.shifts.length}</td>
                                <td>
                                    ${formatHours(r.hours)}
                                    ${r.otHours > 0 ? `<div class="shift-meta" style="color:var(--warning);font-weight:600;">+ ${formatHours(r.otHours)} OT</div>` : ''}
                                </td>
                                <td>
                                    ${r.payType === 'fixed'
                                        ? `<input type="number" class="form-control payroll-rate" data-cashier="${r.user.id}" data-field="fixedSalary" value="${r.fixedSalary}" step="0.01" min="0" title="Weekly salary" aria-label="Weekly salary">`
                                        : `<input type="number" class="form-control payroll-rate" data-cashier="${r.user.id}" data-field="hourlyRate" value="${r.hourlyRate}" step="0.01" min="0" title="Hourly rate" aria-label="Hourly rate">`
                                    }
                                </td>
                                <td><strong>${App.formatCurrency(r.pay)}</strong></td>
                            </tr>
                        `).join('')}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="2"><strong>Totals</strong></td>
                            <td><strong>${formatHours(rows.reduce((s, r) => s + r.hours, 0))}${rows.reduce((s, r) => s + r.otHours, 0) > 0 ? ` <span class="badge badge-warning">+${formatHours(rows.reduce((s, r) => s + r.otHours, 0))} OT</span>` : ''}</strong></td>
                            <td></td>
                            <td><strong>${App.formatCurrency(rows.reduce((s, r) => s + r.pay, 0))}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    }

    // ── payroll runs (history + mark as paid) ─────────────────
    function renderRunsCard(runs) {
        const unpaid = runs.filter(r => r.status !== 'paid');
        return `
            <div class="card" style="margin-top:20px;">
                <div class="card-header">
                    <h3>Payroll Runs (${runs.length})</h3>
                    ${unpaid.length ? `<button class="btn btn-success btn-sm no-print" id="btnMarkAllPaid">✓ Mark All Paid (${unpaid.length})</button>` : ''}
                </div>
                <div class="card-body" style="padding:0;">
                    ${runs.length === 0
                        ? '<div class="empty-state"><span class="icon">🗂</span><h3>No payroll runs saved</h3><p>Click "Save Payroll Run" to lock in this period for payment tracking.</p></div>'
                        : `
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Period</th>
                                        <th>Cashiers</th>
                                        <th>Total</th>
                                        <th>Status</th>
                                        <th>Created</th>
                                        <th style="text-align:right;">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${runs.map(r => `
                                        <tr>
                                            <td><strong>${App.formatDate(r.fromDate)}</strong> – ${App.formatDate(r.toDate)}</td>
                                            <td>${(r.items || []).length}</td>
                                            <td><strong>${App.formatCurrency(r.totalPay)}</strong></td>
                                            <td>
                                                <span class="badge ${r.status === 'paid' ? 'badge-success' : 'badge-warning'}">
                                                    ${r.status === 'paid' ? (r.paidAt ? 'Paid · ' + App.formatDate(r.paidAt) : 'Paid') : 'Unpaid'}
                                                </span>
                                            </td>
                                            <td class="text-muted">${App.formatDateTime(r.createdAt)}</td>
                                            <td class="text-right">
                                                <div class="btn-group no-print" style="justify-content:flex-end;">
                                                    ${r.status === 'paid'
                                                        ? `<button class="btn btn-outline btn-sm" data-action="run-unpaid" data-id="${r.id}">↩ Mark Unpaid</button>`
                                                        : `<button class="btn btn-success btn-sm" data-action="run-paid" data-id="${r.id}">✓ Mark Paid</button>`
                                                    }
                                                    <button class="btn btn-outline btn-sm" data-action="run-view" data-id="${r.id}">View</button>
                                                    <button class="btn btn-ghost btn-sm" data-action="run-delete" data-id="${r.id}" style="color:var(--danger);">🗑</button>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        `
                    }
                </div>
            </div>
        `;
    }

    function viewRun(id) {
        const run = DB.getById('payrolls', id);
        if (!run) return;
        App.openModal(`
            <div class="modal-header">
                <h3>Payroll Run — ${App.formatDate(run.fromDate)} to ${App.formatDate(run.toDate)}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom:16px;">
                    <span class="badge ${run.status === 'paid' ? 'badge-success' : 'badge-warning'}">
                        ${run.status === 'paid' ? 'Paid' + (run.paidAt ? ' · ' + App.formatDateTime(run.paidAt) : '') : 'Unpaid'}
                    </span>
                </p>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Cashier</th>
                                <th>Hours</th>
                                <th>OT</th>
                                <th>Pay</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(run.items || []).map(it => `
                                <tr>
                                    <td><strong>${App.escapeHtml(it.name)}</strong></td>
                                    <td>${formatHours(it.hours)}</td>
                                    <td>${it.otHours ? formatHours(it.otHours) : '—'}</td>
                                    <td>${App.formatCurrency(it.pay)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="3"><strong>Total</strong></td>
                                <td><strong>${App.formatCurrency(run.totalPay)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
            </div>
        `);
    }

    async function saveRun() {
        const { rangeStart, rangeEnd, daysInRange } = periodBounds();
        const shifts = getClosedShiftsInRange(rangeStart, rangeEnd);
        const rows = buildRows(shifts, daysInRange);
        const items = rows
            .map(r => ({
                userId: r.user.id,
                name: r.user.name,
                hours: r.hours,
                otHours: r.otHours,
                pay: r.pay,
                payType: r.payType,
                rate: r.payType === 'fixed' ? r.fixedSalary : r.hourlyRate,
            }))
            .filter(it => it.pay > 0);
        const total = round2(items.reduce((s, i) => s + i.pay, 0));

        if (items.length === 0) {
            App.toast('No payable shifts in this period', 'error');
            return;
        }

        const yes = await App.confirm(
            'Save Payroll Run?',
            `Save payroll for ${App.formatDate(fromDate)} – ${App.formatDate(toDate)}?\nTotal: ${App.formatCurrency(total)}`,
            'Save'
        );
        if (yes) {
            const run = DB.insert('payrolls', {
                fromDate,
                toDate,
                status: 'unpaid',
                totalPay: total,
                items,
                createdAt: new Date().toISOString(),
                paidAt: null,
            });
            DB.logAction('payroll_run_save', 'payrolls', run.id, { fromDate, toDate, totalPay: total, cashiers: items.length });
            App.toast('Payroll run saved');
            render();
        }
    }

    async function togglePaid(id) {
        const run = DB.getById('payrolls', id);
        if (!run) return;
        const markPaid = run.status !== 'paid';
        if (markPaid) {
            const yes = await App.confirm('Mark as Paid?', `Mark the payroll run for ${App.formatDate(run.fromDate)} – ${App.formatDate(run.toDate)} (${App.formatCurrency(run.totalPay)}) as paid?`, 'Mark Paid');
            if (!yes) return;
            DB.update('payrolls', id, { status: 'paid', paidAt: new Date().toISOString() });
            DB.logAction('payroll_mark_paid', 'payrolls', id, { fromDate: run.fromDate, toDate: run.toDate, totalPay: run.totalPay });
            App.toast('Payroll marked as paid');
        } else {
            DB.update('payrolls', id, { status: 'unpaid', paidAt: null });
            DB.logAction('payroll_mark_unpaid', 'payrolls', id, { fromDate: run.fromDate, toDate: run.toDate });
            App.toast('Payroll marked as unpaid');
        }
        render();
    }

    async function markAllPaid() {
        const unpaid = DB.getAll('payrolls').filter(r => r.status !== 'paid');
        if (unpaid.length === 0) return;
        const total = round2(unpaid.reduce((s, r) => s + (r.totalPay || 0), 0));
        const yes = await App.confirm(
            'Mark All As Paid?',
            `Mark ${unpaid.length} unpaid payroll run(s) (total ${App.formatCurrency(total)}) as paid?`,
            'Mark All Paid'
        );
        if (!yes) return;
        const nowIso = new Date().toISOString();
        unpaid.forEach(r => DB.update('payrolls', r.id, { status: 'paid', paidAt: nowIso }));
        DB.logAction('payroll_mark_all_paid', 'payrolls', null, { count: unpaid.length, totalPay: total });
        App.toast(`${unpaid.length} payroll run(s) marked as paid`);
        render();
    }

    async function deleteRun(id) {
        const run = DB.getById('payrolls', id);
        if (!run) return;
        const yes = await App.confirm('Delete Payroll Run?', `Delete the run for ${App.formatDate(run.fromDate)} – ${App.formatDate(run.toDate)}?`, 'Delete');
        if (yes) {
            DB.remove('payrolls', id);
            DB.logAction('payroll_run_delete', 'payrolls', id, { fromDate: run.fromDate, toDate: run.toDate, totalPay: run.totalPay });
            App.toast('Payroll run deleted');
            render();
        }
    }

    // ── export / print ────────────────────────────────────────
    function doPrint() {
        window.print();
    }

    function exportCsv() {
        const { rangeStart, rangeEnd, daysInRange } = periodBounds();
        const rows = buildRows(getClosedShiftsInRange(rangeStart, rangeEnd), daysInRange);

        const escape = c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`;
        const lines = [
            [escape(restaurantName()), '', '', '', '', ''],
            [escape(`Payroll ${fromDate} to ${toDate}`), '', '', '', '', ''],
            [],
            ['Cashier', 'Shifts', 'Hours', 'OT Hours', 'Rate', 'Gross Pay'],
        ];
        rows.forEach(r => {
            lines.push([
                escape(r.user.name),
                r.shifts.length,
                r.hours.toFixed(2),
                r.otHours.toFixed(2),
                r.payType === 'fixed' ? `${r.fixedSalary.toFixed(2)}/wk` : `${r.hourlyRate.toFixed(2)}/hr`,
                r.pay.toFixed(2),
            ]);
        });
        lines.push(['TOTALS', '', rows.reduce((s, r) => s + r.hours, 0).toFixed(2), rows.reduce((s, r) => s + r.otHours, 0).toFixed(2), '', rows.reduce((s, r) => s + r.pay, 0).toFixed(2)]);

        const csv = lines.map(l => l.join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `payroll-${fromDate}-${toDate}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // ── detail table ──────────────────────────────────────────
    function renderDetailTable(shifts) {
        const nameOf = (id) => {
            const u = DB.getById('users', id);
            return u ? u.name : 'Deleted user';
        };
        const payTypeOf = (id) => {
            const u = DB.getById('users', id);
            return u ? (u.payType === 'fixed' ? 'fixed' : 'hourly') : 'hourly';
        };
        const rateFor = (s) => {
            const u = DB.getById('users', s.userId);
            return u ? effectiveRate(s, u) : 0;
        };

        return `
            <div class="card no-print" style="margin-top:20px;">
                <div class="card-header">
                    <h3>Shift Details (${shifts.length})</h3>
                </div>
                <div class="card-body" style="padding:0;">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Cashier</th>
                                    <th>Shift Start</th>
                                    <th>Shift End</th>
                                    <th>Hours</th>
                                    <th>Rate</th>
                                    <th>Gross Pay</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${shifts.map(s => {
                                    const hours = round2(hoursForShift(s));
                                    const isFixed = payTypeOf(s.userId) === 'fixed';
                                    const rate = rateFor(s);
                                    const pay = isFixed ? 0 : round2(hours * rate);
                                    return `
                                        <tr>
                                            <td><strong>${App.escapeHtml(nameOf(s.userId))}</strong></td>
                                            <td>${App.formatDateTime(s.startTime)}</td>
                                            <td>${App.formatDateTime(s.endTime)}</td>
                                            <td>${formatHours(hours)}</td>
                                            <td>${isFixed ? '<span class="text-muted">fixed</span>' : App.formatCurrency(rate)}</td>
                                            <td>${isFixed ? '<span class="text-muted">included</span>' : App.formatCurrency(pay)}</td>
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

    // ── events ────────────────────────────────────────────────
    function bindEvents() {
        const todayStr = toLocalDateStr(new Date());
        const mondayStr = toLocalDateStr(startOfWeek(new Date()));

        const setRange = (from, to) => {
            fromDate = from;
            toDate = to;
            render();
        };

        document.getElementById('ppThisWeek').addEventListener('click', () => setRange(mondayStr, todayStr));
        document.getElementById('ppThisMonth').addEventListener('click', () => setRange(`${todayStr.slice(0, 7)}-01`, todayStr));
        document.getElementById('ppLast30').addEventListener('click', () => {
            const d = new Date();
            d.setDate(d.getDate() - 29);
            setRange(toLocalDateStr(d), todayStr);
        });
        document.getElementById('ppApply').addEventListener('click', () => {
            const from = document.getElementById('ppFrom').value;
            const to = document.getElementById('ppTo').value;
            if (!from || !to) { App.toast('Select a start and end date', 'error'); return; }
            if (from > to) { App.toast('Start date must be before end date', 'error'); return; }
            setRange(from, to);
        });

        // Overtime rules
        document.getElementById('otSave').addEventListener('click', () => {
            const daily = parseFloat(document.getElementById('otDaily').value);
            const weekly = parseFloat(document.getElementById('otWeekly').value);
            const mult = parseFloat(document.getElementById('otMult').value);
            if (daily < 0 || weekly < 0 || mult < 1) {
                App.toast('Check threshold and multiplier values', 'error');
                return;
            }
            DB.setSetting('overtime_enabled', document.getElementById('otEnabled').checked ? '1' : '0');
            DB.setSetting('overtime_daily_threshold', String(daily || 8));
            DB.setSetting('overtime_weekly_threshold', String(weekly || 40));
            DB.setSetting('overtime_multiplier', String(mult || 1.5));
            App.toast('Overtime rules saved');
            render();
        });

        // Header actions
        document.getElementById('btnSaveRun').addEventListener('click', saveRun);
        document.getElementById('btnPrintPayroll').addEventListener('click', doPrint);
        document.getElementById('btnExportCsv').addEventListener('click', exportCsv);

        // Payroll runs
        const markAllBtn = document.getElementById('btnMarkAllPaid');
        if (markAllBtn) markAllBtn.addEventListener('click', markAllPaid);
        document.querySelectorAll('[data-action="run-paid"]').forEach(btn => {
            btn.addEventListener('click', () => togglePaid(btn.dataset.id));
        });
        document.querySelectorAll('[data-action="run-unpaid"]').forEach(btn => {
            btn.addEventListener('click', () => togglePaid(btn.dataset.id));
        });
        document.querySelectorAll('[data-action="run-view"]').forEach(btn => {
            btn.addEventListener('click', () => viewRun(btn.dataset.id));
        });
        document.querySelectorAll('[data-action="run-delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteRun(btn.dataset.id));
        });

        // Inline rate/salary editing
        document.querySelectorAll('.payroll-rate').forEach(input => {
            input.addEventListener('change', () => {
                const userId = input.dataset.cashier;
                const field = input.dataset.field;
                const value = Math.max(0, parseFloat(input.value) || 0);
                DB.update('users', userId, { [field]: value });
                App.toast(field === 'hourlyRate' ? 'Hourly rate updated' : 'Salary updated');
                render();
            });
        });
    }

    return {
        render,
        round2,
        hoursForShift,
        getClosedShiftsInRange,
        computeRow,
        effectiveRate,
        computeOvertime,
        getOvertimeRules,
        summaryForShifts,
        dailyOtForDate,
    };
})();
