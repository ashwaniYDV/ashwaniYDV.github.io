import { useCallback, useEffect, useRef, useState } from "react";
import { download, useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";

// Drawing happens in a fixed logical space and is scaled to the canvas, so a
// sketch looks the same on any screen and survives resizes.
const WIDTH = 1600;
const HEIGHT = 1000;
const BACKGROUND = "#fbfaf7";
const COLORS = ["#1f2330", "#e5484d", "#f5a524", "#30a46c", "#0090ff", "#8e4ec6"];

/**
 * Stroke shape (kept compact for localStorage):
 *   { c: color, s: size, p: [x0, y0, x1, y1, ...] }  (integer logical coords)
 * The eraser is a stroke painted in the background colour.
 */
function drawStroke(ctx, { c, s, p }) {
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = s;
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  // Smooth through midpoints with quadratic curves.
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  ctx.stroke();
}

export default function Whiteboard() {
  const [board, setBoard, status] = useLocalStorage("whiteboard", { strokes: [] }, { debounceMs: 600 });
  const strokes = board.strokes;
  const [redo, setRedo] = useState([]);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);

  const canvasRef = useRef(null);
  const current = useRef(null); // stroke being drawn (not yet committed)
  const strokesRef = useRef(strokes);
  const redoRef = useRef(redo);
  redoRef.current = redo;

  const ctx = () => canvasRef.current?.getContext("2d");

  const redraw = useCallback((list) => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    const scale = canvas.width / WIDTH;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.fillStyle = BACKGROUND;
    c.fillRect(0, 0, WIDTH, HEIGHT);
    list.forEach((stroke) => drawStroke(c, stroke));
  }, []);

  // Match the canvas backing store to its on-screen size (and device pixel ratio).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr);
      if (canvas.width !== w) {
        canvas.width = w;
        canvas.height = Math.round((w * HEIGHT) / WIDTH);
      }
      redraw(strokesRef.current);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(() => {
    strokesRef.current = strokes;
    redraw(strokes);
  }, [strokes, redraw]);

  const toLogical = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [
      Math.round(((e.clientX - rect.left) / rect.width) * WIDTH),
      Math.round(((e.clientY - rect.top) / rect.height) * HEIGHT),
    ];
  };

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep drawing if the pointer leaves the canvas
    } catch {
      // Not capturable (e.g. synthetic events); drawing still works inside the canvas.
    }
    const erase = tool === "eraser";
    current.current = { c: erase ? BACKGROUND : color, s: erase ? size * 4 : size, p: toLogical(e) };
    const c = ctx();
    c.lineCap = "round";
    c.lineJoin = "round";
    drawStroke(c, current.current);
  };

  const onPointerMove = (e) => {
    const stroke = current.current;
    if (!stroke) return;
    const c = ctx();
    // Coalesced events give smoother lines on fast moves; some browsers return an
    // empty list (or none), so fall back to the event itself.
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = coalesced && coalesced.length ? coalesced : [e.nativeEvent];
    for (const ev of events) {
      const [x, y] = toLogical(ev);
      const lx = stroke.p[stroke.p.length - 2];
      const ly = stroke.p[stroke.p.length - 1];
      if (x === lx && y === ly) continue;
      // Draw the new segment immediately; the smoothed version is drawn on commit.
      c.strokeStyle = stroke.c;
      c.lineWidth = stroke.s;
      c.beginPath();
      c.moveTo(lx, ly);
      c.lineTo(x, y);
      c.stroke();
      stroke.p.push(x, y);
    }
  };

  const onPointerUp = () => {
    const stroke = current.current;
    if (!stroke) return;
    current.current = null;
    setBoard({ strokes: [...strokesRef.current, stroke] });
    setRedo([]);
  };

  const undo = useCallback(() => {
    const list = strokesRef.current;
    if (!list.length) return;
    setRedo([...redoRef.current, list[list.length - 1]]);
    setBoard({ strokes: list.slice(0, -1) });
  }, [setBoard]);

  const redoLast = useCallback(() => {
    const r = redoRef.current;
    if (!r.length) return;
    setBoard({ strokes: [...strokesRef.current, r[r.length - 1]] });
    setRedo(r.slice(0, -1));
  }, [setBoard]);

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, P pen, E eraser.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redoLast();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redoLast();
      } else if (!mod && k === "p") setTool("pen");
      else if (!mod && k === "e") setTool("eraser");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redoLast]);

  const clear = () => {
    if (!strokes.length || !window.confirm("Clear the whole board? You can't undo this.")) return;
    setBoard({ strokes: [] });
    setRedo([]);
  };

  const exportPng = () => {
    // Render at full logical resolution regardless of screen size.
    const out = document.createElement("canvas");
    out.width = WIDTH;
    out.height = HEIGHT;
    const c = out.getContext("2d");
    c.lineCap = "round";
    c.lineJoin = "round";
    c.fillStyle = BACKGROUND;
    c.fillRect(0, 0, WIDTH, HEIGHT);
    strokes.forEach((s) => drawStroke(c, s));
    out.toBlob((blob) => blob && download("whiteboard.png", blob));
  };

  return (
    <div className="whiteboard">
      <div className="util-toolbar" role="toolbar" aria-label="Whiteboard tools">
        <div className="util-segmented" role="group" aria-label="Tool">
          <button
            type="button"
            className={tool === "pen" ? "button small is-active" : "button small"}
            aria-pressed={tool === "pen"}
            onClick={() => setTool("pen")}
            title="Pen (P)"
          >
            <i className="fa fa-pencil" aria-hidden="true"></i>&nbsp;Pen
          </button>
          <button
            type="button"
            className={tool === "eraser" ? "button small is-active" : "button small"}
            aria-pressed={tool === "eraser"}
            onClick={() => setTool("eraser")}
            title="Eraser (E)"
          >
            <i className="fa fa-eraser" aria-hidden="true"></i>&nbsp;Eraser
          </button>
        </div>

        <div className="wb-colors" role="group" aria-label="Colour">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={color === c && tool === "pen" ? "wb-swatch is-active" : "wb-swatch"}
              style={{ backgroundColor: c }}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => {
                setColor(c);
                setTool("pen");
              }}
            />
          ))}
          <label className="wb-swatch wb-custom" title="Custom colour">
            <span className="visually-hidden">Custom colour</span>
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setTool("pen");
              }}
            />
          </label>
        </div>

        <label className="wb-size">
          <span>Size</span>
          <input type="range" min="1" max="40" value={size} onChange={(e) => setSize(Number(e.target.value))} />
          <span className="wb-size-value">{size}</span>
        </label>

        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={undo} disabled={!strokes.length} title="Undo (Ctrl/Cmd+Z)">
          <i className="fa fa-undo" aria-hidden="true"></i>
          <span className="visually-hidden">Undo</span>
        </button>
        <button type="button" className="button small" onClick={redoLast} disabled={!redo.length} title="Redo (Ctrl/Cmd+Shift+Z)">
          <i className="fa fa-repeat" aria-hidden="true"></i>
          <span className="visually-hidden">Redo</span>
        </button>
        <button type="button" className="button small" onClick={exportPng}>
          <i className="fa fa-download" aria-hidden="true"></i>&nbsp;PNG
        </button>
        <button type="button" className="button small" onClick={clear}>
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className={tool === "eraser" ? "wb-canvas is-erasing" : "wb-canvas"}
        aria-label="Whiteboard drawing area"
        role="img"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      <div className="util-statusbar">
        <span>
          {strokes.length} strokes · Shortcuts: P pen, E eraser, Ctrl/Cmd+Z undo
        </span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
