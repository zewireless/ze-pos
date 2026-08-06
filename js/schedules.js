/**
 * Schedules – Shift schedule management (admin) + schedule matching helpers
 *
 * Records are stored in the 'shift_schedules' table:
 *   { id, userId, type: 'weekly' | 'date',
 *     dayOfWeek: 1-7 (Mon=1 .. Sun=7),   // weekly only
 *     date: 'YYYY-MM-DD',                 // one-off only
 *     startTime: 'HH:MM',
 *     endTime: 'HH:MM',
 *     enabled: bool }
 *
 * Overnight shifts (start time after end time, e.g. 22:00 – 06:00) are supported.
 */
const Schedules = (() => {
    let filterCashier = '';

    // ── constants ─────────────────────────────────────────────
    const DAYS = [1, 2, 3, 4, 5, 6, 7];
    const DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };
    const DAY_SHORT = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

    // ── date/time helpers ─────────────────────────────────────
    function pad(n) { return String(n).padStart(2, '0'); }
    function toLocalDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function toLocalTimeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
    // Monday = 1 .. Sunday = 7 (JS getDay() is 0 = Sunday)
    function isoDayOfWeek(d) { return d.getDay() === 0 ? 7 : d.getDay(); }
    function timeToMin(t) {
        const parts = String(t || '').split(':');
        const h = parseInt(parts[0], 10) || 0;
        const m = parseInt(parts[1], 10) || 0;
        return h * 60 + m;
    }
    function fmtRange(start, end) { return `${start} – ${end}`; }

    // Is nowMin within [startMin, endMin)? Supports overnight windows.
    function timeInRange(nowMin, startMin, endMin) {
        if (startMin === endMin) return false;
        if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
        return nowMin >= startMin || nowMin < endMin; // spans midnight
    }

    // ── queries ───────────────────────────────────────────────
    function getForUser(userId) {
        return DB.query('shift_schedules', s => s.userId === userId);
    }

    function getEnabledForUser(userId) {
        return getForUser(userId).filter(s => s.enabled !== false);
    }

    // Is the user scheduled to work right now?
    function isCurrentlyScheduled(userId, now = new Date()) {
        return getCurrentEntry(userId, now) !== null;
    }

    // The enabled schedule entry currently applying to the user (if any).
    // An overnight window (start > end) is attributed to its starting day for the
    // evening portion, and to the following day for the early-morning portion.
    function getCurrentEntry(userId, now = new Date()) {
        const day = isoDayOfWeek(now);
        const prevDay = day === 1 ? 7 : day - 1;
        const today = toLocalDateStr(now);
        const yesterday = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        const nowMin = timeToMin(toLocalTimeStr(now));

        return getEnabledForUser(userId).find(s => {
            const start = timeToMin(s.startTime);
            const end = timeToMin(s.endTime);
            const overnight = start > end;

            if (s.type === 'weekly') {
                if (s.dayOfWeek === day) {
                    return overnight ? nowMin >= start : (nowMin >= start && nowMin < end);
                }
                // Overnight shift that started yesterday is still running this morning
                if (overnight && s.dayOfWeek === prevDay && nowMin < end) return true;
                return false;
            }

            if (s.type === 'date') {
                if (s.date === today) {
                    return overnight ? nowMin >= start : (nowMin >= start && nowMin < end);
                }
                if (overnight && s.date === yesterday && nowMin < end) return true;
                return false;
            }

            return false;
        }) || null;
    }

    // Today's applicable windows with a status for display.
    function getTodaySchedules(userId, now = new Date()) {
        const day = isoDayOfWeek(now);
        const prevDay = day === 1 ? 7 : day - 1;
        const today = toLocalDateStr(now);
        const yesterday = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        const nowMin = timeToMin(toLocalTimeStr(now));
        const entries = [];

        getEnabledForUser(userId).forEach(s => {
            const start = timeToMin(s.startTime);
            const end = timeToMin(s.endTime);
            const overnight = start > end;

            let applies = false;
            let status = '';

            if (s.type === 'weekly') {
                if (s.dayOfWeek === day) {
                    applies = true;
                    status = !overnight
                        ? (nowMin < start ? 'upcoming' : nowMin < end ? 'active' : 'ended')
                        : (nowMin >= start ? 'active' : 'upcoming');
                } else if (overnight && s.dayOfWeek === prevDay && nowMin < end) {
                    applies = true;
                    status = 'active'; // started yesterday, still running
                }
            } else if (s.type === 'date') {
                if (s.date === today) {
                    applies = true;
                    status = !overnight
                        ? (nowMin < start ? 'upcoming' : nowMin < end ? 'active' : 'ended')
                        : (nowMin >= start ? 'active' : 'upcoming');
                } else if (overnight && s.date === yesterday && nowMin < end) {
                    applies = true;
                    status = 'active';
                }
            }

            if (applies) entries.push({ id: s.id, startTime: s.startTime, endTime: s.endTime, status });
        });

        return entries.sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
    }

    // Next scheduled shift for the user: { active, dayLabel, startTime, endTime, label } or null.
    function getNextShift(userId, now = new Date()) {
        const today = isoDayOfWeek(now);
        const todayStr = toLocalDateStr(now);
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = toLocalDateStr(tomorrow);
        const nowMin = timeToMin(toLocalTimeStr(now));

        // 1) Currently active window → report it
        const active = getCurrentEntry(userId, now);
        if (active) {
            return { active: true, dayLabel: 'Today', startTime: active.startTime, endTime: active.endTime, label: fmtRange(active.startTime, active.endTime) };
        }

        // 2) Earliest future window
        const candidates = [];
        getEnabledForUser(userId).forEach(s => {
            if (s.type === 'weekly') {
                // Find the next occurrence of this weekday with a start time in the future
                const base = new Date(now);
                for (let offset = 0; offset <= 7; offset++) {
                    if (offset > 0) base.setDate(base.getDate() + 1);
                    if (isoDayOfWeek(base) !== s.dayOfWeek) continue;
                    const cand = new Date(base);
                    const [h, m] = s.startTime.split(':').map(Number);
                    cand.setHours(h, m, 0, 0);
                    if (cand > now) {
                        const ds = toLocalDateStr(cand);
                        const dayLabel = ds === todayStr ? 'Today' : ds === tomorrowStr ? 'Tomorrow' : DAY_NAMES[s.dayOfWeek];
                        candidates.push({ date: cand, dayLabel, startTime: s.startTime, endTime: s.endTime });
                        break;
                    }
                }
            } else if (s.type === 'date') {
                const cand = new Date(s.date + 'T' + s.startTime + ':00');
                if (cand > now) {
                    const ds = toLocalDateStr(cand);
                    const dayLabel = ds === todayStr ? 'Today' : ds === tomorrowStr ? 'Tomorrow' : cand.toLocaleDateString('en-US', { weekday: 'long' });
                    candidates.push({ date: cand, dayLabel, startTime: s.startTime, endTime: s.endTime });
                }
            }
        });

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => a.date - b.date);
        const next = candidates[0];
        return { active: false, dayLabel: next.dayLabel, startTime: next.startTime, endTime: next.endTime, label: fmtRange(next.startTime, next.endTime) };
    }

    // This week's schedule (Monday..Sunday) for the given user, for display.
    function getWeekSchedules(userId, now = new Date()) {
        const monday = startOfWeek(now);
        const todayStr = toLocalDateStr(now);
        const rows = [];

        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const dateStr = toLocalDateStr(d);
            const day = isoDayOfWeek(d);

            const entries = getEnabledForUser(userId)
                .filter(s => s.type === 'weekly' ? s.dayOfWeek === day : (s.type === 'date' && s.date === dateStr))
                .map(e => ({ id: e.id, start: e.startTime, end: e.endTime }));

            rows.push({ dateStr, dayName: DAY_NAMES[day], short: DAY_SHORT[day], isToday: dateStr === todayStr, entries });
        }
        return rows;
    }

    function startOfWeek(d) {
        const day = isoDayOfWeek(d);
        const m = new Date(d);
        m.setDate(d.getDate() - (day - 1));
        m.setHours(0, 0, 0, 0);
        return m;
    }

    // ── Admin page ────────────────────────────────────────────
    function render() {
        const el = document.getElementById('page-schedules');
        if (!Auth.isAdmin()) return;

        const cashiers = DB.getAll('users').filter(u => u.role === 'cashier');
        const nameOf = (id) => {
            const u = DB.getById('users', id);
            return u ? u.name : 'Deleted user';
        };

        let schedules = DB.getAll('shift_schedules');
        if (filterCashier) schedules = schedules.filter(s => s.userId === filterCashier);
        schedules = schedules.sort((a, b) => {
            const d = (a.startTime || '').localeCompare(b.startTime || '');
            return d || a.userId.localeCompare(b.userId);
        });

        document.getElementById('headerActions').innerHTML = `
            <button class="btn btn-primary" id="btnAddSchedule">+ Add Schedule</button>
        `;
        document.getElementById('btnAddSchedule').addEventListener('click', () => openForm());

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Shift Schedules (${schedules.length})</h3>
                    <select class="form-control" id="schedFilterCashier" style="width:200px;">
                        <option value="">All Cashiers</option>
                        ${cashiers.map(u => `<option value="${u.id}" ${filterCashier === u.id ? 'selected' : ''}>${App.escapeHtml(u.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="card-body" style="padding:0;">
                    ${schedules.length === 0
                        ? '<div class="empty-state"><span class="icon">📅</span><h3>No schedules yet</h3><p>Assign a shift schedule to a cashier to get started.</p></div>'
                        : renderTable(schedules, nameOf)
                    }
                </div>
            </div>
        `;

        document.getElementById('schedFilterCashier').addEventListener('change', (e) => {
            filterCashier = e.target.value;
            render();
        });

        el.querySelectorAll('[data-action="sch-edit"]').forEach(btn => {
            btn.addEventListener('click', () => openForm(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="sch-toggle"]').forEach(btn => {
            btn.addEventListener('click', () => toggleSchedule(btn.dataset.id));
        });
        el.querySelectorAll('[data-action="sch-delete"]').forEach(btn => {
            btn.addEventListener('click', () => deleteSchedule(btn.dataset.id));
        });
    }

    function describe(entry) {
        if (entry.type === 'weekly') {
            return `Every ${DAY_NAMES[entry.dayOfWeek]}`;
        }
        const d = new Date(entry.date + 'T00:00:00');
        return `${App.formatDate(entry.date)} · ${d.toLocaleDateString('en-US', { weekday: 'long' })}`;
    }

    function renderTable(schedules, nameOf) {
        return `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Cashier</th>
                            <th>Type</th>
                            <th>Schedule</th>
                            <th>Start</th>
                            <th>End</th>
                            <th>Status</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${schedules.map(s => `
                            <tr>
                                <td><strong>${App.escapeHtml(nameOf(s.userId))}</strong></td>
                                <td><span class="badge ${s.type === 'weekly' ? 'badge-primary' : 'badge-info'}">${s.type === 'weekly' ? 'Weekly' : 'Date'}</span></td>
                                <td>${App.escapeHtml(describe(s))}</td>
                                <td>${App.escapeHtml(s.startTime)}</td>
                                <td>${App.escapeHtml(s.endTime)}</td>
                                <td>
                                    <span class="badge ${s.enabled !== false ? 'badge-success' : 'badge-danger'}">
                                        ${s.enabled !== false ? 'Active' : 'Disabled'}
                                    </span>
                                </td>
                                <td class="text-right">
                                    <div class="btn-group" style="justify-content:flex-end;">
                                        <button class="btn btn-ghost btn-sm" data-action="sch-toggle" data-id="${s.id}" title="Toggle status">
                                            ${s.enabled !== false ? '🔴' : '🟢'}
                                        </button>
                                        <button class="btn btn-outline btn-sm" data-action="sch-edit" data-id="${s.id}">Edit</button>
                                        <button class="btn btn-ghost btn-sm" data-action="sch-delete" data-id="${s.id}" style="color:var(--danger);">🗑</button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function openForm(id) {
        const entry = id ? DB.getById('shift_schedules', id) : null;
        const isEdit = !!entry;
        const cashiers = DB.getAll('users').filter(u => u.role === 'cashier');

        App.openModal(`
            <div class="modal-header">
                <h3>${isEdit ? 'Edit Shift Schedule' : 'Add Shift Schedule'}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Cashier <span class="required">*</span></label>
                    <select class="form-control" id="schCashier" ${isEdit ? 'disabled' : ''}>
                        <option value="">Select cashier...</option>
                        ${cashiers.map(u => `<option value="${u.id}" ${entry && entry.userId === u.id ? 'selected' : ''}>${App.escapeHtml(u.name)}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label>Schedule Type <span class="required">*</span></label>
                    <div class="btn-group" id="schTypeGroup">
                        <button type="button" class="btn btn-sm ${!isEdit || entry.type === 'weekly' ? 'btn-primary' : 'btn-outline'}" data-sch-type="weekly" ${isEdit ? 'disabled' : ''}>Weekly (repeats)</button>
                        <button type="button" class="btn btn-sm ${!isEdit || entry.type === 'date' ? 'btn-primary' : 'btn-outline'}" data-sch-type="date" ${isEdit ? 'disabled' : ''}>Specific Date</button>
                    </div>
                </div>

                <div class="form-group" id="schWeeklyWrap" style="${entry && entry.type === 'date' ? 'display:none;' : ''}">
                    <label>Days of the Week <span class="required">*</span></label>
                    <div class="sch-days">
                        ${DAYS.map(d => `
                            <label class="sch-day">
                                <input type="checkbox" value="${d}"
                                    ${entry && entry.type === 'weekly' && entry.dayOfWeek === d ? 'checked' : ''}>
                                ${DAY_SHORT[d]}
                            </label>
                        `).join('')}
                    </div>
                    <small class="form-hint">Pick one or more days — a schedule row is created per day.</small>
                </div>

                <div class="form-group" id="schDateWrap" style="${entry && entry.type === 'date' ? '' : 'display:none;'}">
                    <label>Date <span class="required">*</span></label>
                    <input type="date" class="form-control" id="schDate" value="${entry && entry.type === 'date' ? App.escapeHtml(entry.date) : ''}">
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Start Time <span class="required">*</span></label>
                        <input type="time" class="form-control" id="schStart" value="${entry ? App.escapeHtml(entry.startTime) : ''}">
                    </div>
                    <div class="form-group">
                        <label>End Time <span class="required">*</span></label>
                        <input type="time" class="form-control" id="schEnd" value="${entry ? App.escapeHtml(entry.endTime) : ''}">
                    </div>
                </div>
                <small class="form-hint">Overnight shifts (start later than end) are supported, e.g. 22:00 – 06:00.</small>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnSaveSchedule">${isEdit ? 'Save Changes' : 'Add Schedule'}</button>
            </div>
        `);

        // Type toggle (add mode only)
        if (!isEdit) {
            document.querySelectorAll('#schTypeGroup [data-sch-type]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.dataset.schType;
                    document.querySelectorAll('#schTypeGroup [data-sch-type]').forEach(b => {
                        b.classList.toggle('btn-primary', b.dataset.schType === type);
                        b.classList.toggle('btn-outline', b.dataset.schType !== type);
                    });
                    document.getElementById('schWeeklyWrap').style.display = type === 'weekly' ? '' : 'none';
                    document.getElementById('schDateWrap').style.display = type === 'date' ? '' : 'none';
                });
            });
        }

        document.getElementById('btnSaveSchedule').addEventListener('click', () => {
            saveSchedule(isEdit ? entry : null);
        });
    }

    function getSelectedType() {
        const active = document.querySelector('#schTypeGroup [data-sch-type].btn-primary');
        return active ? active.dataset.schType : 'weekly';
    }

    function saveSchedule(entry) {
        const isEdit = !!entry;
        const userId = isEdit ? entry.userId : document.getElementById('schCashier').value;
        const type = isEdit ? entry.type : getSelectedType();

        // Validation
        if (!userId) { App.toast('Please select a cashier', 'error'); return; }
        const startTime = document.getElementById('schStart').value;
        const endTime = document.getElementById('schEnd').value;
        if (!startTime || !endTime) { App.toast('Start and end times are required', 'error'); return; }
        if (startTime === endTime) { App.toast('Start and end times must be different', 'error'); return; }

        if (type === 'weekly') {
            if (isEdit) {
                DB.update('shift_schedules', entry.id, { startTime, endTime });
                App.toast('Schedule updated');
            } else {
                const days = [...document.querySelectorAll('.sch-day input:checked')].map(cb => parseInt(cb.value, 10));
                if (days.length === 0) { App.toast('Select at least one day', 'error'); return; }
                days.forEach(day => {
                    DB.insert('shift_schedules', { userId, type: 'weekly', dayOfWeek: day, startTime, endTime, enabled: true });
                });
                App.toast(`Schedule added for ${days.length} day(s)`);
            }
        } else {
            const date = document.getElementById('schDate').value;
            if (!date) { App.toast('Please select a date', 'error'); return; }
            if (isEdit) {
                DB.update('shift_schedules', entry.id, { date, startTime, endTime });
                App.toast('Schedule updated');
            } else {
                DB.insert('shift_schedules', { userId, type: 'date', date, startTime, endTime, enabled: true });
                App.toast('Schedule added');
            }
        }

        App.closeModal();
        render();
    }

    function toggleSchedule(id) {
        const entry = DB.getById('shift_schedules', id);
        if (!entry) return;
        const enabled = entry.enabled === false ? true : false;
        DB.update('shift_schedules', id, { enabled });
        App.toast(`Schedule ${enabled ? 'enabled' : 'disabled'}`);
        render();
    }

    async function deleteSchedule(id) {
        const entry = DB.getById('shift_schedules', id);
        if (!entry) return;
        const yes = await App.confirm(
            'Delete Schedule?',
            `Are you sure you want to remove this schedule for ${describe(entry)}?`
        );
        if (yes) {
            DB.remove('shift_schedules', id);
            App.toast('Schedule deleted');
            render();
        }
    }

    return {
        render,
        isCurrentlyScheduled,
        getCurrentEntry,
        getTodaySchedules,
        getNextShift,
        getWeekSchedules,
    };
})();
