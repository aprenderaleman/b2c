"""Imprime timeline reciente de Sara para diagnosticar el test 2.1."""
from agents.shared.db import get_conn
with get_conn() as conn, conn.cursor() as cur:
    cur.execute("""
        SELECT timestamp, type, author, LEFT(content, 100) AS content
          FROM lead_timeline
         WHERE lead_id = (SELECT id FROM leads WHERE name = 'Sara')
           AND timestamp > NOW() - INTERVAL '4 hours'
         ORDER BY timestamp
    """)
    for r in cur.fetchall():
        print(f"  {r['timestamp'].isoformat()[11:19]}  {r['type']:24s} by={r['author']}  {r['content'][:80]}")
