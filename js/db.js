/**
 * DB – cloud-backed, local-first data layer with multi-store support.
 *
 * Keeps the exact synchronous API the app modules use
 * (getAll / getById / query / insert / update / remove / count / clear /
 * nextOrderNumber / getSetting / setSetting), but:
 *   - DB.init() hydrates an in-memory cache from Supabase (per workspace+store).
 *   - Every mutation updates the cache immediately (snappy UI) and is
 *     written through to Supabase in the background, with retry on failure.
 *
 * Columns are snake_case in the DB; app rows use camelCase. FIELD_MAP
 * translates between them.
 */
const DB = (() => {
    let workspaceId = null;
    let currentStoreId = null;          // active store (from header switcher)
    let assignedStoreIds = [];          // stores this user can access (from profile/users)
    let cache = {};

    const TABLES = [
        'users', 'categories', 'menu_items', 'menu_sizes', 'condiments', 'taxes',
        'orders', 'order_items', 'shifts', 'shift_schedules', 'payrolls', 'settings',
        'stock_movements', 'bundles', 'bundle_items', 'breaks',
    ];

    // public.users only grants SELECT on these columns to anon/authenticated
    // (migration 003 deliberately excludes `password`; 008 added `store_id`
    // to this list). PostgREST expands select('*') to every column on the
    // table at parse time and checks privileges against ALL of them, so a
    // bare '*' against `users` always 403s (42501) even though the column
    // grant covers everything the app actually needs. Every hydration of the
    // `users` table must use this explicit list instead of '*'.
    const USERS_SAFE_COLUMNS = 'workspace_id,store_id,id,username,name,role,enabled,pay_type,hourly_rate,fixed_salary,created_at,auth_uid';

    function selectColsFor(table) {
        return table === 'users' ? USERS_SAFE_COLUMNS : '*';
    }

    // camelCase (app) → snake_case (column). Keys absent here pass through unchanged.
    const FIELD_MAP = {
        users: { authUid: 'auth_uid', payType: 'pay_type', hourlyRate: 'hourly_rate', fixedSalary: 'fixed_salary', createdAt: 'created_at', storeId: 'store_id' },
        categories: { createdAt: 'created_at', storeId: 'store_id' },
        menu_items: { categoryId: 'category_id', createdAt: 'created_at', storeId: 'store_id' },
        menu_sizes: { menuItemId: 'menu_item_id', createdAt: 'created_at', storeId: 'store_id' },
        condiments: { createdAt: 'created_at', storeId: 'store_id' },
        taxes: { createdAt: 'created_at', storeId: 'store_id' },
        orders: {
            orderNumber: 'order_number', taxName: 'tax_name', taxPercentage: 'tax_percentage',
            taxAmount: 'tax_amount', userId: 'user_id', userName: 'user_name',
            shiftId: 'shift_id', createdAt: 'created_at', storeId: 'store_id'
        },
        order_items: { orderId: 'order_id', menuItemId: 'menu_item_id', unitPrice: 'unit_price', lineTotal: 'line_total', storeId: 'store_id' },
        shifts: {
            userId: 'user_id', userName: 'user_name', startTime: 'start_time', endTime: 'end_time',
            startingCash: 'starting_cash', endingCash: 'ending_cash', cashDifference: 'cash_difference',
            totalSales: 'total_sales', orderCount: 'order_count', scheduleId: 'schedule_id',
            payRate: 'pay_rate', createdAt: 'created_at', storeId: 'store_id'
        },
        shift_schedules: {
            userId: 'user_id', dayOfWeek: 'day_of_week', startTime: 'start_time', endTime: 'end_time',
            createdAt: 'created_at', storeId: 'store_id'
        },
        payrolls: {
            fromDate: 'from_date', toDate: 'to_date', totalPay: 'total_pay', status: 'status',
            paidAt: 'paid_at', createdAt: 'created_at', storeId: 'store_id'
        },
        settings: { createdAt: 'created_at', storeId: 'store_id' },
        stock_movements: {
            menuItemId: 'menu_item_id', menuSizeId: 'menu_size_id', movementType: 'movement_type',
            quantityChange: 'quantity_change', previousQuantity: 'previous_quantity', newQuantity: 'new_quantity',
            referenceId: 'reference_id', referenceType: 'reference_type', userId: 'user_id', userName: 'user_name',
            createdAt: 'created_at', storeId: 'store_id'
        },
        bundles: {
            createdAt: 'created_at', storeId: 'store_id'
        },
        bundle_items: {
            bundleId: 'bundle_id', menuItemId: 'menu_item_id', createdAt: 'created_at', storeId: 'store_id'
        },
        breaks: {
            shiftId: 'shift_id', userId: 'user_id', breakType: 'break_type',
            startTime: 'start_time', endTime: 'end_time', durationMinutes: 'duration_minutes',
            createdAt: 'created_at', storeId: 'store_id'
        },
    };

    // snake_case → camelCase
    function fromDb(table, row) {
        if (!row) return null;
        const map = FIELD_MAP[table] || {};
        const out = { ...row };
        for (const [camel, snake] of Object.entries(map)) {
            if (out[snake] !== undefined) {
                out[camel] = out[snake];
                delete out[snake];
            }
        }
        // workspace_id and store_id are not used in app logic; drop them
        delete out.workspace_id;
        delete out.store_id;
        return out;
    }

    function toDb(table, row) {
        const map = FIELD_MAP[table] || {};
        const out = { ...row };
        for (const [camel, snake] of Object.entries(map)) {
            if (out[camel] !== undefined) {
                out[snake] = out[camel];
                delete out[camel];
            }
        }
        out.workspace_id = workspaceId;
        if (currentStoreId) out.store_id = currentStoreId;
        return out;
    }

    function generateId(prefix) {
        return prefix + Math.random().toString(36).slice(2, 9);
    }

    // ── background outbox for offline/failed writes ──────────────
    const OUTBOX_KEY = 'pos_outbox';
    function getOutbox() {
        try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); }
        catch { return []; }
    }
    function saveOutbox(box) { localStorage.setItem(OUTBOX_KEY, JSON.stringify(box)); }

    async function processOutbox() {
        const client = Supabase.getClient();
        if (!client) return;
        const box = getOutbox();
        if (!box.length) return;
        const remaining = [];
        for (const op of box) {
            try {
                if (op.type === 'upsert') {
                    const { error } = await client.from(op.table).upsert(op.rows, { onConflict: 'workspace_id,store_id,id' });
                    if (error) throw error;
                } else if (op.type === 'delete') {
                    const { error } = await client.from(op.table).delete().eq('workspace_id', op.workspaceId).eq('store_id', op.storeId).eq('id', op.id);
                    if (error) throw error;
                } else if (op.type === 'clear') {
                    const { error } = await client.from(op.table).delete().eq('workspace_id', op.workspaceId).eq('store_id', op.storeId);
                    if (error) throw error;
                }
            } catch (err) {
                console.warn('outbox retry:', op.table, err.message || err);
                remaining.push(op);
            }
        }
        saveOutbox(remaining);
    }

    // Fire-and-forget audit log entry (migration 003). Never blocks or
    // throws; failures only go to the console.
    async function logAction(action, entityType = null, entityId = null, details = {}) {
        try {
            const client = Supabase.getClient();
            if (!client) return;
            await client.rpc('log_action', {
                p_action: action,
                p_entity_type: entityType,
                p_entity_id: entityId,
                p_details: details,
            });
        } catch (err) {
            console.warn('log_action:', err.message || err);
        }
    }

    // ── cache getters (store-scoped) ─────────────────────────────
    function getStoreRows(table) {
        return (cache[table] || []).filter(r => r.storeId === currentStoreId);
    }

    function getAll(table) {
        return getStoreRows(table).map(r => ({ ...r }));
    }

    function getById(table, id) {
        const row = getStoreRows(table).find(r => r.id === id);
        return row ? { ...row } : null;
    }

    function query(table, fn) {
        return getStoreRows(table).filter(fn).map(r => ({ ...r }));
    }

    function count(table) {
        return getStoreRows(table).length;
    }

    function clear(table) {
        cache[table] = (cache[table] || []).filter(r => r.storeId !== currentStoreId);
        enqueueWrite('clear', table, null);
    }

    function resetAll() {
        TABLES.forEach(t => clear(t));
    }

    // ── synchronous cache mutations (immediate UI) ───────────────
    function insert(table, row) {
        const now = new Date().toISOString();
        const newRow = {
            ...row,
            id: row.id || generateId(table.slice(0, 1)),
            createdAt: row.createdAt || now,
            storeId: currentStoreId,
        };
        cache[table] = cache[table] || [];
        cache[table].push(newRow);
        enqueueWrite('upsert', table, [toDb(table, newRow)]);
        logAction('insert', table, newRow.id, { storeId: currentStoreId });
        return newRow;
    }

    function update(table, id, patch) {
        const idx = (cache[table] || []).findIndex(r => r.id === id && r.storeId === currentStoreId);
        if (idx === -1) return null;
        const updated = { ...cache[table][idx], ...patch, storeId: currentStoreId };
        cache[table][idx] = updated;
        enqueueWrite('upsert', table, [toDb(table, updated)]);
        logAction('update', table, id, { storeId: currentStoreId, patch });
        return updated;
    }

    function remove(table, id) {
        const idx = (cache[table] || []).findIndex(r => r.id === id && r.storeId === currentStoreId);
        if (idx === -1) return false;
        cache[table].splice(idx, 1);
        enqueueWrite('delete', table, null, { id });
        logAction('delete', table, id, { storeId: currentStoreId });
        return true;
    }

    function enqueueWrite(type, table, rows, extra = {}) {
        const box = getOutbox();
        box.push({
            type,
            table,
            workspaceId,
            storeId: currentStoreId,
            rows,
            ...extra,
            ts: Date.now(),
        });
        saveOutbox(box);
        // Fire-and-forget process; if offline it'll retry on next init
        processOutbox();
    }

    // ── order numbering (per store) ──────────────────────────────
    function nextOrderNumber() {
        const orders = getStoreRows('orders');
        const maxNum = orders.reduce((max, o) => Math.max(max, o.orderNumber || 0), 0);
        return maxNum + 1;
    }

    // ── settings helpers (per store) ─────────────────────────────
    function getSetting(key) {
        const row = getStoreRows('settings').find(s => s.key === key);
        return row ? row.value : null;
    }

    async function setSetting(key, value) {
        const existing = getStoreRows('settings').find(s => s.key === key);
        if (existing) {
            update('settings', existing.id, { value });
        } else {
            insert('settings', { key, value });
        }
    }

    // ── server-side report queries (scoped to workspace + current store) ──
    // Each returns at most `limit` rows; if the RPC returns limit+1 the caller
    // knows there are more pages. Rows are mapped through fromDb().
    // NOTE: p_store_id is passed explicitly because Supabase uses
    // transaction-pooled connections; current_store() session variable
    // does not persist across rpc() calls.
    async function queryOrders({ from, to, userId, limit = 100, offset = 0 } = {}) {
        const client = Supabase.getClient();
        if (!client) return { rows: [], hasMore: false };
        const { data, error } = await client.rpc('report_orders', {
            p_from: from || null,
            p_to: to || null,
            p_user_id: userId || null,
            p_store_id: currentStoreId || null,
            p_limit: limit,
            p_offset: offset,
        });
        if (error) { console.warn('report_orders:', error.message); return { rows: [], hasMore: false }; }
        const rows = (data || []).map(r => fromDb('orders', r));
        return { rows, hasMore: rows.length > limit };
    }

    async function queryShifts({ from, to, userId, limit = 100, offset = 0 } = {}) {
        const client = Supabase.getClient();
        if (!client) return { rows: [], hasMore: false };
        const { data, error } = await client.rpc('report_shifts', {
            p_from: from || null,
            p_to: to || null,
            p_user_id: userId || null,
            p_store_id: currentStoreId || null,
            p_limit: limit,
            p_offset: offset,
        });
        if (error) { console.warn('report_shifts:', error.message); return { rows: [], hasMore: false }; }
        const rows = (data || []).map(r => fromDb('shifts', r));
        return { rows, hasMore: rows.length > limit };
    }

    // ── public async API ─────────────────────────────────────────
    async function init() {
        Supabase.init();

        // 1. Auth session
        const session = await Supabase.getSession();
        if (!session) { window.location.href = 'login.html'; return false; }

        // 2. Profile → workspace + assigned stores
        const { profile, error: profileErr } = await Supabase.getProfile();
        if (profileErr) throw profileErr;
        workspaceId = (profile && profile.workspace_id) || session.user.id;

        // 3. Determine assigned stores for this user
        const client = Supabase.getClient();
        let storeRows = [];
        try {
            const { data, error } = await client.rpc('assigned_stores');
            if (!error && data) {
                storeRows = data; // array of store_ids
            }
        } catch (e) {
            console.warn('assigned_stores RPC failed:', e.message);
        }
        assignedStoreIds = storeRows.length ? storeRows : ['s1']; // fallback

        // 4. Pick current store (persist in sessionStorage for tab restore)
        const savedStore = sessionStorage.getItem('pos_current_store');
        if (savedStore && assignedStoreIds.includes(savedStore)) {
            currentStoreId = savedStore;
        } else {
            currentStoreId = assignedStoreIds[0];
        }
        sessionStorage.setItem('pos_current_store', currentStoreId);

        // 5. Set server-side store context (for RLS)
        try {
            await client.rpc('set_current_store', { p_store_id: currentStoreId });
        } catch (e) {
            console.warn('set_current_store:', e.message);
        }

        // 6. Ensure starter data exists for this workspace+store
        const seedErr = await Supabase.seedWorkspace();
        if (seedErr) console.warn('seed_workspace:', seedErr.message || seedErr);

        // 7. Hydrate cache for current store only (other stores loaded on demand)
        await Promise.all(TABLES.map(async (table) => {
            const { data, error } = await client
                .from(table)
                .select(selectColsFor(table))
                .eq('workspace_id', workspaceId)
                .eq('store_id', currentStoreId);
            if (error) throw error;
            cache[table] = (data || []).map(r => fromDb(table, r));
        }));

        processOutbox();
        return true;
    }

    function getWorkspaceId() { return workspaceId; }

    // Store context API
    function getCurrentStore() { return currentStoreId; }
    function getAssignedStores()
   
    
    
    { return [...assignedStoreIds]; }



     // Re-fetch assigned_stores() from the server (workspace admins get all
// stores implicitly, so this must be called after creating/deleting a
// store or changing staff assignments — otherwise the cached list from
// DB.init() goes stale and the switcher stays hidden even though the
// underlying data changed).
async function refreshAssignedStores() {
    const client = Supabase.getClient();
    if (!client) return assignedStoreIds;
    try {
        const { data, error } = await client.rpc('assigned_stores');
        if (!error && data) {
            assignedStoreIds = data.length ? data : ['s1'];
        }
    } catch (e) {
        console.warn('refreshAssignedStores:', e.message);
    }
    return [...assignedStoreIds];
}

    async function setCurrentStore(storeId) {
        if (!assignedStoreIds.includes(storeId)) {
            throw new Error('Store not assigned to current user');
        }
        const client = Supabase.getClient();
        const { error } = await client.rpc('set_current_store', { p_store_id: storeId });
        if (error) throw error;
        currentStoreId = storeId;
        sessionStorage.setItem('pos_current_store', storeId);

        // Re-hydrate cache for new store
        await Promise.all(TABLES.map(async (table) => {
            const { data, error } = await client
                .from(table)
                .select(selectColsFor(table))
                .eq('workspace_id', workspaceId)
                .eq('store_id', currentStoreId);
            if (error) throw error;
            cache[table] = (data || []).map(r => fromDb(table, r));
        }));

        // Notify app to refresh current page
        if (typeof App !== 'undefined' && App.refreshCurrentPage) {
            App.refreshCurrentPage();
        }
    }

    // Admin helper: load all stores for the workspace (for store picker)
    async function loadAllWorkspaceStores() {
        const client = Supabase.getClient();
        const { data, error } = await client
            .from('stores')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('enabled', true);
        if (error) throw error;
        return (data || []).map(r => fromDb('stores', r));
    }

    // Admin helper: create/update/delete store
    async function upsertStore(row) {
        const client = Supabase.getClient();
        const dbRow = toDb('stores', row);
        delete dbRow.store_id; // 'stores' is not itself store-scoped — toDb() injects
                                // store_id for every table, but public.stores has no
                                // such column, which is exactly what caused the
                                // "Could not find the 'store_id' column of 'stores'" error.
        const { data, error } = await client.from('stores').upsert(dbRow, { onConflict: 'workspace_id,id' }).select().single();
        if (error) throw error;
        // Also ensure seed for new store (pass the store ID so it gets defaults)
        await client.rpc('seed_workspace', { p_store_id: row.id });
        return fromDb('stores', data);
    }

    async function deleteStore(storeId) {
        if (storeId === 's1') throw new Error('Cannot delete default store');
        const client = Supabase.getClient();
        const { error } = await client.from('stores').delete().eq('workspace_id', workspaceId).eq('id', storeId);
        if (error) throw error;
    }

    // Admin helper: assign/unassign user to store
    async function assignUserToStore(userId, storeId) {
        const client = Supabase.getClient();
        const { error } = await client.from('user_stores').upsert({
            workspace_id: workspaceId,
            user_id: userId,
            store_id: storeId,
        }, { onConflict: 'workspace_id,user_id,store_id' });
        if (error) throw error;
    }

    async function unassignUserFromStore(userId, storeId) {
        const client = Supabase.getClient();
        const { error } = await client.from('user_stores')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .eq('store_id', storeId);
        if (error) throw error;
    }

    async function getUserStoreAssignments(userId) {
        const client = Supabase.getClient();
        const { data, error } = await client
            .from('user_stores')
            .select('store_id')
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId);
        if (error) throw error;
        return (data || []).map(r => r.store_id);
    }

    // ── public API ───────────────────────────────────────────────
    return {
        generateId,
        init,
        getWorkspaceId,
        getCurrentStore,
        getAssignedStores,
        refreshAssignedStores,
        setCurrentStore,
        loadAllWorkspaceStores,
        upsertStore,
        deleteStore,
        assignUserToStore,
        unassignUserFromStore,
        getUserStoreAssignments,

        logAction,

        getAll,
        getById,
        query,
        count,
        clear,
        resetAll,
        insert,
        update,
        remove,
        nextOrderNumber,
        getSetting,
        setSetting,
        queryOrders,
        queryShifts,
    };
})();
