-- 139: estado 'deleted' para grabaciones purgadas por retención
-- (Gelfis 2026-10-12, reducción de coste LiveKit/R2).
-- El cron recordings-retention borra de R2 las grabaciones de más de
-- 90 días no compartidas con profes y marca la fila como 'deleted'
-- (se conserva la fila para auditoría; las UIs la excluyen).

alter type recording_status add value if not exists 'deleted';
