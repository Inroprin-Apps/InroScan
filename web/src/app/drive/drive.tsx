"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base";
import { estadoDrive, irAConectar, terminarConexion, type EstadoDrive } from "@/lib/drive";
import { PaginaAdmin } from "../administracion";
import { Aviso, botonPrincipal, botonSecundario } from "../piezas";

export function Drive() {
  return (
    <PaginaAdmin
      activo="drive"
      titulo="Drive"
      descripcion="Al enviar, cada versión deja su hoja y su PDF en la unidad compartida, con las imágenes; al aprobar, las imágenes se borran de InroScan solo después de verificar la copia."
    >
      {() => <Contenido />}
    </PaginaAdmin>
  );
}

function Contenido() {
  const params = useSearchParams();
  const [estado, setEstado] = useState<EstadoDrive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const hecho = useRef(false);

  useEffect(() => {
    if (hecho.current) return;
    hecho.current = true;
    const code = params.get("code");
    const errorGoogle = params.get("error");
    // El código de Google sirve una sola vez: se saca de la dirección enseguida.
    if (code || errorGoogle) window.history.replaceState(null, "", `${BASE_PATH}/drive/`);
    const pedido = code
      ? terminarConexion(code, params.get("state") ?? "")
      : errorGoogle
        ? Promise.reject(new Error(errorGoogle === "access_denied" ? "Se canceló la conexión con Google." : `Google respondió: ${errorGoogle}`))
        : estadoDrive();
    pedido.then(setEstado, (e: Error) => {
      setError(e.message);
      estadoDrive().then(setEstado, () => {});
    });
  }, [params]);

  return (
    <section className="max-w-2xl space-y-4 rounded-grande bg-superficie p-5 shadow-sm">
      {error && <Aviso>{error}</Aviso>}
      {!estado && !error && <p className="text-texto-3">Revisando la conexión…</p>}
      {estado?.conectado && (
        <Aviso tono="info">
          Conectado con <b>{estado.cuenta}</b> a la unidad «{estado.unidad}».
        </Aviso>
      )}
      {estado && !estado.conectado && (
        <p className="text-texto-2">
          Todavía no hay una cuenta conectada. Se conecta una vez, con una cuenta de administración que pertenezca a la unidad compartida
          «{estado.unidad}».
        </p>
      )}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-texto-2">
        <li>Crea la unidad compartida «{estado?.unidad ?? "InroScan · Rendiciones"}» en Google Drive (o usa la que ya existe).</li>
        <li>Conecta con una cuenta que sea administradora de esa unidad y acepta el acceso a Drive.</li>
        <li>Desde ahí, cada envío deja su carpeta, su hoja, su PDF y las imágenes.</li>
      </ol>
      <button
        type="button"
        className={estado?.conectado ? botonSecundario : botonPrincipal}
        disabled={conectando}
        onClick={() => {
          setConectando(true);
          irAConectar();
        }}
      >
        {estado?.conectado ? "Conectar otra cuenta" : "Conectar con Google Drive"}
      </button>
    </section>
  );
}
