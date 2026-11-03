import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  // Allows `next build` to prerender without credentials; auth calls fail until set
  console.warn('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// Browser client; the session is persisted in localStorage and its access
// token is sent to the backend as a Bearer token (see lib/api.ts).
export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'public-anon-key-not-set',
  { auth: { persistSession: true, autoRefreshToken: true } }
);
