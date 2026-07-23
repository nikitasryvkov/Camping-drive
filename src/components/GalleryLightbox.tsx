import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface LightboxImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

export default function GalleryLightbox({ index, images, onChange, onClose }: { index: number | null; images: readonly LightboxImage[]; onChange: (index: number) => void; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (index === null) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") onChange((index + 1) % images.length);
      if (event.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>("button");
      if (!nodes?.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("button")?.focus(), 0);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [images.length, index, onChange, onClose]);

  if (index === null || images.length === 0) return null;
  const image = images[index];
  if (!image) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/90 p-3 text-white sm:p-8" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Галерея" className="relative flex max-h-full w-full max-w-6xl flex-col items-center">
        <button type="button" onClick={onClose} className="absolute right-0 top-0 z-10 flex size-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Закрыть галерею"><X className="size-5" /></button>
        <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
          <img src={image.src} alt={image.alt} width={image.width} height={image.height} className="max-h-[78dvh] max-w-full rounded-3xl object-contain" />
          <button type="button" onClick={() => onChange((index - 1 + images.length) % images.length)} className="absolute left-2 flex size-12 items-center justify-center rounded-full bg-black/45 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-5" aria-label="Предыдущее фото"><ChevronLeft className="size-6" /></button>
          <button type="button" onClick={() => onChange((index + 1) % images.length)} className="absolute right-2 flex size-12 items-center justify-center rounded-full bg-black/45 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-5" aria-label="Следующее фото"><ChevronRight className="size-6" /></button>
        </div>
        <p className="mt-4 text-center text-sm text-white/72">{image.alt} · {index + 1} из {images.length}</p>
      </div>
    </div>
  );
}
