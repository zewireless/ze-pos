/**
 * Shifts – Manual shift lifecycle management and history
 * Includes: break tracking, shift notes/handover log
 */
const Shifts = (() => {
    let filterStatus = '';
    let filterDateFrom = '';
    let filterDateTo = '';
    let activeBreakTimer = null;
    let breakTimerInterval = null;

    function render() {
        const el = document.getElementById('page-shifts');
        const user = Auth.currentUser();
        const today = new Date().toISOString().split('T')[0];

        if (!filterDateFrom) {
            filterDateFrom = today;
            filterDateTo = today;
        }

        const shifts = getFilteredShifts();
        const openShift = getOpenShift(user.id);

        // Hours & OT summary for the filtered period (closed shifts only)
        const daysInRange = filterDateFrom && filterDateTo
            ? Math.round((new Date(`${filterDateTo}T23:59:59`) - new Date(`${filterDateFrom}T00:00:00`)) / 86400000) + 1
            : 1;
        const closedShifts = shifts.filter(s => s.status === 'closed' && s.endTime);
        const workSummary = closedShifts.length ? Payroll.summaryForShifts(closedShifts, daysInRange) : [];

        el.innerHTML = `
            ${openShift ? `
                <div class="card" style="margin-bottom:20px;">
                    <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <span class="badge badge-success" style="font-size:0.85rem;">● Shift Active</span>
                            <span>Started <strong>${App.formatDateTime(openShift.startTime)}</strong></span>
                        </div>
                        <button class="btn btn-danger btn-sm" data-action="end-shift-page" data-id="${openShift.id}">End Shift</button>
                    </div>
                </div>
            ` : ''}

            ${workSummary.length ? renderWorkSummaryCard(workSummary) : ''}

            ${!Auth.isAdmin() ? renderMyScheduleCard(user.id) : ''}

            <div class="card">
                <div class="card-header">
                    <h3>Shift History (${shifts.length})</h3>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        <select class="form-control" id="shiftFilterStatus" style="width:140px;">
                            <option value="">All Status</option>
                            <option value="open" ${filterStatus === 'open' ? 'selected' : ''}>Open</option>
                            <option value="closed" ${filterStatus === 'closed' ? 'selected' : ''}>Closed</option>
                        </select>
                        <input type="date" class="form-control" id="shiftDateFrom" value="${filterDateFrom}" style="width:150px;">
                        <span class="text-muted">to</span>
                        <input type="date" class="form-control" id="shiftDateTo" value="${filterDateTo}" style="width:150px;">
                        <button class="btn btn-primary btn-sm" id="shiftApply">Apply</button>
                    </div>
                </div>
                <div class="card-body" style="padding:0;">
                    ${shifts.length === 0
                        ? '<div class="empty-state"><span class="icon">🕐</span><h3>No shifts found</h3><p>Start a shift from the POS screen to begin tracking.</p></div>'
                        : renderTable(shifts)
                    }
                </div>
            </div>
        `;

        // Bind events
        document.getElementById('shiftFilterStatus').addEventListener('change', (e) => {
            filterStatus = e.target.value;
        });
        document.getElementById('shiftApply').addEventListener('click', () => {
            filterStatus = document.getElementById('shiftFilterStatus').value;
            filterDateFrom = document.getElementById('shiftDateFrom').value;
            filterDateTo = document.getElementById('shiftDateTo').value;
            render();
        });

        el.querySelectorAll('[data-action="view-shift"]').forEach(btn => {
            btn.addEventListener('click', () => viewShift(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="end-shift-page"]').forEach(btn => {
            btn.addEventListener('click', () => openEndShiftModal(btn.dataset.id));
        });
    }

    function renderTable(shifts) {
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Cashier</th>
                            <th>Started</th>
                            <th>Ended</th>
                            <th>Status</th>
                            <th>Orders</th>
                            <th>Total Sales</th>
                            <th>Cash Float</th>
                            <th>Difference</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${shifts.map(s => {
                            const diffClass = s.cashDifference === null ? '' :
                                s.cashDifference === 0 ? 'cash-balanced' :
                                s.cashDifference < 0 ? 'cash-shortage' : 'cash-overage';
                            return `
                                <tr>
                                    <td><strong>${App.escapeHtml(s.userName)}</strong></td>
                                    <td class="text-muted">${App.formatDateTime(s.startTime)}</td>
                                    <td class="text-muted">${s.endTime ? App.formatDateTime(s.endTime) : '—'}</td>
                                    <td>
                                        <span class="badge ${s.status === 'open' ? 'badge-warning' : 'badge-success'}">
                                            ${s.status === 'open' ? 'Open' : 'Closed'}
                                        </span>
                                    </td>
                                    <td>${s.orderCount != null ? s.orderCount : '—'}</td>
                                    <td><strong>${s.totalSales != null ? App.formatCurrency(s.totalSales) : '—'}</strong></td>
                                    <td>${App.formatCurrency(s.startingCash || 0)}</td>
                                    <td class="${diffClass}">
                                        ${s.cashDifference !== null && s.cashDifference !== undefined
                                            ? (s.cashDifference === 0 ? 'Balanced' : App.formatCurrency(s.cashDifference))
                                            : 'Not counted'}
                                    </td>
                                    <td class="text-right">
                                        <button class="btn btn-outline btn-sm" data-action="view-shift" data-id="${s.id}">View</button>
                                        ${s.status === 'open' ? `
                                            <button class="btn btn-danger btn-sm" data-action="end-shift-page" data-id="${s.id}">End</button>
                                        ` : ''}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderWorkSummaryCard(summary) {
        const totalHours = summary.reduce((s, r) => s + r.hours, 0);
        const totalOt = summary.reduce((s, r) => s + r.otHours, 0);
        const totalPay = summary.reduce((s, r) => s + r.pay, 0);

        return `
            <div class="card" style="margin-bottom:20px;">
                <div class="card-header">
                    <h3>Working Hours & Overtime (This Period)</h3>
                    <span class="badge badge-info">${summary.length} cashier(s)</span>
                </div>
                <div class="card-body" style="padding:0;">
                    <div class="table-container">
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
                                        <td>${r.otHours > 0
                                            ? `<span class="badge badge-warning">${r.otHours.toFixed(2)}h</span>`
                                            : '<span class="text-muted">0h</span>'
                                        }</td>
                                        <td><strong>${App.formatCurrency(r.pay)}</strong></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="2"><strong>Totals</strong></td>
                                    <td><strong>${totalHours.toFixed(2)}h</strong></td>
                                    <td><strong>${totalOt.toFixed(2)}h</strong></td>
                                    <td><strong>${App.formatCurrency(totalPay)}</strong></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    function renderMyScheduleCard(userId) {
        const rows = Schedules.getWeekSchedules(userId);

        return `
            <div class="card" style="margin-bottom:20px;">
                <div class="card-header">
                    <h3>My Shift Schedule (This Week)</h3>
                    <span class="text-muted">Scheduled by your manager</span>
                </div>
                <div class="card-body" style="padding:0;">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Day</th>
                                    <th>Date</th>
                                    <th>Shift Hours</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map(r => `
                                    <tr class="${r.isToday ? 'schedule-today' : ''}">
                                        <td>
                                            <strong>${r.dayName}</strong>
                                            ${r.isToday ? ' <span class="badge badge-primary">Today</span>' : ''}
                                        </td>
                                        <td class="text-muted">${App.formatDate(r.dateStr)}</td>
                                        <td>
                                            ${r.entries.length
                                                ? r.entries.map(e => `<span class="badge badge-info">${App.escapeHtml(e.start)} – ${App.escapeHtml(e.end)}</span>`).join(' ')
                                                : '<span class="text-muted">Off</span>'
                                            }
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    function viewShift(id) {
        const shift = DB.getById('shifts', id);
        if (!shift) return;

        // Enforce permission: cashiers can only view their own shifts
        const user = Auth.currentUser();
        if (!Auth.isAdmin() && shift.userId !== user.id) return;

        const orders = DB.query('orders', o => o.shiftId === id)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        const totalSales = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);

        // Hours worked (live for open shifts) + daily OT for the shift's start date
        const hoursWorked = Payroll.hoursForShift({ startTime: shift.startTime, endTime: shift.endTime || new Date().toISOString() });
        const otHours = shift.startTime ? Payroll.dailyOtForDate(shift.userId, shift.startTime.split('T')[0]) : 0;

        App.openModal(`
            <div class="modal-header">
                <h3>Shift Details — ${App.escapeHtml(shift.userName)}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="stats-grid" style="margin-bottom:20px;">
                    <div class="stat-card">
                        <div class="stat-icon green">💵</div>
                        <div class="stat-info">
                            <div class="stat-label">Total Sales</div>
                            <div class="stat-value">${App.formatCurrency(shift.totalSales != null ? shift.totalSales : totalSales)}</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon blue">📦</div>
                        <div class="stat-info">
                            <div class="stat-label">Orders</div>
                            <div class="stat-value">${shift.orderCount != null ? shift.orderCount : orders.length}</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon purple">💰</div>
                        <div class="stat-info">
                            <div class="stat-label">Starting Cash</div>
                            <div class="stat-value">${App.formatCurrency(shift.startingCash || 0)}</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon orange">📊</div>
                        <div class="stat-info">
                            <div class="stat-label">Cash Difference</div>
                            <div class="stat-value ${shift.cashDifference === 0 ? 'cash-balanced' : shift.cashDifference < 0 ? 'cash-shortage' : 'cash-overage'}">
                                ${shift.cashDifference !== null && shift.cashDifference !== undefined
                                    ? (shift.cashDifference === 0 ? 'Balanced' : App.formatCurrency(shift.cashDifference))
                                    : 'Not counted'}
                            </div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon orange">🕐</div>
                        <div class="stat-info">
                            <div class="stat-label">Hours Worked</div>
                            <div class="stat-value">${hoursWorked.toFixed(2)}h</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon purple">⏱</div>
                        <div class="stat-info">
                            <div class="stat-label">OT (day)</div>
                            <div class="stat-value">${otHours > 0 ? otHours.toFixed(2) + 'h' : '0h'}</div>
                        </div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:0.9rem;">
                    <div><span class="text-muted">Started:</span> <strong>${App.formatDateTime(shift.startTime)}</strong></div>
                    <div><span class="text-muted">Ended:</span> <strong>${shift.endTime ? App.formatDateTime(shift.endTime) : 'Still open'}</strong></div>
                    <div><span class="text-muted">Starting Cash:</span> <strong>${App.formatCurrency(shift.startingCash || 0)}</strong></div>
                    <div><span class="text-muted">Ending Cash:</span> <strong>${shift.endingCash != null ? App.formatCurrency(shift.endingCash) : 'Not counted'}</strong></div>
                </div>

                ${orders.length > 0 ? `
                    <h4 style="margin-bottom:12px;">Orders During This Shift</h4>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Order #</th>
                                    <th>Type</th>
                                    <th>Total</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${orders.map(o => `
                                    <tr>
                                        <td><strong>#${o.orderNumber}</strong></td>
                                        <td><span class="badge badge-info">${App.escapeHtml(o.type)}</span></td>
                                        <td><strong>${App.formatCurrency(o.total)}</strong></td>
                                        <td class="text-muted">${App.formatDateTime(o.createdAt)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                            <tfoot>
                                <tr style="background:var(--bg);font-weight:700;">
                                    <td colspan="2">Total (${orders.length} orders)</td>
                                    <td>${App.formatCurrency(totalSales)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                ` : `
                    <div class="empty-state">
                        <span class="icon">📦</span>
                        <h3>No orders during this shift</h3>
                    </div>
                `}

                ${(shift.notes || shift.handover_notes) ? `
                    <hr style="margin:20px 0;border-color:var(--border);">
                    ${shift.notes ? `
                        <div class="form-group">
                            <label>Notes</label>
                            <div class="card" style="padding:10px;font-size:0.9rem;white-space:pre-wrap;">${App.escapeHtml(shift.notes)}</div>
                        </div>
                    ` : ''}
                    ${shift.handover_notes ? `
                        <div class="form-group">
                            <label>Handover Notes <span class="text-muted">(visible to next cashier & admins)</span></label>
                            <div class="card" style="padding:10px;font-size:0.9rem;white-space:pre-wrap;">${App.escapeHtml(shift.handover_notes)}</div>
                        </div>
                    ` : ''}
                ` : ''}

                ${Auth.isAdmin() ? `
                    <hr style="margin:20px 0;border-color:var(--border);">
                    <div class="form-group">
                        <label>Pay Rate Override ($/hr) <span class="text-muted">(optional)</span></label>
                        <input type="number" class="form-control" id="shiftPayRate" step="0.01" min="0"
                               value="${shift.payRate != null ? App.escapeHtml(shift.payRate) : ''}"
                               placeholder="Leave blank to use the cashier's hourly rate">
                        <small class="form-hint">Overrides this cashier's hourly rate for this shift in payroll. Fixed-salary cashiers are unaffected.</small>
                    </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                ${Auth.isAdmin() ? '<button class="btn btn-primary" id="btnSaveShiftPayRate">Save Rate</button>' : ''}
                <button class="btn btn-outline" id="btnPrintShift">🖨 Print</button>
                <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
            </div>
        `);

        const saveRateBtn = document.getElementById('btnSaveShiftPayRate');
        if (saveRateBtn) {
            saveRateBtn.addEventListener('click', () => {
                const val = document.getElementById('shiftPayRate').value;
                const payRate = (val === '' || val == null) ? null : Math.max(0, parseFloat(val));
                DB.update('shifts', id, { payRate });
                App.toast(payRate === null ? 'Rate override cleared' : 'Pay rate updated');
                App.closeModal();
                viewShift(id);
            });
        }

        document.getElementById('btnPrintShift').addEventListener('click', () => {
            Receipt.showShift(shift);
        });
    }

    function openEndShiftModal(shiftId) {
        const shift = DB.getById('shifts', shiftId);
        if (!shift || shift.status !== 'open') return;

        const orders = DB.query('orders', o => o.shiftId === shiftId);
        const totalSales = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);

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
                </div>
                <div class="form-group">
                    <label>Cashier's Name</label>
                    <input type="text" class="form-control" value="${App.escapeHtml(shift.userName)}" readonly style="background:#f1f5f9;cursor:not-allowed;">
                </div>
                <div class="form-group">
                    <label>Started At</label>
                    <input type="text" class="form-control" value="${App.formatDateTime(shift.startTime)}" readonly style="background:#f1f5f9;cursor:not-allowed;">
                </div>
                <div class="form-group">
                    <label>Starting Cash Float</label>
                    <input type="text" class="form-control" value="${App.formatCurrency(shift.startingCash || 0)}" readonly style="background:#f1f5f9;cursor:not-allowed;">
                </div>
                <div class="form-group">
                    <label>Counted Cash ($)</label>
                    <input type="number" class="form-control" id="endingCashInput" step="0.01" min="0"
                           placeholder="Enter the counted cash amount">
                    <small class="form-hint">Optional — skip if you don't want to reconcile cash.</small>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-danger" id="btnConfirmEndShift">End Shift</button>
            </div>
        `);

        document.getElementById('btnConfirmEndShift').addEventListener('click', () => {
            const endingCashVal = document.getElementById('endingCashInput').value;
            const endingCash = endingCashVal !== '' ? parseFloat(endingCashVal) : null;

            endShift(shiftId, endingCash);
            App.closeModal();
            render();
        });

        document.getElementById('endingCashInput').focus();
    }

    // ── Core Logic ─────────────────────────────────────────────

    function getOpenShift(userId) {
        return DB.query('shifts', s => s.userId === userId && s.status === 'open')[0] || null;
    }

    function startShift(userId, userName, startingCash) {
        // Prevent duplicate open shifts
        if (getOpenShift(userId)) {
            return { ok: false, reason: 'already_open', message: 'You already have an open shift' };
        }

        const user = DB.getById('users', userId);

        // Strict enforcement: cashiers can only start a shift when they are scheduled
        if (user && user.role === 'cashier' && !Schedules.isCurrentlyScheduled(userId)) {
            const next = Schedules.getNextShift(userId);
            const message = next
                ? `You're not scheduled to work right now. Next shift: ${next.dayLabel} ${next.startTime}–${next.endTime}`
                : "You're not scheduled to work right now. No upcoming shifts found.";
            return { ok: false, reason: 'not_scheduled', message };
        }

        // Remember which schedule entry the shift matched (for reporting)
        const matched = user && user.role === 'cashier' ? Schedules.getCurrentEntry(userId) : null;

        const now = new Date().toISOString();
        const shift = DB.insert('shifts', {
            userId,
            userName,
            startTime: now,
            endTime: null,
            status: 'open',
            startingCash: startingCash || 0,
            endingCash: null,
            totalSales: null,
            orderCount: null,
            cashDifference: null,
            scheduleId: matched ? matched.id : null,
        });
        return { ok: true, shift };
    }

    function endShift(shiftId, endingCash, notes, handoverNotes) {
        const shift = DB.getById('shifts', shiftId);
        if (!shift || shift.status !== 'open') return null;

        const orders = DB.query('orders', o => o.shiftId === shiftId);
        const totalSales = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
        const orderCount = orders.length;
        const cashDifference = endingCash !== null
            ? Math.round((endingCash - (shift.startingCash || 0) - totalSales) * 100) / 100
            : null;

        return DB.update('shifts', shiftId, {
            status: 'closed',
            endTime: new Date().toISOString(),
            endingCash,
            totalSales,
            orderCount,
            cashDifference,
            notes: notes || shift.notes,
            handover_notes: handoverNotes || shift.handover_notes,
        });
    }

    function getFilteredShifts() {
        let shifts = DB.getAll('shifts');
        const user = Auth.currentUser();

        // Non-admins see only their own shifts
        if (!Auth.isAdmin()) {
            shifts = shifts.filter(s => s.userId === user.id);
        }

        if (filterStatus) {
            shifts = shifts.filter(s => s.status === filterStatus);
        }
        if (filterDateFrom) {
            shifts = shifts.filter(s => s.startTime && s.startTime.split('T')[0] >= filterDateFrom);
        }
        if (filterDateTo) {
            shifts = shifts.filter(s => s.startTime && s.startTime.split('T')[0] <= filterDateTo);
        }

        return shifts.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    }

    // ── Break Tracking ────────────────────────────────────────────────
    function getActiveBreak(shiftId) {
        return DB.query('breaks', b => b.shiftId === shiftId && b.endTime === null);
    }

    function getShiftBreaks(shiftId) {
        return DB.query('breaks', b => b.shiftId === shiftId).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    }

    function startBreak(shiftId, breakType = 'rest') {
        const user = Auth.currentUser();
        const activeBreaks = getActiveBreak(shiftId).filter(b => b.userId === user.id);
        if (activeBreaks.length > 0) {
            return { ok: false, message: 'You already have an active break' };
        }

        const breakRecord = DB.insert('breaks', {
            shiftId,
            userId: user.id,
            breakType,
            startTime: new Date().toISOString(),
            endTime: null,
            durationMinutes: null,
        });

        return { ok: true, break: breakRecord };
    }

    function endBreak(breakId) {
        const user = Auth.currentUser();
        const breakRecord = DB.getById('breaks', breakId);
        if (!breakRecord || breakRecord.userId !== user.id || breakRecord.endTime !== null) {
            return { ok: false, message: 'Break not found or already ended' };
        }

        const endTime = new Date().toISOString();
        const startTime = new Date(breakRecord.startTime);
        const durationMinutes = Math.round((new Date(endTime) - startTime) / 60000);

        const updated = DB.update('breaks', breakId, {
            endTime,
            durationMinutes,
        });

        // Update total break minutes on shift
        const shift = DB.getById('shifts', breakRecord.shiftId);
        if (shift) {
            const allBreaks = getShiftBreaks(shift.id);
            const totalBreakMinutes = allBreaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
            DB.update('shifts', shift.id, { total_break_minutes: totalBreakMinutes });
        }

        return { ok: true, break: updated };
    }

    function formatBreakDuration(minutes) {
        if (!minutes || minutes < 1) return '0m';
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }

    function renderBreakControls(shift) {
        const user = Auth.currentUser();
        const activeBreak = getActiveBreak(shift.id).find(b => b.userId === user.id);
        const allBreaks = getShiftBreaks(shift.id).filter(b => b.userId === user.id);

        if (activeBreak) {
            // Currently on break - show end break button with timer
            const startTime = new Date(activeBreak.startTime);
            return `
                <div class="break-status active" data-break-id="${activeBreak.id}">
                    <div class="break-info">
                        <span class="break-type-badge ${activeBreak.breakType}">${activeBreak.breakType}</span>
                        <span class="break-timer" data-start="${activeBreak.startTime}">Calculating...</span>
                    </div>
                    <button class="btn btn-danger btn-sm" data-action="end-break" data-break-id="${activeBreak.id}">End Break</button>
                </div>
            `;
        } else {
            // Not on break - show start break options
            const totalBreakMins = allBreaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
            return `
                <div class="break-status">
                    <div class="break-info">
                        <span>Total break time: <strong>${formatBreakDuration(totalBreakMins)}</strong></span>
                        ${shift.total_break_minutes ? `<span class="text-muted"> (Shift total: ${formatBreakDuration(shift.total_break_minutes)})</span>` : ''}
                    </div>
                    <div class="break-actions">
                        <button class="btn btn-outline btn-sm" data-action="start-break" data-type="rest">☕ Rest (15m)</button>
                        <button class="btn btn-outline btn-sm" data-action="start-break" data-type="meal">🍽 Meal (30m)</button>
                        <button class="btn btn-outline btn-sm" data-action="start-break" data-type="personal">👤 Personal</button>
                    </div>
                </div>
            `;
        }
    }

    function startBreakTimer() {
        if (breakTimerInterval) clearInterval(breakTimerInterval);
        breakTimerInterval = setInterval(() => {
            document.querySelectorAll('.break-timer[data-start]').forEach(el => {
                const start = new Date(el.dataset.start);
                const diff = Math.round((new Date() - start) / 60000);
                const hours = Math.floor(diff / 60);
                const mins = diff % 60;
                el.textContent = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            });
        }, 1000);
    }

    function stopBreakTimer() {
        if (breakTimerInterval) clearInterval(breakTimerInterval);
        breakTimerInterval = null;
    }

    function bindBreakEvents() {
        // Start break
        document.querySelectorAll('[data-action="start-break"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const openShift = getOpenShift(Auth.currentUser().id);
                if (!openShift) return;

                const type = btn.dataset.type;
                const result = startBreak(openShift.id, type);
                if (result.ok) {
                    App.toast(`${type} break started`);
                    render(); // Re-render to show timer
                } else {
                    App.toast(result.message, 'error');
                }
            });
        });

        // End break
        document.querySelectorAll('[data-action="end-break"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const breakId = btn.dataset.breakId;
                const result = endBreak(breakId);
                if (result.ok) {
                    App.toast(`Break ended (${formatBreakDuration(result.break.durationMinutes)})`);
                    render();
                } else {
                    App.toast(result.message, 'error');
                }
            });
        });
    }

    // ── Shift Notes / Handover ─────────────────────────────────────
    function openShiftNotesModal(shift) {
        const user = Auth.currentUser();
        const isAdmin = Auth.isAdmin();
        const canEdit = shift.status === 'open' && (shift.userId === user.id || isAdmin);

        const notesHtml = `
            <div class="modal-header">
                <h3>${shift.status === 'open' ? 'Shift Notes' : 'Shift Summary'}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="max-height:70vh;overflow:auto;">
                ${(canEdit || shift.notes) ? `
                    <div class="form-group">
                        <label>Your Notes</label>
                        <textarea class="form-control" id="shiftNotes" rows="4" placeholder="Notes for this shift..." ${canEdit ? '' : 'readonly'}>${App.escapeHtml(shift.notes || '')}</textarea>
                    </div>
                ` : ''}

                ${(canEdit || shift.handover_notes) ? `
                    <div class="form-group">
                        <label>Handover Notes <span class="text-muted">(visible to next cashier & admins)</span></label>
                        <textarea class="form-control" id="handoverNotes" rows="4" placeholder="Important info for next shift..." ${canEdit ? '' : 'readonly'}>${App.escapeHtml(shift.handover_notes || '')}</textarea>
                    </div>
                ` : ''}

                ${shift.status === 'closed' && shift.endTime ? `
                    <hr style="margin:16px 0;">
                    <div style="font-size:0.85rem;color:var(--text-muted);">
                        <div><strong>Shift:</strong> ${App.escapeHtml(shift.userName || '—')}</div>
                        <div><strong>Started:</strong> ${App.formatDateTime(shift.startTime)}</div>
                        <div><strong>Ended:</strong> ${App.formatDateTime(shift.endTime)}</div>
                        <div><strong>Duration:</strong> ${calculateShiftDuration(shift.startTime, shift.endTime)}</div>
                        <div><strong>Break Time:</strong> ${formatBreakDuration(shift.total_break_minutes || 0)}</div>
                        <div><strong>Worked:</strong> ${formatBreakDuration(calculateWorkedMinutes(shift.startTime, shift.endTime, shift.total_break_minutes || 0))}</div>
                        ${shift.endingCash !== null ? `<div><strong>Ending Cash:</strong> ${App.formatCurrency(shift.endingCash)}</div>` : ''}
                        ${shift.cashDifference !== null ? `<div><strong>Cash Diff:</strong> ${App.formatCurrency(shift.cashDifference)}</div>` : ''}
                    </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Close</button>
                ${canEdit ? `<button class="btn btn-primary" id="btnSaveShiftNotes">Save Notes</button>` : ''}
            </div>
        `;

        App.openModal(notesHtml);

        if (canEdit) {
            document.getElementById('btnSaveShiftNotes').addEventListener('click', () => {
                const notes = document.getElementById('shiftNotes')?.value || '';
                const handoverNotes = document.getElementById('handoverNotes')?.value || '';
                DB.update('shifts', shift.id, { notes, handover_notes: handoverNotes });
                App.toast('Notes saved');
                App.closeModal();
                render();
            });
        }
    }

    function calculateShiftDuration(start, end) {
        const diff = new Date(end) - new Date(start);
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }

    function calculateWorkedMinutes(start, end, breakMinutes) {
        const totalMinutes = Math.round((new Date(end) - new Date(start)) / 60000);
        return Math.max(0, totalMinutes - breakMinutes);
    }

    return {
        render,
        getOpenShift,
        startShift,
        endShift,
        getActiveBreak,
        getShiftBreaks,
        startBreak,
        endBreak,
        formatBreakDuration,
        openShiftNotesModal,
        startBreakTimer,
        stopBreakTimer,
    };
})();
