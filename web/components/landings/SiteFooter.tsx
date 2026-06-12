/**
 * Footer compacto con links a las 6 landings dedicadas.
 *
 * Se monta al final de la home (y opcionalmente de otras páginas
 * indexables) para distribuir la "autoridad" SEO de la home a las
 * landings nuevas — Google premia el internal linking limpio.
 *
 * Visualmente queda BAJO el funnel de 100dvh, así que no estorba al
 * conversión del usuario que cae en la home (que no scrollea más
 * allá del quiz). Pero el crawler sí lo ve.
 */
import Link from "next/link";

const LANDINGS = [
  { href: "/curso-aleman-online",              label: "Curso de alemán online" },
  { href: "/clases-particulares-aleman-online", label: "Clases particulares 1 a 1" },
  { href: "/curso-intensivo-aleman",           label: "Curso intensivo" },
  { href: "/curso-aleman-certificado",         label: "Curso con certificado" },
  { href: "/aleman-b2-trabajar",               label: "Alemán B2 para trabajar" },
  { href: "/clases-aleman-ciudades",           label: "Clases en tu ciudad" },
];

export function SiteFooter() {
  return (
    <footer className="bg-slate-50 border-t border-slate-200 px-5 md:px-8 py-8 md:py-10">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-[14px] font-semibold uppercase tracking-wider text-slate-500">
          Nuestros cursos
        </h2>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {LANDINGS.map(l => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="block text-[14px] text-slate-700 hover:text-warm-foreground hover:underline"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[12px] text-slate-400">
          Aprender-Aleman.de · Academia de alemán online con profesores nativos hispanohablantes.
        </p>
      </div>
    </footer>
  );
}
