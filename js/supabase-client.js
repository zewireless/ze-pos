/**
 * Supabase – thin wrapper around supabase-js for auth + profile access.
 * Load AFTER supabase-js and config.js.
 */
const Supabase = (() => {
    let client = null;

    function init() {
        if (client) return client;
        if (!window.supabase) {
            console.error('supabase-js not loaded — add the CDN script to the page.');
            return null;
        }
        const cfg = window.ZE_CONFIG || {};
        if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT') || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
            console.error('Set SUPABASE_URL / SUPABASE_ANON_KEY in config.js first.');
            return null;
        }
        client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
        return client;
    }

    function getClient() { return client; }

    async function getSession() {
        if (!client) return null;
        const { data } = await client.auth.getSession();
        return data.session || null;
    }

    async function getProfile() {
        if (!client) return { profile: null, error: new Error('Supabase not initialized') };
        const { data, error } = await client.from('profiles').select('*').maybeSingle();
        return { profile: data || null, error };
    }

    async function signUp({ email, password, businessName }) {
        if (!client) return { error: new Error('Supabase not initialized') };
        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: { data: { business_name: businessName } },
        });
        return { user: data.user || null, error };
    }

    async function signIn(email, password) {
        if (!client) return { error: new Error('Supabase not initialized') };
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        return { session: data.session || null, error };
    }

    async function signOut() {
        if (!client) return;
        await client.auth.signOut();
    }

    // Seed starter data for this workspace (idempotent, called after first login)
    async function seedWorkspace() {
        if (!client) return new Error('Supabase not initialized');
        const { error } = await client.rpc('seed_workspace');
        return error;
    }

    return {
        init,
        getClient,
        getSession,
        getProfile,
        signUp,
        signIn,
        signOut,
        seedWorkspace,
    };
})();
