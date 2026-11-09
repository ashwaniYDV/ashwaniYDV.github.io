import { useEffect } from "react";

const PLAYLIST = "https://www.jiosaavn.com/embed/playlist/173255392";
const SAAVN_ORIGIN = "https://www.jiosaavn.com";

/**
 * Tell the player iframe to use its compact mobile layout. embed.js decides
 * "mobile" from innerWidth < 640 and re-sends that on every resize, so we
 * follow each of its messages with our own.
 */
function forceMobileLayout() {
  const iframe = document.querySelector("#jsw #jsw-iframe");
  iframe?.contentWindow?.postMessage({ type: "resize", isMobile: true }, SAAVN_ORIGIN);
}

/**
 * Floating JioSaavn player from the original page. embed.js builds the whole
 * player (#jsw) inside #jiosaavn-widget. It runs once per page load, so this
 * component stays mounted and is only hidden (not unmounted) on tool pages.
 * On desktop it is shown as the small mobile tile (see enhancements.css).
 */
export default function JioSaavnWidget({ hidden = false }) {
  useEffect(() => {
    if (document.getElementById("jsw-init")) return;
    const s = document.createElement("script");
    s.id = "jsw-init";
    s.src = `https://www.jiosaavn.com/embed/_s/embed.js?ver=${Date.now()}`;
    s.onload = () => {
      window.JioSaavnEmbedWidget?.init({ a: 1, q: 1, embed_src: PLAYLIST, partner_id: "ndtv" });
      // embed.js posts its own "load" (isMobile: false on desktop) from iframe.onload; go after it.
      document
        .querySelector("#jsw #jsw-iframe")
        ?.addEventListener("load", () => window.setTimeout(forceMobileLayout, 300));
    };
    document.body.appendChild(s);
  }, []);

  useEffect(() => {
    // embed.js debounces its resize message by 250ms; send ours just after.
    let timer;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(forceMobileLayout, 400);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div id="jiosaavn-widget" className={hidden ? "is-hidden" : undefined}>
      <div style={{ position: "fixed", top: "100%" }}>
        Listen to the{" "}
        <a href="https://www.jiosaavn.com/featured/the-drop/NkWn3dHw0Krc1EngHtQQ2g__" target="_blank" rel="noreferrer">
          latest songs
        </a>
        , only on{" "}
        <a href="https://www.jiosaavn.com" target="_blank" rel="noreferrer">
          JioSaavn.com
        </a>
      </div>
    </div>
  );
}
