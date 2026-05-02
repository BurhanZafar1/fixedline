import { createBrowserClient } from '@supabase/auth-helpers-nextjs';

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  // This fires during build — still want a usable client
  console.warn('Missing Supabase env vars');
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
