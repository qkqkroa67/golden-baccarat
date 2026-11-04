import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { username: rawUsername, password } = await request.json();
    const username = typeof rawUsername === 'string' ? rawUsername.trim().toLowerCase() : '';
    if (!/^[a-z0-9_]{3,20}$/.test(username) || typeof password !== 'string' || password.length === 0) {
      return json({ error: 'Invalid login' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL');
    // A public project key is sent by the browser's Supabase client as `apikey`.
    // This also supports projects that use publishable keys without a legacy anon key.
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || publishableKeys.default || request.headers.get('apikey');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || secretKeys.default;
    if (!url || !anonKey || !serviceRoleKey) return json({ error: 'Authentication service is not configured' }, 500);

    const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('user_id')
      .eq('username', username)
      .maybeSingle();
    if (profileError || !profile) return json({ error: 'Invalid login' }, 401);

    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
    const email = userResult.user?.email;
    if (userError || !email) return json({ error: 'Invalid login' }, 401);

    const publicClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) return json({ error: 'Invalid login' }, 401);
    return json({ session: data.session });
  } catch {
    return json({ error: 'Invalid login' }, 400);
  }
});

