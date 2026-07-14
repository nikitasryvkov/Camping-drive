import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { cn } from "../lib/utils";

const DAY_CROSSFADE = 0.75;
const NIGHT_CROSSFADE = 0.5;
const ADJUST = {
  desktop: { scale: 1, x: 0, y: 0 },
  mobile: { scale: 1.08, x: 0, y: 0 },
} as const;

type VideoKey = "dayA" | "dayB" | "nightA" | "nightB";
type Pair = { current: HTMLVideoElement; next: HTMLVideoElement; crossfade: number };

function drawCover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const adjust = width < 768 ? ADJUST.mobile : ADJUST.desktop;
  const baseScale = Math.max(width / sourceWidth, height / sourceHeight) * adjust.scale;
  const drawWidth = sourceWidth * baseScale;
  const drawHeight = sourceHeight * baseScale;
  const x = (width - drawWidth) / 2 + adjust.x;
  const y = (height - drawHeight) / 2 + adjust.y;
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
}

export function VideoBackground({ className }: { className?: string }) {
  const { theme, phase, reducedMotion } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const refs = useRef<Partial<Record<VideoKey, HTMLVideoElement>>>({});
  const targetDayAlpha = useRef(theme === "day" ? 1 : 0);
  const dayAlpha = useRef(theme === "day" ? 1 : 0);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const saveData = Boolean(connection?.saveData);

  useEffect(() => {
    targetDayAlpha.current = theme === "day" ? 1 : 0;
  }, [theme]);

  useEffect(() => {
    if (saveData) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const dayA = refs.current.dayA;
    const dayB = refs.current.dayB;
    const nightA = refs.current.nightA;
    const nightB = refs.current.nightB;
    if (!host || !canvas || !dayA || !dayB || !nightA || !nightB) return;

    const context = canvas.getContext("2d", { alpha: false });
    const dayBuffer = document.createElement("canvas");
    const nightBuffer = document.createElement("canvas");
    const dayContext = dayBuffer.getContext("2d");
    const nightContext = nightBuffer.getContext("2d");
    if (!context || !dayContext || !nightContext) return;

    const dayPair: Pair = { current: dayA, next: dayB, crossfade: DAY_CROSSFADE };
    const nightPair: Pair = { current: nightA, next: nightB, crossfade: NIGHT_CROSSFADE };
    let width = 0;
    let height = 0;
    let frame = 0;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      for (const target of [canvas, dayBuffer, nightBuffer]) {
        target.width = width;
        target.height = height;
      }
    };

    const start = async () => {
      try {
        dayA.currentTime = 0;
        nightA.currentTime = 0;
        await Promise.allSettled([dayA.play(), nightA.play()]);
      } catch {
        // The fallback image remains visible when autoplay is unavailable.
      }
    };

    const renderPair = (pair: Pair, bufferContext: CanvasRenderingContext2D) => {
      const current = pair.current;
      const next = pair.next;
      if (current.readyState < 2 || !current.videoWidth || !current.videoHeight) return false;
      bufferContext.clearRect(0, 0, width, height);
      drawCover(bufferContext, current, current.videoWidth, current.videoHeight, width, height);

      const duration = Number.isFinite(current.duration) ? current.duration : 0;
      const remaining = duration - current.currentTime;
      if (duration && remaining <= pair.crossfade && next.paused) {
        next.currentTime = 0;
        void next.play().catch(() => undefined);
      }
      if (duration && remaining <= pair.crossfade && next.readyState >= 2) {
        const blend = Math.min(1, Math.max(0, 1 - remaining / pair.crossfade));
        bufferContext.globalAlpha = blend;
        drawCover(bufferContext, next, next.videoWidth, next.videoHeight, width, height);
        bufferContext.globalAlpha = 1;
      }
      if ((duration && remaining <= 0.04) || current.ended) {
        current.pause();
        current.currentTime = 0;
        pair.current = next;
        pair.next = current;
      }
      return true;
    };

    const render = () => {
      const dayDrawn = renderPair(dayPair, dayContext);
      const nightDrawn = renderPair(nightPair, nightContext);
      if (dayDrawn || nightDrawn) {
        dayAlpha.current += (targetDayAlpha.current - dayAlpha.current) * 0.25;
        context.fillStyle = "#081c22";
        context.fillRect(0, 0, width, height);
        if (nightDrawn) {
          context.globalAlpha = 1 - dayAlpha.current;
          context.drawImage(nightBuffer, 0, 0);
        }
        if (dayDrawn) {
          context.globalAlpha = dayAlpha.current;
          context.drawImage(dayBuffer, 0, 0);
        }
        context.globalAlpha = 1;
        if (!readyRef.current) {
          readyRef.current = true;
          setReady(true);
        }
      }
      frame = requestAnimationFrame(render);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    void start();
    frame = requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      [dayA, dayB, nightA, nightB].forEach((video) => video.pause());
    };
  }, [saveData]);

  const transition = reducedMotion
    ? { duration: 0.01 }
    : phase === "out"
      ? { duration: 0.25, ease: "easeIn" as const }
      : { type: "spring" as const, stiffness: 300, damping: 18 };

  return (
    <motion.div
      ref={hostRef}
      className={cn("pointer-events-none absolute -inset-[5%] overflow-hidden bg-[#081c22]", className)}
      animate={{ scale: phase === "out" && !reducedMotion ? 0.92 : 1 }}
      transition={transition}
      aria-hidden="true"
    >
      <img src="/media/hero-day.webp" alt="" className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", theme === "day" ? "opacity-100" : "opacity-0")} />
      <img src="/media/hero-night.webp" alt="" className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", theme === "night" ? "opacity-100" : "opacity-0")} />
      <canvas ref={canvasRef} className={cn("absolute inset-0 size-full transition-opacity duration-500", ready && !saveData ? "opacity-100" : "opacity-0")} />
      {!saveData && (
        <>
          {(["dayA", "dayB"] as const).map((key) => (
            <video key={key} ref={(node) => { if (node) refs.current[key] = node; }} src="/camp-day.mp4" muted playsInline preload="metadata" className="absolute size-px opacity-0" />
          ))}
          {(["nightA", "nightB"] as const).map((key) => (
            <video key={key} ref={(node) => { if (node) refs.current[key] = node; }} src="/camp-night.mp4" muted playsInline preload="metadata" className="absolute size-px opacity-0" />
          ))}
        </>
      )}
    </motion.div>
  );
}
