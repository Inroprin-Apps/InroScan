/**
 * Ruta bajo la que se publica la app en GitHub Pages.
 *
 * Es la carpeta web/ del sitio de GitHub Pages de Inroprin-Apps/InroScan; la
 * raíz solo redirige acá. En Pages la ruta distingue mayúsculas: tiene que
 * coincidir con el nombre del repositorio.
 *
 * Next.js la agrega solo a los <Link>, no a imágenes ni íconos: esos la
 * llevan a mano con `ruta()`. Se define una sola vez porque next.config.ts
 * también la lee.
 */
export const BASE_PATH = "/InroScan/web";

export const ruta = (archivo: string) => `${BASE_PATH}/${archivo.replace(/^\//, "")}`;
