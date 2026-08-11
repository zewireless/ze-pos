/**
 * Auth – Supabase-backed authentication & session management.
 *
 * currentUser() returns the signed-in account's workspace "users" row (owner or
 * linked cashier), so all existing per-user logic (shifts, schedules, payroll)
 * keeps working unchanged. Membership is resolved via profiles.workspace_id:
 * the owner's workspace is their own uid; cashiers get linked when they join
 * with an invite code. The session marker is kept in sessionStorage.
 */
const Auth = (() => {
    const SESSION_KEY = 'pos_session';        // current (owner or staff) session marker
    const OWNER_SESSION_KEY = 'pos_owner_session'; // stashed owner marker, so staff can switch back

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

    // Record an owner session and stash a copy so a staff member can switch back.
    function saveOwnerSession(userRow, profile) {
        saveSession(userRow, profile, { isStaff: false });
        const marker = sessionStorage.getItem(SESSION_KEY);
        if (marker) sessionStorage.setItem(OWNER_SESSION_KEY, marker);
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
            sessionStorage.removeItem(OWNER_SESSION_KEY);
            return null;
        }
        const isOwner = !!(profile && profile.workspace_id === uid);
        if (isOwner) {
            saveOwnerSession(row, profile || { email: (profile && profile.email) || '' });
        } else {
            sessionStorage.removeItem(OWNER_SESSION_KEY);
            saveSession(row, profile || {}, { isStaff: true });
        }
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
            return { user: null, error: new Error('This account is not linked to a workspace. Ask your manager for an invite code.') };
        }
        if (row.enabled === false) {
            await Supabase.signOut();
            return { user: null, error: new Error('This account is disabled. Ask your manager.') };
        }
        await setSession(profile);
        return { user: currentUser(), error: null };
    }

    // ── Staff login ────────────────────────────────────────────
    // Staff members don't have Supabase accounts — they clock in at a register
    // that the owner already signed into. Their username/password is verified
    // against the workspace "users" table and the in-app session marker switches
    // to that staff row (attribution only). Data access still rides the owner's
    // Supabase session, so RLS stays intact.
    async function loginAsStaff(username, password) {
        // Record the owner marker first so the staff member can switch back.
        const session = await Supabase.getSession();
        if (!session) return { user: null, error: new Error('No active account session') };
        const { profile } = await Supabase.getProfile();
        const uid = session.user.id;
        const owner = DB.getById('users', uid) || {
            id: uid,
            name: (profile && profile.business_name) || 'Owner',
            role: 'admin',
            username: (profile && profile.email) || '',
        };
        saveOwnerSession(owner, profile || { email: (profile && profile.email) || '' });

        const matches = DB.query('users', u => u.username === username);
        if (matches.length === 0) {
            return { user: null, error: new Error('No staff member with that username') };
        }
        const staff = matches[0];
        if (staff.enabled === false) {
            return { user: null, error: new Error('This account is disabled') };
        }
        if (!(await verifyPassword(password, staff.password))) {
            return { user: null, error: new Error('Invalid username or password') };
        }
        // Upgrade a legacy plaintext password to a hash on successful login.
        if (staff.password && !staff.password.startsWith('sha256:')) {
            DB.update('users', staff.id, { password: await hashPassword(password) });
        }
        saveSession(staff, {}, { isStaff: true });
        return { user: currentUser(), error: null };
    }

    function switchToOwner() {
        const marker = sessionStorage.getItem(OWNER_SESSION_KEY);
        if (!marker) return null;
        sessionStorage.setItem(SESSION_KEY, marker);
        return currentUser();
    }

    function isStaffSession() {
        const u = currentUser();
        return !!(u && u.isStaff);
    }

    // True when this device has a stashed owner session (shared-register model).
    // Direct cashier logins have no owner marker, so "Back to Owner" is hidden.
    function hasOwnerSession() {
        return !!sessionStorage.getItem(OWNER_SESSION_KEY);
    }

    // ── Password hashing (Web Crypto, SHA-256) ─────────────────
    // Requires a secure context — HTTPS on the live site is fine.
    async function hashPassword(password) {
        const data = new TextEncoder().encode('ze-pos:' + password);
        const buf = await crypto.subtle.digest('SHA-256', data);
        const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
        return 'sha256:' + hex;
    }

    async function verifyPassword(input, stored) {
        if (!stored) return false;
        if (stored.startsWith('sha256:')) {
            return (await hashPassword(input)) === stored;
        }
        return stored === input; // legacy plaintext (pre-hashing staff records)
    }

    async function logout() {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(OWNER_SESSION_KEY);
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
        loginAsStaff,
        switchToOwner,
        isStaffSession,
        hasOwnerSession,
        hashPassword,
        verifyPassword,
    };
})();
