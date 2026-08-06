-- ⚠️ IMPORTANTE: aplicar con client_encoding='UTF8' (ver nota migración 100).
--
-- Fix Gelfis 2026-08-06: `classes.short_code` era nullable → algunas trials
-- se creaban sin short_code y los emisores caían al fallback URL largo
-- `/trial/{uuid}?t={jwt}` (~200 chars, feísimo en WhatsApp).
--
-- Caso reportado: Sara (bbfc1d01) recibió morning + 15m con URL largo.
-- 1 de 339 trials afectada — no sistémico, pero suficiente para incidente.
--
-- Este cambio:
--   1. Crea función `generate_short_code()` — 8 chars base36 (nanoid-like).
--   2. Backfill del NULL existente (Sara).
--   3. Trigger BEFORE INSERT que genera short_code si viene NULL/vacío.
--   4. Constraint NOT NULL para que ningún flow pueda saltárselo.
--
-- El fallback largo se elimina también en TS/Python — si un día falla el
-- trigger, preferimos error visible que URL feo silencioso.

-- ── 1. Función generadora ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_short_code(len INT DEFAULT 8)
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..len LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ── 2. Backfill de NULLs existentes ─────────────────────────────────
UPDATE classes
   SET short_code = generate_short_code(8)
 WHERE short_code IS NULL OR short_code = '';

-- ── 3. Trigger BEFORE INSERT/UPDATE que asegura short_code ───────────
-- Si viene NULL/vacío al insertar, generamos uno con reintento anti-colisión.
CREATE OR REPLACE FUNCTION classes_ensure_short_code()
RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
  tries INT := 0;
BEGIN
  IF NEW.short_code IS NULL OR NEW.short_code = '' THEN
    LOOP
      candidate := generate_short_code(8);
      -- Colisión-safe: reintentar hasta 5 veces (~1 en 2^40 improbable pero explícito)
      EXIT WHEN NOT EXISTS (SELECT 1 FROM classes WHERE short_code = candidate);
      tries := tries + 1;
      IF tries >= 5 THEN
        RAISE EXCEPTION 'No se pudo generar short_code único tras 5 intentos';
      END IF;
    END LOOP;
    NEW.short_code := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS classes_ensure_short_code_trg ON classes;
CREATE TRIGGER classes_ensure_short_code_trg
  BEFORE INSERT OR UPDATE ON classes
  FOR EACH ROW
  EXECUTE FUNCTION classes_ensure_short_code();

-- ── 4. NOT NULL constraint ──────────────────────────────────────────
ALTER TABLE classes ALTER COLUMN short_code SET NOT NULL;
