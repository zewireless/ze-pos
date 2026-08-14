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
    };
})();
