/**
 * Inyecta los tags globales de Meta Pixel + TikTok Pixel.
 *
 * Server component sin estado: lee las envs al render del layout y
 * renderiza los `<Script>` solo si están configuradas. Si no hay IDs,
 * no se renderiza nada — los wrappers en `lib/pixels.ts` son no-op.
 *
 * Envs requeridas (públicas, prefix NEXT_PUBLIC_):
 *   - NEXT_PUBLIC_META_PIXEL_ID
 *   - NEXT_PUBLIC_TIKTOK_PIXEL_ID
 *
 * Cuando Gelfis pase los IDs reales, se añaden a Vercel y se redeploya;
 * no hay que tocar código.
 */

import Script from "next/script";

export function PixelTags() {
  const metaId    = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const tiktokId  = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;

  return (
    <>
      {metaId && (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){
              n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
              s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
              (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${metaId}');
              fbq('track', 'PageView');
            `}
          </Script>
          <noscript>
            {/* Pixel fallback for visitors with JS disabled. */}
            <img
              alt=""
              height="1"
              width="1"
              style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${metaId}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}
      {tiktokId && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`
            !function (w, d, t) {
              w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
              ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
              ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
              for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
              ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
              ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
              ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};
              var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;
              var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
              ttq.load('${tiktokId}');
              ttq.page();
            }(window, document, 'ttq');
          `}
        </Script>
      )}
    </>
  );
}
