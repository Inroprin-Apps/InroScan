/**
 * Ruta bajo la que se publica la app en GitHub Pages.
 *
 * No es /inroscan/app porque ahí ya viven los módulos de la app actual
 * (app/main.js, app/config.js…) y las dos se mezclarían en la misma carpeta.
 *
 * Next.js la agrega solo a los <Link>, no a imágenes ni íconos: esos la
 * llevan a mano con `ruta()`. Se define una sola vez porque next.config.ts
 * también la lee.
 */
export const BASE_PATH = "/inroscan/web";

export const ruta = (archivo: string) => `${BASE_PATH}/${archivo.replace(/^\//, "")}`;
