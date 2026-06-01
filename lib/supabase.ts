import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  url && key
    ? createClient(url, key, {
        auth: { detectSessionInUrl: true, persistSession: true, flowType: "pkce" },
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
