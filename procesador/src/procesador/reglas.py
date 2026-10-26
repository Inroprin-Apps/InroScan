"""Primera lectura: expresiones regulares sobre el texto del OCR.

Gratis, instantánea y sin cuota. Cuando no alcanza, el comprobante queda
incompleto y recién ahí entra la IA, y solo para los campos que faltan.

Portado de app/campos.js de la versión anterior, donde cada regla se ajustó
contra comprobantes y consolidados reales. Los comentarios conservan el
porqué: si una regla parece rara, casi siempre la motivó un caso concreto.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation

# Campos sin los que la fila no sirve para la rendición.
IMPRESCINDIBLES = ("fecha", "numero", "total")

# Los RUC peruanos empiezan en 10, 15, 17 o 20 y tienen once dígitos.
RE_RUC = re.compile(r"\b((?:10|15|17|20)\d{9})\b")

# El formato con letra —F001-6384, EB01-135, FW01-434— es solo una parte de lo
# que circula. En los consolidados reales hay también series puramente
# numéricas (0001-003936, 002-001175): una expresión que solo buscara la letra
# inicial perdía alrededor de un tercio de las filas, en silencio.
RE_SERIE_NUMERO = re.compile(r"\b([A-Z]{1,2}\d{2,3}|\d{3,4})\s*[-–—]\s*(\d{1,8})\b")

RE_FECHA = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")

# «TOTAL A PAGAR» gana sobre «TOTAL» a secas: en las boletas con descuento el
# primero es el que se paga de verdad.
RE_TOTAL_A_PAGAR = re.compile(r"TOTAL\s*A\s*PAGAR\s*:?\s*(?:S/|US\$|\$)?\s*([\d,]+\.\d{2})", re.I)
RE_TOTAL = re.compile(r"\bTOTAL\s*:?\s*(?:S/|US\$|\$)?\s*([\d,]+\.\d{2})", re.I)


def sin_ceros(texto: str) -> str:
    """Quita ceros a la izquierda, dejando al menos un carácter."""
    return re.sub(r"^0+(?=.)", "", texto)


def importe(valor: object) -> Decimal | None:
    """Un monto peruano (coma de millar, punto decimal) a Decimal con dos decimales."""
    if valor is None or valor == "":
        return None
    limpio = re.sub(r"[^\d.\-]", "", str(valor).replace(",", ""))
    try:
        return Decimal(limpio).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def clave(serie: str, numero: str) -> str:
    """Identidad de un comprobante, para encontrar repetidos y cruzar.

    Se normaliza fuerte porque el mismo papel aparece escrito de varias
    formas: F001-6384 y F001-006384 son el mismo, y 002-001175 se teclea
    igual de fácil como 2-1175. Es la misma regla que la columna generada
    `comprobantes.clave` en la base.
    """

    def limpia(v: str) -> str:
        return sin_ceros(re.sub(r"[^A-Z0-9]", "", (v or "").upper()))

    s, n = limpia(serie), limpia(numero)
    return f"{s}-{n}" if s or n else ""


def partir_numero(texto: str) -> tuple[str, str]:
    """Parte un «N° de comprobante» escrito de corrido en (serie, número).

    Las planillas de movilidad vienen sin guion (010010): no tienen serie, y
    forzarles una partición inventaría un dato.
    """
    t = (texto or "").strip()
    m = re.match(r"^([A-Za-z0-9]{1,4})\s*[-–—]\s*(\d{1,10})$", t)
    if m:
        return m.group(1).upper(), sin_ceros(m.group(2))
    return "", re.sub(r"^0+(?=\d)", "", t)


def fecha_iso(texto: str) -> date | None:
    """La fecha del comprobante. Las boletas la escriben de tres o cuatro formas."""
    t = (texto or "").strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        anio, mes, dia = (int(x) for x in m.groups())
    else:
        m = RE_FECHA.search(t)
        if not m:
            return None
        dia, mes, anio = int(m.group(1)), int(m.group(2)), m.group(3)
        anio = int(f"20{anio}") if len(anio) == 2 else int(anio)
    try:
        # date() rechaza el 31/02, que la versión anterior dejaba pasar.
        return date(anio, mes, dia)
    except ValueError:
        return None


def tipo_de(texto: str, serie: str) -> str:
    """El tipo de comprobante, con los ids de la tabla tipos_comprobante."""
    # La declaración jurada no tiene ni RUC ni serie: se reconoce por su
    # encabezado, antes de intentar deducir nada por la serie.
    if re.search(r"DECLARACI[OÓ]N\s+JURADA", texto, re.I):
        return "DJ"
    # El orden importa: estas son frases propias, y buscarlas primero evita
    # que un «FACTURA» suelto en el pie se lleve la clasificación.
    if re.search(r"PLANILLA\s+(?:DE|POR)\s+MOVILIDAD", texto, re.I):
        return "PLANILLA_MOVILIDAD"
    if re.search(r"RECIBO\s+POR\s+HONORARIOS", texto, re.I):
        return "RHE"
    if re.search(r"\bNOTA\s+DE\s+CR[EÉ]DITO\b", texto, re.I):
        return "NOTA_CREDITO"
    if re.search(r"\bFACTURA\b", texto, re.I) or re.match(r"F", serie, re.I):
        return "FACTURA"
    if re.search(r"\bBOLETA\b", texto, re.I) or re.match(r"B", serie, re.I):
        return "BOLETA"
    if re.search(r"\bVOUCHER\b", texto, re.I):
        return "VOUCHER"
    if re.search(r"\bTICKET\b", texto, re.I):
        return "TICKET"
    if re.search(r"\bRECIBO\b", texto, re.I):
        return "RECIBO"
    return ""


def proveedor_de(texto: str) -> str:
    """Razón social del emisor.

    Conservadora a propósito: la primera línea larga que parezca nombre de
    empresa y no sea la dirección ni el título del comprobante. Si no
    convence, devuelve vacío: mejor eso que colar una dirección como
    proveedor.
    """
    for cruda in texto.split("\n")[:12]:
        linea = cruda.strip()
        if not 6 <= len(linea) <= 70:
            continue
        if re.search(r"\d{6,}", linea):
            continue
        if re.search(r"\b(RUC|BOLETA|FACTURA|TICKET|AV|AV\.|JR|JR\.|CALLE|MZ|LOTE|NRO)\b", linea, re.I):
            continue
        if re.fullmatch(r"[\d\s/.:-]+", linea):
            continue
        if re.search(r"[A-Za-zÁÉÍÓÚÑ]{4,}", linea):
            return re.sub(r"\s+", " ", linea)
    return ""


def serie_numero(texto: str) -> tuple[str, str]:
    for m in RE_SERIE_NUMERO.finditer(texto):
        serie, numero = m.group(1), m.group(2)
        # Una fecha ISO entra en el mismo molde: 2026-09 son cuatro dígitos,
        # guion y dos más. Se descarta por el año, que ninguna serie usa.
        if re.fullmatch(r"(19|20)\d{2}", serie) and len(numero) <= 2:
            continue
        return serie.upper(), sin_ceros(numero)
    return "", ""


def parece_varios(texto: str) -> bool:
    """Si la imagen trae más de un comprobante.

    El OCR no separa dos boletas puestas juntas en el cristal: devuelve un
    solo texto con las dos encima. Dos RUC o dos números distintos lo delatan,
    y entonces la lectura pasa a la IA, que sí puede repartirlos.
    """
    if len(set(RE_RUC.findall(texto))) > 1:
        return True
    numeros = {
        re.sub(r"\s", "", m.group(0))
        for m in RE_SERIE_NUMERO.finditer(texto)
        if not re.fullmatch(r"(19|20)\d{2}-\d{1,2}", re.sub(r"\s", "", m.group(0)))
    }
    return len(numeros) > 1


def leer_texto(texto: str) -> dict:
    """Primera lectura de un comprobante, con los nombres de columna de la base."""
    plano = (texto or "").replace(" ", " ")
    serie, numero = serie_numero(plano)
    total = RE_TOTAL_A_PAGAR.search(plano) or RE_TOTAL.search(plano)
    ruc = RE_RUC.search(plano)
    return {
        "fecha": fecha_iso(plano),
        "tipo_comprobante_id": tipo_de(plano, serie),
        "serie": serie,
        "numero": numero,
        "ruc": ruc.group(1) if ruc else "",
        "proveedor": proveedor_de(plano),
        "total": importe(total.group(1)) if total else None,
        # Sin \b después de «US$»: entre «$» y el espacio no hay límite de
        # palabra, así que la regla de la versión anterior nunca reconocía
        # «US$ 10.00».
        "moneda": "USD" if re.search(r"\bUS\$|\bUSD\b|\bD[OÓ]LARES\b", plano, re.I) else "PEN",
    }


def faltantes(campos: dict) -> list[str]:
    return [k for k in IMPRESCINDIBLES if campos.get(k) in (None, "")]


def esta_completo(campos: dict) -> bool:
    return not faltantes(campos)
