import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Session persistence and auto-refresh are off on purpose: the configured
// project is unreachable, so a stale token left in localStorage gets reloaded
// and retried on every page load, flooding the console with failed requests and
// burying real errors. Sign-in still completes within a page load
// (detectSessionInUrl), and cloud history is optional — PIN access does not
// depend on this session.
//
// Restore both flags if the Supabase project comes back. The permanent fix if
// it does not is to drop NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, which makes this
// export null and the feature cleanly inert — every call site already guards
// on that.
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          detectSessionInUrl: true,
          persistSession: false,
          flowType: "pkce",
          autoRefreshToken: false,
        },
      })
    : null;

export type GenerationRow = {
  id: string;
  user_id: string;
  created_at: string;
  video_title: string | null;
  script_fr: string | null;
  script_en: string | null;
  script_de: string | null;
  script_es: string | null;
  titre_fr: string | null;
  titre_en: string | null;
  titre_de: string | null;
  titre_es: string | null;
};
