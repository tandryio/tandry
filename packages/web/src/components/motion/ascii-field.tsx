import { useEffect, useRef } from "react";

/** A character field with local pointer attraction; pauses offscreen and respects motion preferences. */
export function AsciiField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    const surface = canvas?.parentElement;
    if (!canvas || !context || !surface) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let visible = false;
    let frame = 0;
    let last = 0;
    let phase = 0;
    const pointer = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      strength: 0,
      active: false,
    };
    const leave = () => {
      pointer.active = false;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || reduced.matches) return;
      const bounds = canvas.getBoundingClientRect();
      pointer.targetX = event.clientX - bounds.left;
      pointer.targetY = event.clientY - bounds.top;
      if (!pointer.active && pointer.strength < 0.01) {
        pointer.x = pointer.targetX;
        pointer.y = pointer.targetY;
      }
      pointer.active = true;
    };
    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.font = "9px monospace";
      const glyphs = ".:-=+";
      for (let y = 0; y < height; y += 10) {
        for (let x = 0; x < width; x += 8) {
          const wave =
            Math.sin(x / 130 + phase) * Math.cos(y / 110 - phase / 2);
          const contour = (Math.sin(x / 240 + y / 180 + wave * 2) + 1) / 2;
          const centerFade = Math.min(
            1,
            Math.abs(x - width / 2) / (width * 0.35),
          );
          const dx = pointer.x - x;
          const dy = pointer.y - y;
          const distance = Math.hypot(dx, dy);
          const influence =
            Math.max(0, 1 - distance / 260) ** 1.5 * pointer.strength;
          const pull = influence * 0.85;
          const alpha = (0.09 + contour * 0.34) * (0.3 + centerFade * 0.7);
          context.fillStyle = `rgba(${180 - influence * 14},${180 + influence * 36},${180 + influence * 65},${alpha + influence * 0.7})`;
          context.fillText(
            glyphs.charAt(Math.min(4, Math.floor(contour * 5))),
            x + dx * pull,
            y + dy * pull,
          );
        }
      }
    };
    const tick = (now: number) => {
      const elapsed = now - last;
      const interacting = pointer.active || pointer.strength > 0.01;
      if (elapsed > (interacting ? 30 : 90)) {
        const delta = Math.min(elapsed, 100);
        const smooth = 1 - Math.exp(-delta / 65);
        pointer.x += (pointer.targetX - pointer.x) * smooth;
        pointer.y += (pointer.targetY - pointer.y) * smooth;
        pointer.strength +=
          ((pointer.active ? 1 : 0) - pointer.strength) * smooth;
        phase += delta * 0.00013;
        draw();
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      if (!visible || document.hidden || reduced.matches) {
        leave();
        pointer.strength = 0;
      }
      last = performance.now();
      draw();
      if (visible && !document.hidden && !reduced.matches)
        frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    });
    const intersection = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      visible = entry.isIntersecting;
      sync();
    });
    resize.observe(canvas);
    intersection.observe(canvas);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerleave", leave);
    surface.addEventListener("pointercancel", leave);
    window.addEventListener("blur", leave);
    window.addEventListener("scroll", leave, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", leave);
      surface.removeEventListener("pointercancel", leave);
      window.removeEventListener("blur", leave);
      window.removeEventListener("scroll", leave);
    };
  }, []);
  return <canvas ref={ref} className="ascii-field" aria-hidden="true" />;
}
