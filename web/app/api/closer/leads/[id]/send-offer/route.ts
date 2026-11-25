import { POST as teacherSendOffer } from "@/app/api/teacher/trial/[leadId]/send-offer/route";

/**
 * CRM Closer F4 (Gelfis 2026-11-25): esta ruta era una copia divergente
 * de la del profe (sin Dúo/Trío, sin Kids, sin email, sin checkout_url,
 * sin registrar el contacto). Ahora delega en la ruta convergida, que
 * acepta closers (identidad en ofertas_enviadas.closer_id y atribución
 * vía acciones_closer). Se mantiene la URL para no romper clientes con
 * JS cacheado; PaymentLinkModal puede seguir apuntando aquí.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return teacherSendOffer(req, { params: Promise.resolve({ leadId: id }) });
}
