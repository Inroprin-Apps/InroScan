import type { NextConfig } from "next";
import { BASE_PATH } from "./src/lib/base";

// Sitio estático en GitHub Pages, bajo la app actual: Supabase hace de
// servidor, así que no hay código propio corriendo en ningún lado.
//
// Por eso NO van cacheComponents ni partialPrefetching, que trae el
// generador: ambos necesitan un servidor Node.js en ejecución.
const nextConfig: NextConfig = {
  output: "export",
  basePath: BASE_PATH,
  // GitHub Pages sirve carpeta/index.html, no carpeta.html.
  trailingSlash: true,
  // La optimización de imágenes por defecto necesita servidor.
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
