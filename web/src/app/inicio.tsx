"use client";

import { ConSesion } from "./marco";
import { MisRendiciones } from "./mis-rendiciones";

export function Inicio() {
  return <ConSesion activo="inicio">{(persona) => <MisRendiciones persona={persona} />}</ConSesion>;
}
