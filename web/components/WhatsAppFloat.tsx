"use client";

import { useLang } from "@/lib/lang-context";

const WA_NUMBER = "4915253409644"; // +49 15253409644 without spaces or +

export function WhatsAppFloat() {
  const { t, lang } = useLang();
  const prefillEs = "Hola, tengo una consulta sobre los cursos.";
  const prefillDe = "Hallo, ich habe eine Frage zu den Kursen.";
  const href = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(
    lang === "de" ? prefillDe : prefillEs,
  )}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t.nav.whatsappLabel}
      className="fixed bottom-5 right-5 z-50 flex items-center justify-center
                 h-14 w-14 rounded-full bg-[#25D366] text-white shadow-lg
                 hover:scale-105 hover:bg-[#22c15e] transition-all
                 focus:outline-none focus:ring-4 focus:ring-[#25D366]/30"
    >
      <svg viewBox="0 0 32 32" className="h-7 w-7 fill-current" aria-hidden="true">
        <path d="M16.003 3.2C9.012 3.2 3.305 8.906 3.302 15.897c-.001 2.234.583 4.415 1.693 6.335L3.2 28.8l6.736-1.77a12.68 12.68 0 006.063 1.544h.005c6.99 0 12.696-5.707 12.699-12.697a12.62 12.62 0 00-3.717-8.989 12.62 12.62 0 00-8.983-3.688zm0 23.207h-.004a10.57 10.57 0 01-5.38-1.473l-.386-.229-4 1.05 1.066-3.898-.251-.4a10.526 10.526 0 01-1.615-5.615c.004-5.815 4.736-10.547 10.556-10.547a10.48 10.48 0 017.46 3.093 10.48 10.48 0 013.088 7.463c-.003 5.817-4.734 10.556-10.534 10.556zm5.78-7.898c-.317-.159-1.876-.926-2.167-1.032-.291-.106-.503-.159-.715.159-.212.317-.82 1.032-1.005 1.244-.185.212-.37.239-.687.08-.317-.159-1.338-.493-2.548-1.572-.942-.84-1.579-1.878-1.764-2.195-.185-.317-.02-.488.14-.647.144-.143.317-.37.476-.555.16-.185.212-.317.317-.529.106-.212.053-.397-.026-.556-.08-.159-.715-1.722-.98-2.357-.258-.619-.52-.535-.715-.545l-.61-.011c-.212 0-.556.08-.847.397-.291.317-1.111 1.085-1.111 2.647 0 1.562 1.137 3.07 1.296 3.282.159.212 2.238 3.414 5.422 4.787.758.327 1.349.522 1.81.669.76.241 1.451.207 1.998.126.61-.091 1.876-.767 2.14-1.507.264-.74.264-1.375.185-1.507-.08-.132-.291-.212-.608-.37z" />
      </svg>
    </a>
  );
}
