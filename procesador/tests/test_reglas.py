"""Cada caso viene de un error real documentado en CONTEXTO.md §10 o de una
regla que se ajustó contra comprobantes reales."""

from datetime import date
from decimal import Decimal

from procesador.reglas import (
    clave,
    esta_completo,
    fecha_iso,
    importe,
    leer_texto,
    parece_varios,
    partir_numero,
    serie_numero,
    tipo_de,
)

BOLETA = """RESTAURANT EL BUEN SABOR S.A.C.
RUC 20512345678
AV. LARCO 123 MIRAFLORES
BOLETA DE VENTA ELECTRONICA
B001-00012345
FECHA: 15/10/2026
1/4 DE POLLO            15.00
ENSALADA                22.00
OP. GRAVADA             31.36
IGV                      5.64
TOTAL                   40.00
DESCUENTO                3.00
TOTAL A PAGAR S/        37.00
"""


def test_lee_una_boleta_completa():
    c = leer_texto(BOLETA)
    assert c["ruc"] == "20512345678"
    assert (c["serie"], c["numero"]) == ("B001", "12345")
    assert c["fecha"] == date(2026, 10, 15)
    assert c["tipo_comprobante_id"] == "BOLETA"
    assert c["proveedor"] == "RESTAURANT EL BUEN SABOR S.A.C."
    assert c["moneda"] == "PEN"
    assert esta_completo(c)


def test_total_a_pagar_gana_sobre_total():
    assert leer_texto(BOLETA)["total"] == Decimal("37.00")


def test_series_puramente_numericas():
    # Faltaba ~1/3 de las filas del consolidado por exigir letra en la serie.
    assert serie_numero("N° 0001-003936") == ("0001", "3936")
    assert serie_numero("002-001175") == ("002", "1175")


def test_una_fecha_iso_no_es_un_numero_de_comprobante():
    assert serie_numero("emitido 2026-09 a las 10") == ("", "")
    assert serie_numero("2026-09-15 F001-6384") == ("F001", "6384")


def test_ceros_a_la_izquierda_no_cambian_la_identidad():
    # El mismo documento daba 10010 y 010010 según el camino.
    assert clave("F001", "006384") == clave("F001", "6384") == "F001-6384"
    assert clave("002", "001175") == clave("2", "1175")
    assert clave("", "") == ""


def test_planilla_sin_guion_no_inventa_serie():
    assert partir_numero("010010") == ("", "10010")
    assert partir_numero("F001-0006384") == ("F001", "6384")


def test_fechas_en_varias_formas():
    assert fecha_iso("15/10/2026") == date(2026, 10, 15)
    assert fecha_iso("5-3-26") == date(2026, 3, 5)
    assert fecha_iso("2026-10-15") == date(2026, 10, 15)
    assert fecha_iso("31/02/2026") is None
    assert fecha_iso("sin fecha") is None


def test_importes_peruanos():
    assert importe("1,234.50") == Decimal("1234.50")
    assert importe("S/ 37.00") == Decimal("37.00")
    assert importe("") is None
    assert importe("abc") is None


def test_tipos_por_frase_antes_que_por_palabra_suelta():
    assert tipo_de("DECLARACION JURADA de gastos", "") == "DJ"
    assert tipo_de("PLANILLA DE MOVILIDAD ... FACTURA", "") == "PLANILLA_MOVILIDAD"
    assert tipo_de("RECIBO POR HONORARIOS ELECTRONICO", "E001") == "RHE"
    assert tipo_de("NOTA DE CREDITO ELECTRONICA", "F001") == "NOTA_CREDITO"
    assert tipo_de("", "F001") == "FACTURA"
    assert tipo_de("VOUCHER DE PAGO", "") == "VOUCHER"
    assert tipo_de("RECIBO N° 123", "") == "RECIBO"
    assert tipo_de("texto cualquiera", "") == ""


def test_dos_comprobantes_en_una_imagen():
    assert parece_varios("RUC 20512345678\n... RUC 20600000001")
    assert parece_varios("B001-123 ... B001-456")
    assert not parece_varios(BOLETA)
    assert not parece_varios("B001-123 emitido 2026-09")


def test_moneda_en_dolares():
    assert leer_texto("TOTAL US$ 10.00")["moneda"] == "USD"


def test_sin_texto_no_revienta():
    c = leer_texto("")
    assert c["total"] is None and c["numero"] == "" and not esta_completo(c)
