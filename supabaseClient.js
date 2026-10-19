// supabaseClient.js – creates a Supabase client and exports helpers
const config = window.ODDZONE_CONFIG?.supabase || window.ODDZONE_SUPABASE_CONFIG || {
    url: 'https://csrfrzzpduhhzldirdfi.supabase.co',
    anonKey: 'sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj'
};

const supabaseUrl = config.url;
const supabaseAnonKey = config.anonKey;

export const supabase = (window.supabase && typeof window.supabase.createClient === 'function')
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true }
    })
    : null;

// Google sign‑in helper
export const signInWithGoogle = async () => {
    const client = supabase || (window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null);
    if (!client) {
        console.error("Supabase client is not available for Google login.");
        if (typeof window.setAuthStatus === 'function') {
            window.setAuthStatus('Authentication service unavailable.', true);
        }
        return;
    }
    try {
        if (typeof window.setAuthStatus === 'function') {
            window.setAuthStatus('Connecting to Google...');
        }
        const redirectUrl = (window.location.origin && window.location.origin !== 'null')
            ? window.location.origin + window.location.pathname
            : window.location.href.split('#')[0].split('?')[0];

        const { data, error } = await client.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: redirectUrl },
        });
        if (error) {
            console.error("Google login error:", error);
            if (typeof window.setAuthStatus === 'function') {
                window.setAuthStatus(error.message || 'Google sign-in failed.', true);
            }
        }
    } catch (err) {
        console.error("Google sign-in exception:", err);
        if (typeof window.setAuthStatus === 'function') {
            window.setAuthStatus(err.message || 'Google sign-in failed.', true);
        }
    }
};

// Expose globals for traditional inline onclick handlers and non-module scripts
window.supabaseClientInstance = supabase;
window.signInWithGoogle = signInWithGoogle;
