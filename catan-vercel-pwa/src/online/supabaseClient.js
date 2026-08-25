import { createClient } from "@supabase/supabase-js";

// Cliente Supabase, o null si el entorno no está configurado.
// Sin configuración la app funciona igual (modo local/offline);
// solo se oculta la opción de jugar online.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

export const isOnlineConfigured = supabase !== null;

// Sesión anónima: la crea si no existe y devuelve el user id.
export async function ensureAnonSession() {
  if (!supabase) throw new Error("Supabase no configurado");
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user.id;
}
