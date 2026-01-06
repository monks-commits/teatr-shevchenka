import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export async function loadSupabaseFromSettings(){
  const res = await fetch("../data/settings.json", { cache:"no-store" });
  if(!res.ok) throw new Error("settings.json HTTP " + res.status);
  const s = await res.json();

  const url = s?.supabase?.url || s?.supabase_url || "";
  const anon = s?.supabase?.anon_key || s?.supabase_anon_key || "";

  if(!url || !anon){
    throw new Error("В settings.json немає supabase.url або supabase.anon_key");
  }
  return createClient(url, anon, { auth: { persistSession: true } });
}
