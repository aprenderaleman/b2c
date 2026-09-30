// Falla el build si dos carpetas dinámicas hermanas usan nombres distintos
// ([id] junto a [studentId]). Next.js solo lo detecta en runtime y responde
// 500 en TODAS las rutas dinámicas: el 2026-09-30 dejó sin aula a toda la
// academia durante ~15 minutos.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const conflicts = [];
function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const dynamic = entries.map((e) => e.name).filter((n) => /^\[[^.\]]+\]$/.test(n));
  if (dynamic.length > 1) conflicts.push(`${dir}: ${dynamic.join(" vs ")}`);
  for (const e of entries) if (e.name !== "node_modules") walk(join(dir, e.name));
}
walk("app");

if (conflicts.length) {
  console.error("\n✖ Slugs dinámicos en conflicto (usa el mismo nombre en carpetas hermanas):");
  for (const c of conflicts) console.error("  - " + c);
  process.exit(1);
}
console.log("✓ rutas dinámicas sin conflictos de slug");
