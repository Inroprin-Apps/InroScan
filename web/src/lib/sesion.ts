"use client";

import { useEffect, useState } from "react";
import { BASE_PATH } from "./base";
import { mensajeDeIngreso, paramsDeRetorno } from "./errores-de-ingreso";
import { supabase } from "./supabase";

export type Persona = {
  id: string;
  correo: string;
  nombre: string;
  es_administracion: boolean;
};

export type Sesion =
  | { estado: "cargando" }
  | { estado: "fuera"; aviso: string | null }
  | { estado: "dentro"; persona: Persona };

/** Quién está dentro, si alguien. Se actualiza solo al entrar o salir. */
export function useSesion(): Sesion {
  const [sesion, setSesion] = useState<Sesion>({ estado: "cargando" });

  useEffect(() => {
    const cliente = supabase();

    // El aviso del retorno se lee una vez y se saca de la URL: si no, una
    // recarga lo volvería a mostrar como si hubiera vuelto a fallar.
    let aviso = mensajeDeIngreso(paramsDeRetorno(window.location.href));
    if (aviso) window.history.replaceState(null, "", `${BASE_PATH}/`);

    let vigente = true;
    const mostrar = async (uid: string | null) => {
      if (!uid) {
        if (vigente) setSesion({ estado: "fuera", aviso });
        return;
      }
      const { data, error } = await cliente
        .from("personas")
        .select("id, correo, nombre, es_administracion")
        .eq("id", uid)
        .single();
      if (!vigente) return;
      // Sin fila de persona (desactivada, o el alta falló) no hay nada que
      // mostrar: se cierra la sesión en vez de dejar una pantalla vacía. El
      // aviso se fija antes, porque el cierre dispara SIGNED_OUT y ese vuelve
      // a pintar la pantalla de ingreso con el aviso vigente.
      if (error || !data) {
        aviso = "Tu cuenta no está habilitada en InroScan. Pídeselo a administración.";
        await cliente.auth.signOut();
        return;
      }
      setSesion({ estado: "dentro", persona: data });
    };

    // INITIAL_SESSION llega cuando el cliente terminó de arrancar, incluido el
    // canje del código que devuelve Google.
    const { data: escucha } = cliente.auth.onAuthStateChange((evento, s) => {
      if (evento === "INITIAL_SESSION" || evento === "SIGNED_IN" || evento === "SIGNED_OUT") {
        // Fuera del callback: llamar a Supabase desde adentro puede trabar el
        // candado de la sesión (lo advierte la documentación de supabase-js).
        setTimeout(() => mostrar(s?.user.id ?? null), 0);
      }
    });

    return () => {
      vigente = false;
      escucha.subscription.unsubscribe();
    };
  }, []);

  return sesion;
}

export function entrar() {
  return supabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${BASE_PATH}/`,
      // hd es una sugerencia para la pantalla de Google, no un control: el
      // que rechaza otras cuentas es el trigger de la base.
      queryParams: { hd: "inroprin.com", prompt: "select_account" },
    },
  });
}

export function salir() {
  return supabase().auth.signOut();
}
