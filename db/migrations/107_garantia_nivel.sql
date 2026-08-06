-- 107: Certificado "Garantía de Nivel por Escrito" (Gelfis 2026-08-06)
--
-- Nuevo tipo de certificado que se emite automáticamente al convertirse
-- un lead en estudiante del Método Nativo. Reutiliza la tabla
-- certificates (metadata) + generación de PDF on-the-fly:
--   extra_label  → nº de certificado GN-YYYY-NNNNN
--   date_from    → fecha de conversión (inicio del programa)
--   date_to      → fecha de llegada estimada
--   description  → "Meta X · Ritmo Y" (para el render del PDF)

-- El ALTER TYPE ... ADD VALUE no puede ir en la misma transacción que
-- el resto — el script de apply lo ejecuta por separado.
ALTER TYPE certificate_type ADD VALUE IF NOT EXISTS 'garantia_nivel';

-- Numeración secuencial GN-2026-00042
CREATE SEQUENCE IF NOT EXISTS garantia_nivel_seq START 1;

CREATE OR REPLACE FUNCTION next_garantia_number()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'GN-' || to_char(NOW(), 'YYYY') || '-' ||
         lpad(nextval('garantia_nivel_seq')::text, 5, '0');
$$;
