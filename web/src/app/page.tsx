import Image from "next/image";
import { ruta } from "@/lib/base";

export default function Inicio() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <section className="w-full max-w-md rounded-grande bg-superficie p-8 shadow-sm">
        <Image src={ruta("inroprin.svg")} alt="INROPRIN" width={183} height={41} priority />
        <h1 className="mt-6 font-display text-2xl font-bold text-tinta">InroScan</h1>
        <p className="mt-2 text-texto-2">
          Rendiciones de caja chica y memos de viáticos. En construcción: mientras tanto,
          la herramienta actual sigue en{" "}
          {/* Fuera del basePath a propósito: es la app actual, no una ruta de esta. */}
          <a className="font-medium text-acento-texto underline" href="/inroscan/">
            /inroscan
          </a>
          .
        </p>
      </section>
    </main>
  );
}
