# InroScan · procesador

Programa en Python que corre en una PC de administración. Toma los
comprobantes que las personas subieron desde el teléfono y los lee con calma:

1. OpenCV prepara la imagen (endereza, limpia sombras, sube el contraste).
2. OCR.
3. Reglas (`src/procesador/reglas.py`, portadas de la versión anterior).
4. Clasificador de concepto.
5. Gemini, solo para los campos que falten.

También genera la hoja y el PDF de cada rendición enviada, archiva las imágenes
en Drive y las borra de Supabase cuando la rendición se aprueba, después de
verificar la copia.

Estado actual: solo están las reglas de lectura con sus pruebas. El resto llega
por fases (ver `CONTEXTO.md`).

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
.venv/bin/ruff check .
```

**El repo es público.** La clave interna de Supabase (`service_role`), la
clave de Gemini, el token de Google y los ejemplos históricos (traen nombres de
personas) viven solo en la PC. Ver `.gitignore`.
