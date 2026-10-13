-- 141: doc de apuntes desechable por clase (trials) — botón
-- "Documentos de Apuntes" del aula (Gelfis 2026-10-14).
alter table classes add column if not exists apuntes_doc_url text;
