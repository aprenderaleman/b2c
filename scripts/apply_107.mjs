import { config } from "dotenv";
import { resolve } from "path";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// ALTER TYPE ADD VALUE fuera de transacción
try {
  await client.query("ALTER TYPE certificate_type ADD VALUE IF NOT EXISTS 'garantia_nivel'");
  console.log("enum value OK");
} catch (e) { console.error("enum FAIL:", e.message); }

try {
  await client.query("CREATE SEQUENCE IF NOT EXISTS garantia_nivel_seq START 1");
  await client.query(`
    CREATE OR REPLACE FUNCTION next_garantia_number()
    RETURNS TEXT LANGUAGE sql AS $$
      SELECT 'GN-' || to_char(NOW(), 'YYYY') || '-' ||
             lpad(nextval('garantia_nivel_seq')::text, 5, '0');
    $$
  `);
  console.log("sequence + fn OK");
} catch (e) { console.error("seq FAIL:", e.message); }

const t = await client.query("SELECT next_garantia_number() AS n");
console.log("Test number:", t.rows[0].n);
await client.end();
