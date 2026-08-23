/**
 * CyberCafe – Internet Café station management (Handy Cafe / Cyber Cafe Pro
 * style client-PC timer billing), gated behind the CyberCafe plan feature.
 *
 * Talks to Supabase RPCs from migration 018_cyber_cafe.sql:
 *   cafe_dashboard_state, cafe_add_station, cafe_repair_station,
 *   cafe_start_session, cafe_extend_session, cafe_stop_session,
 *   cafe_force_lock, cafe_send_message
 *
 * A session ending writes a real `orders` row (type = 'cafe_session'),
 * so cafe sales automatically show up in Shifts / Reports / Leaderboards
 * with no changes needed to those modules.
 *
 * The actual PC lock/unlock/kill-app enforcement happens on the client
 * PC via a separate native Windows agent app (see /windows-agent) that
 * polls agent_heartbeat and drains agent_commands. This module only
 * writes the commands — it never touches the client PC directly (a
 * browser tab can't lock another machine).
 */
const CyberCafe = (() => {
    let stations = [];
    let pollTimer = null;
    let tickTimer = null;
    // Set while a drag gesture is in progress. renderGrid() fires every
    // second from the countdown tick — if it rebuilds the canvas's
    // innerHTML mid-drag, the in-progress pointer capture / element
    // gets yanked out from under the gesture and it just dies. So we
    // freeze repaints for the duration of the drag and catch up right
    // after (see pointerup handlers below).
    let isDragging = false;
    // Admin-only mode: cards become draggable on the floor-plan canvas
    // and the operational buttons (Start/Stop/etc.) are hidden so a
    // slow drag doesn't accidentally fire a click on release.
    let arrangeMode = false;

    function render() {
        const el = document.getElementById('page-cybercafe');
        if (!el) return;

        if (!App.hasFeature('CyberCafe')) {
            el.innerHTML = `
                <div class="card">
                    <div class="card-body empty-state">
                        <span class="icon">🔒</span>
                        <h3>Upgrade Required</h3>
                        <p>Internet Café station management is available on the ₱499 plan.</p>
                        <button class="btn btn-primary btn-sm" onclick="App.navigateTo('billing')">View Plans</button>
                    </div>
                </div>`;
            return;
        }

        arrangeMode = false;

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>🖥 Internet Café Stations</h3>
                    <div style="display:flex;gap:10px;">
                        <button class="btn btn-outline btn-sm" id="btnCafeRefresh">↻ Refresh</button>
                        ${Auth.isAdmin() ? `<button class="btn btn-outline btn-sm" id="btnCafeArrange">📐 Arrange Layout</button>` : ''}
                        ${Auth.isAdmin() ? `<button class="btn btn-primary btn-sm" id="btnCafeAddStation">+ Add Station</button>` : ''}
                    </div>
                </div>
                <div class="card-body">
                    ${Auth.isAdmin() ? `<div id="cafeArrangeHint" class="text-muted" style="font-size:12px;margin-bottom:8px;display:none;">Drag each station to match where the PC actually sits in your café. Positions save automatically.</div>` : ''}
                    <div id="cafeStationGrid" class="cafe-floor-plan" style="position:relative;min-height:420px;border:1px dashed var(--border,#333);border-radius:10px;background-image:radial-gradient(var(--border,#333) 1px, transparent 1px);background-size:24px 24px;">
                        <div class="text-muted" style="padding:14px;">Loading stations…</div>
                    </div>
                </div>
            </div>`;

        $('#btnCafeRefresh')?.addEventListener('click', load);
        $('#btnCafeAddStation')?.addEventListener('click', openAddStationModal);
        $('#btnCafeArrange')?.addEventListener('click', toggleArrangeMode);

        load();
        startPolling();
        startTicking();
    }

    function toggleArrangeMode() {
        arrangeMode = !arrangeMode;
        const btn = $('#btnCafeArrange');
        const hint = $('#cafeArrangeHint');
        if (btn) {
            btn.textContent = arrangeMode ? '✓ Done Arranging' : '📐 Arrange Layout';
            btn.classList.toggle('btn-primary', arrangeMode);
            btn.classList.toggle('btn-outline', !arrangeMode);
        }
        if (hint) hint.style.display = arrangeMode ? 'block' : 'none';
        renderGrid();
    }

    function $(sel) { return document.querySelector(sel); }

    function destroy() {
        stopPolling();
        stopTicking();
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(load, 5000); // agent state is near-real-time, not local-cache
    }
    function stopPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    // Countdown labels tick every second client-side between polls,
    // so the UI doesn't look frozen for 5s at a time.
    function startTicking() {
        stopTicking();
        tickTimer = setInterval(renderGrid, 1000);
    }
    function stopTicking() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = null;
    }

    async function load() {
        const client = Supabase.getClient();
        const { data, error } = await client.rpc('cafe_dashboard_state');
        if (error) {
            console.error('cafe_dashboard_state failed', error);
            return;
        }
        stations = data || [];
        renderGrid();
    }

    function fmtRemaining(expiresAt) {
        if (!expiresAt) return '—';
        const ms = new Date(expiresAt).getTime() - Date.now();
        const past = ms < 0;
        const total = Math.abs(Math.floor(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const label = `${h > 0 ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return past ? `-${label}` : label;
    }

    function statusMeta(s) {
        if (s.status === 'in_use' && s.expires_at && new Date(s.expires_at).getTime() < Date.now()) {
            return { label: 'Time Up', color: '#e5484d' };
        }
        switch (s.status) {
            case 'available': return { label: 'Available', color: '#2ecc71' };
            case 'in_use': return { label: 'In Use', color: '#f5a623' };
            case 'locked': return { label: 'Locked', color: '#8e8e93' };
            case 'maintenance': return { label: 'Maintenance', color: '#8e8e93' };
            default: return { label: 'Offline', color: '#8e8e93' };
        }
    }

    // Card footprint on the canvas, in px — used to clamp dragging so a
    // card can't be dropped with its corner hanging off the edge.
    const CARD_W = 200;
    const CARD_H = 210;

    function renderGrid() {
        const grid = document.getElementById('cafeStationGrid');
        if (!grid) { stopTicking(); stopPolling(); return; }

        // Don't yank the DOM out from under an in-progress drag — catch
        // up on the next tick after it ends (see pointerup handler).
        if (isDragging) return;

        if (!stations.length) {
            grid.innerHTML = `<div class="text-muted" style="padding:14px;">No stations yet. ${Auth.isAdmin() ? 'Click "+ Add Station" to pair your first client PC.' : ''}</div>`;
            return;
        }

        const draggable = arrangeMode && Auth.isAdmin();

        grid.innerHTML = stations.map(s => {
            const meta = statusMeta(s);
            const offline = s.last_heartbeat && (Date.now() - new Date(s.last_heartbeat).getTime()) > 30000;
            const canDelete = Auth.isAdmin() && s.status !== 'in_use';
            // pos_x/pos_y are % of the canvas; fall back to a loose grid
            // by index for any station that predates the floor-plan
            // migration and somehow still has no position.
            const idx = stations.indexOf(s);
            const left = s.pos_x != null ? s.pos_x : 10 + (idx % 4) * 26;
            const top = s.pos_y != null ? s.pos_y : 12 + Math.floor(idx / 4) * 30;
            return `
                <div class="cafe-station-card" data-station="${s.station_id}"
                     style="position:absolute;left:${left}%;top:${top}%;width:${CARD_W}px;
                            border:1px solid var(--border,#333);border-radius:10px;padding:14px;
                            background:var(--card-bg,#1a1a1a);box-shadow:0 2px 8px rgba(0,0,0,.25);
                            ${draggable ? 'cursor:grab;touch-action:none;' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                        ${draggable ? `<span title="Drag to position" style="cursor:grab;user-select:none;">⠿</span>` : ''}
                        <strong style="flex:1;">${s.name}</strong>
                        <span class="badge" style="background:${meta.color};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">${meta.label}</span>
                        ${!arrangeMode && canDelete ? `<button class="btn btn-sm" data-act="delete" title="Delete station" style="color:#e5484d;padding:0 6px;">✕</button>` : ''}
                    </div>
                    <div class="text-muted" style="font-size:12px;margin:4px 0;">${s.zone || ''} ${offline ? '· <span style="color:#e5484d;">agent offline</span>' : ''}</div>
                    ${arrangeMode ? '' : s.status === 'in_use' ? `
                        <div style="font-size:28px;font-weight:700;text-align:center;margin:10px 0;">${fmtRemaining(s.expires_at)}</div>
                        <div class="text-muted" style="font-size:12px;text-align:center;">${s.customer_name || 'Walk-in'} · ₱${Number(s.rate_per_hour || 0).toFixed(2)}/hr</div>
                        <div style="display:flex;gap:6px;margin-top:10px;">
                            <button class="btn btn-outline btn-sm" data-act="extend" style="flex:1;">+ Extend</button>
                            <button class="btn btn-primary btn-sm" data-act="stop" style="flex:1;">Stop & Collect</button>
                        </div>
                        <button class="btn btn-sm" data-act="lock" style="width:100%;margin-top:6px;color:#e5484d;">Force Lock Now</button>
                    ` : s.status === 'available' ? `
                        <button class="btn btn-primary btn-sm" data-act="start" style="width:100%;margin-top:10px;">▶ Start Session</button>
                    ` : `
                        <div class="text-muted" style="text-align:center;margin-top:10px;">${meta.label}</div>
                    `}
                </div>`;
        }).join('');

        grid.querySelectorAll('[data-act]').forEach(btn => {
            const card = btn.closest('[data-station]');
            const stationId = card.dataset.station;
            btn.addEventListener('click', (e) => { e.stopPropagation(); handleAction(btn.dataset.act, stationId); });
        });

        if (draggable) wireFloorPlanDrag(grid);
    }

    // ── Free-form floor-plan dragging ────────────────────────────
    // Pointer events (not HTML5 drag/drop) because we need a
    // continuous x/y position, not just "before/after this element" —
    // the whole point is letting the card land anywhere on the canvas
    // to mirror where the PC actually sits in the café.
    function wireFloorPlanDrag(grid) {
        grid.querySelectorAll('[data-station]').forEach(card => {
            card.addEventListener('pointerdown', (e) => {
                if (e.target.closest('[data-act]')) return; // arrangeMode hides these, but just in case
                e.preventDefault();
                isDragging = true;
                card.setPointerCapture(e.pointerId);
                card.style.cursor = 'grabbing';
                card.style.zIndex = '10';

                const gridRect = grid.getBoundingClientRect();
                const startLeft = card.offsetLeft;
                const startTop = card.offsetTop;
                const startX = e.clientX;
                const startY = e.clientY;

                const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const dy = ev.clientY - startY;
                    const maxLeft = Math.max(0, gridRect.width - CARD_W);
                    const maxTop = Math.max(0, gridRect.height - CARD_H);
                    const newLeft = Math.min(maxLeft, Math.max(0, startLeft + dx));
                    const newTop = Math.min(maxTop, Math.max(0, startTop + dy));
                    card.style.left = newLeft + 'px';
                    card.style.top = newTop + 'px';
                };

                const onUp = (ev) => {
                    card.removeEventListener('pointermove', onMove);
                    card.removeEventListener('pointerup', onUp);
                    card.removeEventListener('pointercancel', onUp);
                    card.style.cursor = 'grab';
                    card.style.zIndex = '';
                    isDragging = false;

                    const pctX = (card.offsetLeft / Math.max(1, gridRect.width)) * 100;
                    const pctY = (card.offsetTop / Math.max(1, gridRect.height)) * 100;
                    persistPosition(card.dataset.station, pctX, pctY);
                };

                card.addEventListener('pointermove', onMove);
                card.addEventListener('pointerup', onUp);
                card.addEventListener('pointercancel', onUp);
            });
        });
    }

    async function persistPosition(stationId, pctX, pctY) {
        // Reflect it locally right away so the next tick doesn't snap
        // the card back before the network round-trip finishes.
        const s = findStation(stationId);
        if (s) { s.pos_x = pctX; s.pos_y = pctY; }
        const client = Supabase.getClient();
        const { error } = await client.rpc('cafe_update_station_position', {
            p_station_id: stationId, p_x: pctX, p_y: pctY,
        });
        if (error) {
            App.toast('Could not save position: ' + error.message, 'error');
            load(); // fall back to server position
        }
    }

    function findStation(id) { return stations.find(s => s.station_id === id); }

    function handleAction(act, stationId) {
        const s = findStation(stationId);
        if (!s) return;
        if (act === 'start') openStartModal(s);
        if (act === 'extend') openExtendModal(s);
        if (act === 'stop') openStopModal(s);
        if (act === 'lock') forceLock(s);
        if (act === 'delete') deleteStation(s);
    }

    async function deleteStation(station) {
        if (station.status === 'in_use') {
            return App.toast('Stop the active session before deleting this station', 'error');
        }
        const ok = await App.confirm(
            'Delete Station',
            `Remove "${station.name}"? This unpairs the client PC — past sessions on it stay in your reports. This can't be undone.`,
            'Delete',
        );
        if (!ok) return;
        const client = Supabase.getClient();
        const { error } = await client.rpc('cafe_delete_station', { p_station_id: station.station_id });
        if (error) return App.toast(error.message, 'error');
        stations = stations.filter(s => s.station_id !== station.station_id);
        App.toast(`${station.name} deleted`);
        renderGrid();
    }

    // ── Add station (pairing) ────────────────────────────────────
    function openAddStationModal() {
        App.openModal(`
            <h3>Add Station</h3>
            <div class="form-group"><label>PC / Station Name</label>
                <input class="form-control" id="cafeNewName" placeholder="PC-01"></div>
            <div class="form-group"><label>Zone (optional)</label>
                <input class="form-control" id="cafeNewZone" placeholder="Ground Floor"></div>
            <div class="form-group"><label>Default Rate (₱/hour)</label>
                <input class="form-control" id="cafeNewRate" type="number" min="0" step="0.5" value="20"></div>
            <button class="btn btn-primary" id="cafeNewSubmit" style="width:100%;">Generate Pairing Code</button>
        `);
        $('#cafeNewSubmit').addEventListener('click', async () => {
            const name = $('#cafeNewName').value.trim();
            if (!name) return App.toast('Station name is required', 'error');
            const zone = $('#cafeNewZone').value.trim() || null;
            const rate = parseFloat($('#cafeNewRate').value) || 0;
            const client = Supabase.getClient();
            const { data, error } = await client.rpc('cafe_add_station', {
                p_name: name, p_zone: zone, p_hourly_rate: rate,
                p_store_id: DB.getCurrentStore(),
            });
            if (error) return App.toast(error.message, 'error');
            const row = Array.isArray(data) ? data[0] : data;
            showPairingCode(name, row.pairing_code);
        });
    }

    function showPairingCode(name, code) {
        App.openModal(`
            <h3>Pair “${name}”</h3>
            <p class="text-muted">Install the ZE-POS Station Agent on this PC, then enter this code when prompted. Expires in 30 minutes.</p>
            <div style="font-size:36px;font-weight:700;letter-spacing:6px;text-align:center;margin:20px 0;">${code}</div>
            <button class="btn btn-primary" style="width:100%;" onclick="App.closeModal()">Done</button>
        `);
        load();
    }

    // ── Start / extend / stop ────────────────────────────────────
    function openStartModal(station) {
        const openShift = (window.Shifts && Auth.currentUser()) ? Shifts.getOpenShift?.(Auth.currentUser().id) : null;
        App.openModal(`
            <h3>Start Session — ${station.name}</h3>
            ${!openShift ? `<div class="text-muted" style="margin-bottom:10px;color:#e5a712;">⚠ No open shift — this sale won't be attributed to a shift. Start your shift first for accurate cashier totals.</div>` : ''}
            <div class="form-group"><label>Customer Name (optional)</label>
                <input class="form-control" id="cafeCustName"></div>
            <div class="form-group"><label>Rate (₱/hour)</label>
                <input class="form-control" id="cafeRate" type="number" min="0" step="0.5" value="${station.hourly_rate || 20}"></div>
            <div class="form-group"><label>Duration</label>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${[15, 30, 60, 120].map(m => `<button class="btn btn-outline btn-sm" data-mins="${m}">${m < 60 ? m + 'm' : (m / 60) + 'h'}</button>`).join('')}
                </div>
                <input class="form-control" id="cafeMinutes" type="number" min="1" value="60" style="margin-top:8px;">
            </div>
            <button class="btn btn-primary" id="cafeStartSubmit" style="width:100%;">▶ Start</button>
        `);
        document.querySelectorAll('[data-mins]').forEach(b => b.addEventListener('click', () => { $('#cafeMinutes').value = b.dataset.mins; }));
        $('#cafeStartSubmit').addEventListener('click', async () => {
            const minutes = parseInt($('#cafeMinutes').value, 10);
            const rate = parseFloat($('#cafeRate').value) || 0;
            const custName = $('#cafeCustName').value.trim() || null;
            const user = Auth.currentUser();
            const client = Supabase.getClient();
            const { error } = await client.rpc('cafe_start_session', {
                p_station_id: station.station_id,
                p_planned_minutes: minutes,
                p_rate_per_hour: rate,
                p_customer_name: custName,
                p_shift_id: openShift ? openShift.id : null,
                p_user_id: user?.id || null,
                p_user_name: user?.name || null,
            });
            if (error) return App.toast(error.message, 'error');
            App.closeModal();
            App.toast(`Session started on ${station.name}`);
            load();
        });
    }

    function openExtendModal(station) {
        App.openModal(`
            <h3>Extend — ${station.name}</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${[10, 15, 30, 60].map(m => `<button class="btn btn-outline btn-sm" data-mins="${m}">+${m < 60 ? m + 'm' : (m / 60) + 'h'}</button>`).join('')}
            </div>
            <input class="form-control" id="cafeExtendMinutes" type="number" min="1" value="15" style="margin-top:10px;">
            <button class="btn btn-primary" id="cafeExtendSubmit" style="width:100%;margin-top:10px;">Extend</button>
        `);
        document.querySelectorAll('[data-mins]').forEach(b => b.addEventListener('click', () => { $('#cafeExtendMinutes').value = b.dataset.mins; }));
        $('#cafeExtendSubmit').addEventListener('click', async () => {
            const mins = parseInt($('#cafeExtendMinutes').value, 10);
            const client = Supabase.getClient();
            const { error } = await client.rpc('cafe_extend_session', { p_session_id: station.session_id, p_extra_minutes: mins });
            if (error) return App.toast(error.message, 'error');
            App.closeModal();
            App.toast(`Extended by ${mins} min`);
            load();
        });
    }

    function openStopModal(station) {
        const elapsedMin = Math.max(1, Math.ceil((Date.now() - new Date(station.start_time).getTime()) / 60000));
        const estAmount = ((elapsedMin / 60) * Number(station.rate_per_hour || 0)).toFixed(2);
        App.openModal(`
            <h3>Stop Session — ${station.name}</h3>
            <p>Elapsed: <strong>${elapsedMin} min</strong></p>
            <p>Estimated total: <strong>₱${estAmount}</strong> (final amount is calculated to the second when confirmed)</p>
            <button class="btn btn-primary" id="cafeStopSubmit" style="width:100%;">Stop & Record Sale</button>
        `);
        $('#cafeStopSubmit').addEventListener('click', async () => {
            const client = Supabase.getClient();
            const { data, error } = await client.rpc('cafe_stop_session', { p_session_id: station.session_id });
            if (error) return App.toast(error.message, 'error');
            App.closeModal();
            App.toast(`Session closed — ₱${Number(data).toFixed(2)} recorded to shift sales`);
            load();
        });
    }

    async function forceLock(station) {
        const ok = await App.confirm('Force Lock', `Immediately lock ${station.name}? The timer keeps running — this doesn't end the session.`, 'Lock Now');
        if (!ok) return;
        const client = Supabase.getClient();
        const { error } = await client.rpc('cafe_force_lock', { p_station_id: station.station_id });
        if (error) return App.toast(error.message, 'error');
        App.toast('Lock command sent');
    }

    return { render, destroy, load };
})();
