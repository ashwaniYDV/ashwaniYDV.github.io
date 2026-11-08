import { useEffect, useRef, useState } from "react";

const SHOW_BACK_TO_TOP_AFTER_PX = 700;

/** Thin reading-progress bar along the top, plus a back-to-top button. */
export default function ScrollChrome() {
  const barRef = useRef(null);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? window.scrollY / max : 0;
      if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`;
      setShowTop(window.scrollY > SHOW_BACK_TO_TOP_AFTER_PX);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <>
      <div className="scroll-progress" aria-hidden="true">
        <div ref={barRef} className="scroll-progress-bar" />
      </div>
      <button
        type="button"
        className={showTop ? "back-to-top is-visible" : "back-to-top"}
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
        onClick={() => window.scrollTo({ top: 0 })}
      >
        <i className="fa fa-arrow-up" aria-hidden="true"></i>
      </button>
    </>
  );
}
