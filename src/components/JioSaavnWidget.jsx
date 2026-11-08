import { useEffect } from "react";

const PLAYLIST = "https://www.jiosaavn.com/embed/playlist/173255392";

/** Floating JioSaavn player from the original page. */
export default function JioSaavnWidget() {
  useEffect(() => {
    if (document.getElementById("jsw-init")) return;
    const s = document.createElement("script");
    s.id = "jsw-init";
    s.src = `https://www.jiosaavn.com/embed/_s/embed.js?ver=${Date.now()}`;
    s.onload = () =>
      window.JioSaavnEmbedWidget?.init({ a: 1, q: 1, embed_src: PLAYLIST, partner_id: "ndtv" });
    document.body.appendChild(s);
  }, []);

  return (
    <div id="jiosaavn-widget">
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
      <div id="jsw" className="ads queue contract complete">
        <div id="jsw-wrap">
          <iframe id="jsw-iframe" title="JioSaavn playlist" src={PLAYLIST}></iframe>
        </div>
        <span id="jsw-close">
          <svg id="jsw-close-contract" viewBox="0 0 14 14" fill="#fff" aria-hidden="true">
            <path d="M13.6,3.6c-0.3-0.3-0.8-0.3-1.1,0L7,9L1.6,3.6c-0.3-0.3-0.8-0.3-1.1,0s-0.3,0.8,0,1.1l5.7,5.7c0.2,0.2,0.6,0.3,0.8,0.2c0.3,0.1,0.6,0,0.8-0.2l5.7-5.7C13.9,4.4,13.9,3.9,13.6,3.6z"></path>
          </svg>
        </span>
      </div>
    </div>
  );
}
