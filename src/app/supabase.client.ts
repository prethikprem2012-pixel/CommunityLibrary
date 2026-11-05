import { createClient, SupabaseClient } from '@supabase/supabase-js';

type RuntimeEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

const env = (import.meta as ImportMeta & { env?: RuntimeEnv }).env ?? {};
const supabaseUrl = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (null as unknown as SupabaseClient);
