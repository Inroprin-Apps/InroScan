"use client";

import { ConSesion } from "./marco";
import { MisRendiciones } from "./mis-rendiciones";

export function Inicio() {
  return <ConSesion>{(persona) => <MisRendiciones persona={persona} />}</ConSesion>;
}
