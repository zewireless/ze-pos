/**
 * Auth – Supabase-backed authentication & session management.
 *
 * currentUser() returns the workspace "users" row (owner has id = auth uid,
 * role admin), so all existing per-user logic (shifts, schedules, payroll)
 * keeps working unchanged. The session marker is kept in sessionStorage.
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

    function saveSession(userRow, profile) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            id: userRow.id,
            name: userRow.name || 'Owner',
            role: userRow.role || 'admin',
            username: userRow.username || (profile && profile.email) || '',
            email: (profile && profile.email) || null,
            isSuperAdmin: !!(profile && profile.is_super_admin),
        }));
    }

    // Build + store the session marker from the current Supabase profile and
    // the (already seeded) workspace owner row. Called after DB.init().
    async function setSession(profile) {
        const session = await Supabase.getSession();
        if (!session) return null;
        const uid = session.user.id;
        const owner = DB.getById('users', uid) || {
            id: uid,
            name: (profile && profile.business_name) || 'Owner',
            role: 'admin',
            username: (profile && profile.email) || '',
        };
        saveSession(owner, profile || { email: (profile && profile.email) || '' });
        return currentUser();
    }

    async function login(email, password) {
        const { session, error } = await Supabase.signIn(email, password);
        if (error || !session) return { user: null, error };
        const { profile } = await Supabase.getProfile();
        const owner = {
            id: session.user.id,
            name: (profile && profile.business_name) || 'Owner',
            role: 'admin',
            username: email,
        };
        saveSession(owner, profile || { email });
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

    function requireAdmin() {
        if (!isAdmin()) {
            window.location.href = 'app.html';
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
        requireAdmin,
        setSession,
    };
})();
