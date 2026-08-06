/**
 * DB – cloud-backed, local-first data layer.
 *
 * Keeps the exact synchronous API the app modules use
 * (getAll / getById / query / insert / update / remove / count / clear /
 * nextOrderNumber / getSetting / setSetting), but:
 *   - DB.init() hydrates an in-memory cache from Supabase (per workspace).
 *   - Every mutation updates the cache immediately (snappy UI) and is
 *     written through to Supabase in the background, with retry on failure.
 *
 * Columns are snake_case in the DB; app rows use camelCase. FIELD_MAP
 * translates between them.
 */
const DB = (() => {
    let workspaceId = null;
    let cache = {};

    const TABLES = [
        'users', 'categories', 'menu_items', 'menu_sizes', 'condiments', 'taxes',
        'orders', 'order_items', 'shifts', 'shift_schedules', 'payrolls', 'settings',
    ];

    // camelCase (app) → snake_case (column). Keys absent here pass through unchanged.
    const FIELD_MAP = {
        users: { payType: 'pay_type', hourlyRate: 'hourly_rate', fixedSalary: 'fixed_salary', createdAt: 'created_at' },
        categories: { createdAt: 'created_at' },
        menu_items: { categoryId: 'category_id', createdAt: 'created_at' },
        menu_sizes: { menuItemId: 'menu_item_id', createdAt: 'created_at' },
        condiments: { createdAt: 'created_at' },
        taxes: { createdAt: 'created_at' },
        orders: {
            orderNumber: 'order_number', taxName: 'tax_name', taxPercentage: 'tax_percentage',
            taxAmount: 'tax_amount', userId: 'user_id', userName: 'user_name',
            shiftId: 'shift_id', createdAt: 'created_at',
        },
        order_items: { orderId: 'order_id', menuItemId: 'menu_item_id', unitPrice: 'unit_price', lineTotal: 'line_total' },
        shifts: {
            userId: 'user_id', userName: 'user_name', startTime: 'start_time', endTime: 'end_time',
            startingCash: 'starting_cash', endingCash: 'ending_cash', cashDifference: 'cash_difference',
            totalSales: 'total_sales', orderCount: 'order_count', scheduleId: 'schedule_id',
            payRate: 'pay_rate', createdAt: 'created_at',
        },
        shift_schedules: { userId: 'user_id', dayOfWeek: 'day_of_week', createdAt: 'created_at' },
        payrolls: { fromDate: 'from_date', toDate: 'to_date', totalPay: 'total_pay', createdAt: 'created_at', paidAt: 'paid_at' },
        settings: { createdAt: 'created_at' },
    };

    function reverseMap(table) {
        const m = FIELD_MAP[table] || {};
        const r = {};
        Object.keys(m).forEach(k => { r[m[k]] = k; });
        return r;
    }

    function toDb(table, row) {
        const m = FIELD_MAP[table] || {};
        const out = { workspace_id: workspaceId };
        Object.keys(row).forEach(k => { out[m[k] || k] = row[k]; });
        return out;
    }

    function fromDb(table, row) {
        const r = reverseMap(table);
        const out = {};
        Object.keys(row).forEach(k => { out[r[k] || k] = row[k]; });
        return out;
    }

    // ── sync (write-through with outbox + retry) ───────────────
    const outbox = {};   // table → [{action, payload}]
    let flushing = false;
    let retryTimer = null;

    async function runOp(table, op) {
        const client = Supabase.getClient();
        if (!client) throw new Error('Supabase not initialized');
        if (op.action === 'clear') {
            const { error } = await client.from(table).delete().eq('workspace_id', workspaceId);
            if (error) throw error;
        } else if (op.action === 'delete') {
            for (const id of op.payload) {
                const { error } = await client.from(table).delete().eq('workspace_id', workspaceId).eq('id', id);
                if (error) throw error;
            }
        } else if (op.action === 'upsert') {
            const rows = op.payload.map(r => toDb(table, r));
            const { error } = await client.from(table).upsert(rows, { onConflict: 'workspace_id,id' });
            if (error) throw error;
        }
    }

    async function processOutbox() {
        if (flushing || !Supabase.getClient()) return;
        flushing = true;
        try {
            for (const table of Object.keys(outbox)) {
                const queue = outbox[table];
                while (queue.length) {
                    const op = queue[0];
                    try {
                        await runOp(table, op);
                        queue.shift();
                    } catch (err) {
                        console.warn('Sync pending (will retry):', table, err.message || err);
                        if (!retryTimer) {
                            retryTimer = setTimeout(() => { retryTimer = null; processOutbox(); }, 30000);
                        }
                        break;
                    }
                }
                if (!queue.length) delete outbox[table];
            }
        } finally {
            flushing = false;
        }
    }

    function syncWrite(table, action, payload) {
        if (!Supabase.getClient()) return;
        (outbox[table] = outbox[table] || []).push({ action, payload });
        processOutbox();
    }

    // ── helpers ───────────────────────────────────────────────
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    function getStore(table) {
        if (!cache[table]) cache[table] = [];
        return cache[table];
    }

    // ── init / hydrate ────────────────────────────────────────
    async function init() {
        const session = await Supabase.getSession();
        if (!session) throw new Error('Not signed in');
        workspaceId = session.user.id;

        // Ensure starter data exists for this workspace (idempotent)
        const seedErr = await Supabase.seedWorkspace();
        if (seedErr) console.warn('seed_workspace:', seedErr.message || seedErr);

        const client = Supabase.getClient();
        await Promise.all(TABLES.map(async (table) => {
            const { data, error } = await client.from(table).select('*').eq('workspace_id', workspaceId);
            if (error) throw error;
            cache[table] = (data || []).map(r => fromDb(table, r));
        }));

        processOutbox();
        return true;
    }

    function getWorkspaceId() { return workspaceId; }

    // ── public API (synchronous over the cache) ───────────────
    return {
        generateId,
        init,
        getWorkspaceId,

        getAll(table) {
            return [...getStore(table)];
        },

        getById(table, id) {
            const item = getStore(table).find(i => i.id === id);
            return item ? { ...item } : null;
        },

        query(table, filterFn) {
            return getStore(table).filter(filterFn).map(i => ({ ...i }));
        },

        insert(table, record) {
            const data = getStore(table);
            const newRecord = {
                id: generateId(),
                createdAt: new Date().toISOString(),
                ...record,
            };
            data.push(newRecord);
            syncWrite(table, 'upsert', [newRecord]);
            return newRecord;
        },

        update(table, id, updates) {
            const data = getStore(table);
            const idx = data.findIndex(i => i.id === id);
            if (idx === -1) return null;
            data[idx] = { ...data[idx], ...updates };
            syncWrite(table, 'upsert', [data[idx]]);
            return { ...data[idx] };
        },

        remove(table, id) {
            const data = getStore(table);
            const filtered = data.filter(i => i.id !== id);
            if (filtered.length === data.length) return false;
            cache[table] = filtered;
            syncWrite(table, 'delete', [id]);
            return true;
        },

        clear(table) {
            cache[table] = [];
            syncWrite(table, 'clear', []);
            return true;
        },

        count(table, filterFn) {
            const data = getStore(table);
            return filterFn ? data.filter(filterFn).length : data.length;
        },

        nextOrderNumber() {
            const orders = getStore('orders');
            if (orders.length === 0) return 1;
            return Math.max(...orders.map(o => o.orderNumber || 0)) + 1;
        },

        // Settings stored per workspace in the settings table
        getSetting(key) {
            const s = getStore('settings').find(x => x.key === key);
            return s ? s.value : null;
        },

        setSetting(key, value) {
            const data = getStore('settings');
            const idx = data.findIndex(s => s.key === key);
            if (idx !== -1) {
                data[idx].value = value;
                syncWrite('settings', 'upsert', [data[idx]]);
            } else {
                this.insert('settings', { key, value });
            }
        },

        // Cloud mode: seeding happens via the seed_workspace RPC. resetAll
        // clears every tenant table so the workspace re-seeds on next boot.
        seed() { return false; },
        resetAll() {
            TABLES.forEach(t => this.clear(t));
            return true;
        },
    };
})();
