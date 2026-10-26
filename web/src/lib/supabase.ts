import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Dirección del proyecto y clave publicable. Las dos son públicas por diseño:
 * viajan en el navegador de todos modos, y lo que protege los datos son los
 * permisos por fila de la base (supabase/migrations). La clave que no debe
 * salir nunca de la PC del procesador es la service_role, y esa no está acá.
 */
export const SUPABASE_URL = "https://vqabgnynidehfqueupki.supabase.co";
export const SUPABASE_CLAVE_PUBLICA = "sb_publishable_bWYu2n_e7XAOYv2OxK5JpA_6Jpw2-p_";

let cliente: SupabaseClient | null = null;

/**
 * Un solo cliente para toda la app, creado recién en el navegador: la página
 * también se prerenderiza al construir, donde no hay sesión ni localStorage.
 */
export function supabase(): SupabaseClient {
  cliente ??= createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
    auth: {
      // PKCE: Google devuelve un código de un solo uso que se canjea acá, en
      // vez de dejar el token a la vista en la URL.
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cliente;
}
