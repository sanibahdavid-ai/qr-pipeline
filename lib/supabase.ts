import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// autoRefreshToken is off on purpose: the configured project is currently
// unreachable, and the refresh loop retries forever, flooding the console with
// hundreds of failed requests and burying real errors. Cloud history is
// optional and PIN access no longer depends on this session. Turn it back on
// if the Supabase project is restored and Google sign-in is used again.
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
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
