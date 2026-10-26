import type { Metadata, Viewport } from "next";
import { DM_Sans, Sora } from "next/font/google";
import "./globals.css";
import { ruta } from "@/lib/base";
import { RegistroSW } from "./registro-sw";

const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "InroScan",
  description: "Rendiciones de caja chica y memos de viáticos de INROPRIN.",
  icons: { icon: ruta("inroprin-marca.svg"), apple: ruta("icono-192.png") },
  manifest: ruta("manifest.webmanifest"),
  appleWebApp: { capable: true, title: "InroScan", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#007a72" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${dmSans.variable} ${sora.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <RegistroSW />
      </body>
    </html>
  );
}
