/** Fechas en palabras cortas, en la hora local. */

const dia = (d: Date) => d.toLocaleDateString("en-CA");

/** «Hoy 09:41», «Ayer 17:20» o «24/10» (con el año si no es este). */
export function cuando(iso: string, ahora = new Date()): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (dia(d) === dia(ahora)) return `Hoy ${hora}`;
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  if (dia(d) === dia(ayer)) return `Ayer ${hora}`;
  const opciones: Intl.DateTimeFormatOptions =
    d.getFullYear() === ahora.getFullYear() ? { day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" };
  return d.toLocaleDateString("es-PE", opciones);
}

/** «2026-10-19» → «19/10/2026», sin pasar por husos horarios. */
export function fechaCorta(aaaammdd: string | null): string {
  if (!aaaammdd) return "—";
  const [a, m, d] = aaaammdd.split("-");
  return `${d}/${m}/${a}`;
}
