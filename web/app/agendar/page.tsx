import { redirect } from "next/navigation";

/**
 * /agendar → /agendar/cuando.
 *
 * The funnel always starts at the slot picker (Plan A: emotional
 * commitment first, data after). Anyone hitting `/agendar` directly
 * gets bounced to step 1.
 */
export default function AgendarIndex() {
  redirect("/agendar/cuando");
}
