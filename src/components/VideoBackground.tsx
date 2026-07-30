import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { useTheme } from "../theme/ThemeContext";

export function VideoBackground({ className }: { className?: string }) {
  const { theme, phase, reducedMotion } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const useVideo = !connection?.saveData && !reducedMotion;

  useEffect(() => {
    if (!useVideo) return;
    const host = hostRef.current;
    const video = videoRef.current;
    if (!host || !video) return;

    let visible = false;
    const synchronizePlayback = () => {
      if (visible && document.visibilityState === "visible") {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        synchronizePlayback();
      },
      { rootMargin: "100px" },
    );
    const onVisibilityChange = () => synchronizePlayback();
    observer.observe(host);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [theme, useVideo]);

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
      <img
        src={theme === "day" ? "/media/hero-day.webp" : "/media/hero-night.webp"}
        alt=""
        className="absolute inset-0 size-full object-cover"
      />
      {useVideo ? (
        <video
          key={theme}
          ref={videoRef}
          src={theme === "day" ? "/camp-day.mp4" : "/camp-night.mp4"}
          poster={theme === "day" ? "/media/hero-day.webp" : "/media/hero-night.webp"}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadStart={() => setReady(false)}
          onCanPlay={() => setReady(true)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-500",
            ready ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </motion.div>
  );
}
