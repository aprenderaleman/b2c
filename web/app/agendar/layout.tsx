import { FunnelShell } from "@/components/agendar/FunnelShell";

/**
 * Mobile-native booking funnel.
 *
 * Wraps every /agendar/* page in a sticky-header app-shell. Each
 * step lives in its own URL (cuando, tu, nivel, objetivo) so the
 * back button feels native and visitors can deep-link / share if
 * they ever need to.
 *
 * The legacy embedded `<Funnel />` on `/` is unaffected: that flow
 * stays intact for desktop visitors and as a fallback. Admin,
 * teacher, student and aula pages share none of this state.
 */
export default function AgendarLayout({ children }: { children: React.ReactNode }) {
  return <FunnelShell>{children}</FunnelShell>;
}
