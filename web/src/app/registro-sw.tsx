"use client";

import { useEffect } from "react";
import { BASE_PATH } from "@/lib/base";

/** Instala la cáscara de la app para que abra sin señal. Solo en lo publicado. */
export function RegistroSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch(() => {});
  }, []);
  return null;
}
