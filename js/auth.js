/**
 * Auth – Supabase-backed authentication & session management.
 *
 * currentUser() returns the signed-in account's workspace "users" row (owner or
 * linked cashier), so all existing per-user logic (shifts, schedules, payroll)
 * keeps working unchanged. Membership is resolved via profiles.workspace_id:
 * the owner's workspace is their own uid; cashiers get linked when they join
 * with an invite code.
 *
 * SECURITY MODEL (003): every person signs in with their OWN Supabase account —
 * there is no shared-register "clock in" path. Authorization is enforced
 * server-side by RLS keyed to the signed-in identity (users.auth_uid); the
 * session marker below only mirrors the server row for UI rendering and is not
 * a security boundary.
 */
/**
 * Lockout — client-side brute-force protection for auth flows.
 *
 * Tracks failed attempts per identifier (email) in localStorage and applies
 * fixed lockout tiers (req: 5 fails → 15 min, 10 fails → 1 hour). It also
 * optionally layers on a server-side RPC (`Supabase.checkAuthLock` /
 * `recordAuthFailure` / `clearAuthLock`, see migration 006) which adds true
 * per-IP protection that localStorage can't provide (a user can clear their
 * own storage, but not the server's). Server calls are best-effort: if the
 * migration isn't deployed yet they silently no-op and the client layer
 * remains the guaranteed fallback.
 *
 * NOTE: client-side "per IP" isn't possible (the browser doesn't expose the
 * visitor IP), so the client layer keys on email; per-IP is handled entirely
 * by the server RPC.
 */
const Lockout = (() => {
    const TIER1 = 6;                  // attempt count that triggers the first lockout
    const TIER1_MS = 1 * 60 * 1000;  // 1 minutes
    const TIER2 = 10;                 // attempt count that triggers the long lockout
    const TIER2_MS = 5 * 60 * 1000;  // 1 hour
    const PREFIX = 'ze_lockout_';

    const _read = (ns) => {
        try { return JSON.parse(localStorage.getItem(PREFIX + ns) || '{}'); }
        catch { return {}; }
    };
    const _write = (ns, data) => {
        try { localStorage.setItem(PREFIX + ns, JSON.stringify(data)); } catch {}
    };

    function get(ns, id) {
        const data = _read(ns);
        return data[id] || { attempts: 0, lockedUntil: 0 };
    }

    function set(ns, id, info) {
        const data = _read(ns);
        data[id] = info;
        _write(ns, data);
    }

    function clear(ns, id) {
        const data = _read(ns);
        if (id in data) {
            delete data[id];
            _write(ns, data);
        }
    }

    // Client-only check. Expired locks are wiped so the counter restarts clean.
    function check(ns, id) {
        const info = get(ns, id);
        const now = Date.now();
        if (info.lockedUntil > now) {
            return { locked: true, msRemaining: info.lockedUntil - now, info };
        }
        if (info.lockedUntil && info.lockedUntil <= now && info.attempts > 0) {
            clear(ns, id);
        }
        return { locked: false, msRemaining: 0, info: { attempts: 0, lockedUntil: 0 } };
    }

    // Client-only record. Returns the resulting state.
    function recordFailure(ns, id) {
        const info = get(ns, id);
        const now = Date.now();
        const attempts = info.attempts + 1;
        let lockedUntil = 0, tier = 0;
        if (attempts >= TIER2) {
            lockedUntil = now + TIER2_MS;
            tier = 2;
        } else if (attempts >= TIER1) {
            lockedUntil = now + TIER1_MS;
            tier = 1;
        }
        set(ns, id, { attempts, lockedUntil });
        return { attempts, lockedUntil, tier, locked: lockedUntil > now };
    }

    function format(ms) {
        const total = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    // Live countdown. Updates `el` every second until unlocked, then clears it
    // and invokes onExpire (e.g. to re-enable the form). Returns a stop fn.
    function startCountdown(el, lockedUntil, onExpire) {
        let timer = null;
        const render = () => {
            const remaining = lockedUntil - Date.now();
            if (remaining <= 0) {
                if (timer) clearInterval(timer);
                el.style.display = 'none';
                if (onExpire) onExpire();
                return;
            }
            el.textContent = `Too many failed attempts. Try again in ${format(remaining)}.`;
            el.style.display = 'block';
        };
        render();
        timer = setInterval(render, 1000);
        return () => { if (timer) clearInterval(timer); };
    }

    // ---- async, server-aware wrappers (graceful if RPC absent) ----

    async function preCheck(ns, id) {
        const client = check(ns, id);
        let server = { locked: false, msRemaining: 0 };
        if (window.Supabase && Supabase.checkAuthLock) {
            try { server = (await Supabase.checkAuthLock(ns, id)) || server; } catch {}
        }
        const ms = Math.max(client.msRemaining, server.msRemaining || 0);
        return { locked: client.locked || server.locked, msRemaining: ms, lockedUntil: Date.now() + ms };
    }

    async function record(ns, id) {
        const client = recordFailure(ns, id);
        let server = { locked: false, msRemaining: 0 };
        if (window.Supabase && Supabase.recordAuthFailure) {
            try { server = (await Supabase.recordAuthFailure(ns, id)) || server; } catch {}
        }
        const now = Date.now();
        const ms = Math.max(
            client.locked ? client.lockedUntil - now : 0,
            server.msRemaining || 0
        );
        return {
            locked: client.locked || server.locked,
            lockedUntil: now + ms,
            tier: client.tier,
            attempts: client.attempts,
        };
    }

    async function reset(ns, id) {
        clear(ns, id);
        if (window.Supabase && Supabase.clearAuthLock) {
            try { await Supabase.clearAuthLock(ns, id); } catch {}
        }
    }

    return {
        get, set, clear, check, recordFailure, format, startCountdown,
        preCheck, record, reset,
        TIER1, TIER2, TIER1_MS, TIER2_MS,
    };
})();

const Auth = (() => {
    const SESSION_KEY = 'pos_session';

    function currentUser() {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function saveSession(userRow, profile, opts) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            id: userRow.id,
            name: userRow.name || 'Owner',
            role: userRow.role || 'admin',
            username: userRow.username || (profile && profile.email) || '',
            email: (profile && profile.email) || null,
            isSuperAdmin: !!(profile && profile.is_super_admin),
            isStaff: !!(opts && opts.isStaff),
        }));
    }

    // The signed-in account's row in the workspace "users" table.
    // Owner rows carry auth_uid = their own uid (and id = workspace uid for
    // legacy rows); cashier rows get auth_uid set when they join.
    function resolveUserRow(uid, profile) {
        const byAuth = DB.query('users', u => u.authUid === uid)[0];
        if (byAuth) return byAuth;
        return DB.getById('users', uid) || null;
    }

    // Build + store the session marker. Decides owner vs member from the
    // profile's workspace (owner: workspace_id === their own uid). Called after
    // DB.init() so the users table is hydrated for resolveUserRow.
    async function setSession(profile) {
        const session = await Supabase.getSession();
        if (!session) return null;
        const uid = session.user.id;
        const row = resolveUserRow(uid, profile);
        if (!row || row.enabled === false) {
            await Supabase.signOut();
            sessionStorage.removeItem(SESSION_KEY);
            return null;
        }
        const isOwner = !!(profile && profile.workspace_id === uid);
        saveSession(row, profile || {}, { isStaff: !isOwner });
        return currentUser();
    }

    async function login(email, password) {
        const { session, error } = await Supabase.signIn(email, password);
        if (error || !session) return { user: null, error };
        try {
            await DB.init();
        } catch (err) {
            await Supabase.signOut();
            return { user: null, error: err };
        }
        const { profile } = await Supabase.getProfile();
        const uid = session.user.id;
        const row = resolveUserRow(uid, profile);
        if (!row) {
            await Supabase.signOut();
            sessionStorage.removeItem(SESSION_KEY);
            return { user: null, error: new Error('This account is not linked to a workspace. Ask your manager for an invite code.') };
        }
        if (row.enabled === false) {
            await Supabase.signOut();
            return { user: null, error: new Error('This account is disabled. Ask your manager.') };
        }
        await setSession(profile);
        return { user: currentUser(), error: null };
    }

    async function logout() {
        sessionStorage.removeItem(SESSION_KEY);
        await Supabase.signOut();
        window.location.href = 'index.html';
    }

    // ── password reset (003+ UI) ─────────────────────────────
    // Sends a reset link. redirectTo must be an allowlisted Supabase
    // Redirect URL (see config.js email-template notes). The link returns
    // to index.html#access_token=...&type=recovery, which index.html
    // detects and turns into the "set new password" form.
    async function requestPasswordReset(email) {
        const client = Supabase.getClient();
        if (!client) return { error: new Error('Supabase not initialized') };
        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/index.html',
        });
        return { error };
    }

    // Used by the recovery form in index.html. A session already exists from
    // the recovery token in the URL fragment, so updateUser() succeeds.
    async function updatePassword(password) {
        const client = Supabase.getClient();
        if (!client) return { error: new Error('Supabase not initialized') };
        const { error } = await client.auth.updateUser({ password });
        return { error };
    }

    function isLoggedIn() {
        return !!currentUser();
    }

    function isAdmin() {
        const u = currentUser();
        return u && u.role === 'admin';
    }

    function isSuperAdmin() {
        const u = currentUser();
        return !!(u && u.isSuperAdmin);
    }

    function requireAuth() {
        if (!currentUser()) {
            window.location.href = 'index.html';
            return false;
        }
        return true;
    }

    return {
        login,
        logout,
        currentUser,
        isLoggedIn,
        isAdmin,
        isSuperAdmin,
        requireAuth,
        setSession,
        requestPasswordReset,
        updatePassword,
    };
})();
