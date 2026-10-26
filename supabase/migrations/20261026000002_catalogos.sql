-- InroScan · catálogos iniciales
--
-- Desde acá los mantiene administración en la app. Van en una migración y no
-- en un seed porque la app no funciona sin ellos.

-- Pendiente de confirmar el nombre exacto que se imprime: INROPRIN, Roland
-- Print e Industria Roland Print son la misma empresa.
insert into public.empresas (nombre) values ('INROPRIN');

-- Sin el código «IRP xx»: solo el área. El código queda como orden.
insert into public.areas (orden, nombre) values
  (0, 'GERENCIA GENERAL'),
  (1, 'EVALUACIÓN PROYECTOS, COSTOS Y CONTROL'),
  (2, 'COMERCIAL INROPRIN'),
  (3, 'COMERCIAL INROPLAS'),
  (4, 'ADMINISTRACION Y FINANZAS'),
  (5, 'RECURSOS HUMANOS'),
  (6, 'CONTABILIDAD'),
  (7, 'LICITACIONES'),
  (8, 'COMPRAS NACIONALES'),
  (9, 'COMERCIO EXTERIOR'),
  (10, 'GESTIÓN DE PROYECTOS'),
  (11, 'INNOVACION, DISEÑO Y PEDAGOGIA'),
  (12, 'ÁREA TÉCNICA Y CALIDAD'),
  (13, 'PRODUCCIÓN Y MANTENIMIENTO'),
  (14, 'LOGÍSTICA Y PLANEAMIENTO'),
  (15, 'TRANSFORMACIÓN DIGITAL');

insert into public.proyectos (nombre) values
  ('TALLERES ESPECIALIZADOS PRONIED'),
  ('TALLERES EPT GENERAL'),
  ('PAQ 02 CHINA CIVIL'),
  ('PAQ 08 CHINA CIVIL'),
  ('PAQ 01 EB GESTORES'),
  ('TALLERES EPT MEDRANO');

-- Las siete de la lista que se usa hoy, más la declaración jurada y la nota de
-- crédito, que también hay que reconocer. La DJ no sustenta por defecto.
insert into public.tipos_comprobante (id, nombre, sustenta, orden) values
  ('FACTURA', 'FACTURA ELECTRONICA', true, 1),
  ('RHE', 'RECIBO POR HONORARIOS', true, 2),
  ('BOLETA', 'BOLETA DE VENTA', true, 3),
  ('PLANILLA_MOVILIDAD', 'PLANILLA DE MOVILIDAD', true, 4),
  ('VOUCHER', 'VOUCHER', true, 5),
  ('TICKET', 'TICKET', true, 6),
  ('RECIBO', 'RECIBO', true, 7),
  ('DJ', 'DECLARACIÓN JURADA', false, 8),
  ('NOTA_CREDITO', 'NOTA DE CRÉDITO', true, 9);

-- Generado desde supabase/semillas/conceptos.csv. «datos»: la ruta sale de los
-- ejemplos históricos; «propuesta»: por analogía, falta validarla.
insert into public.conceptos (nombre, categoria, subcategoria, origen) values
  ('PRODUCTOS PARA ENVASADO Y EMBALAJE', 'BIENES', 'ENVASE Y EMBALAJE', 'datos'),
  ('HERRAMIENTAS', 'BIENES', 'HERRAMIENTAS', 'datos'),
  ('MATERIALES PARA CONSTRUCCION', 'BIENES', 'MATERIALES', 'datos'),
  ('MATERIALES PARA PRODUCCION', 'BIENES', 'MATERIALES', 'datos'),
  ('OTROS MATERIALES', 'BIENES', 'MATERIALES', 'datos'),
  ('UTILES DE LIMPIEZA', 'BIENES', 'MATERIALES', 'datos'),
  ('UTILES PARA OFICINA', 'BIENES', 'MATERIALES', 'datos'),
  ('PRODUCTOS PARA PROYECTOS', 'BIENES', 'MERCADERIA', 'datos'),
  ('DERECHO EMBARQUE', 'COMERCIAL', 'GASTOS COMERCIALES', 'propuesta'),
  ('VIATICOS', 'COMERCIAL', 'GASTOS COMERCIALES', 'datos'),
  ('EPPS', 'PERSONAL', 'EPPS', 'datos'),
  ('HONORARIOS', 'PERSONAL', 'HONORARIOS', 'datos'),
  ('MOVILIDAD DE PERSONAL', 'PERSONAL', 'MOVILIDAD DE PERSONAL', 'datos'),
  ('GASTOS RELACIONADOS AL PERSONAL', 'PERSONAL', 'PLANILLAS', 'datos'),
  ('MOVILIDADES (SUELDO)', 'PERSONAL', 'PLANILLAS', 'datos'),
  ('UTILIDADES AL PERSONAL', 'PERSONAL', 'PLANILLAS', 'datos'),
  ('ALQUILER DE ANDAMIOS', 'SERVICIOS', 'ALQUILERES', 'propuesta'),
  ('ALQUILER DE INYECTORAS', 'SERVICIOS', 'ALQUILERES', 'datos'),
  ('OTROS ALQUILERES', 'SERVICIOS', 'ALQUILERES', 'datos'),
  ('ELIMINACION DE DESMONTE', 'SERVICIOS', 'TRANSPORTE', 'propuesta'),
  ('ENCOMIENDA', 'SERVICIOS', 'TRANSPORTE', 'propuesta'),
  ('ENVIO DE MERCADERIA', 'SERVICIOS', 'TRANSPORTE', 'propuesta'),
  ('FLETE NACIONAL', 'SERVICIOS', 'TRANSPORTE', 'datos'),
  ('TRANSPORTE', 'SERVICIOS', 'TRANSPORTE', 'propuesta'),
  ('AGUA', 'SERVICIOS ADM', 'AGUA', 'datos'),
  ('ABASTECIMIENTO DE GASOLINA', 'SERVICIOS ADM', 'COMBUSTIBLE', 'datos'),
  ('MANTENIMIENTO DE POZOS A TIERRA', 'SERVICIOS ADM', 'OTROS SERVICIOS', 'propuesta'),
  ('OTROS SERVICIOS', 'SERVICIOS ADM', 'OTROS SERVICIOS', 'datos'),
  ('SERVICIO DE LIMPIEZA', 'SERVICIOS ADM', 'SALUBRIDAD', 'datos'),
  ('SERVICIO DE VIGILANCIA', 'SERVICIOS ADM', 'SEGURIDAD', 'propuesta'),
  ('SERVICIO DE VIGILANCIA MEDICA', 'SERVICIOS ADM', 'SEGURIDAD', 'datos'),
  ('ESTACIONAMIENTO', 'SERVICIOS ADM', 'VARIOS', 'propuesta'),
  ('IMPRESIONES', 'SERVICIOS ADM', 'VARIOS', 'datos'),
  ('PEAJE', 'SERVICIOS ADM', 'VARIOS', 'datos');

insert into public.procesador_estado (id) values (1);
