import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { type ImageAsset } from "./api";
import { ImageLibrary } from "./ImageLibrary";

type ImagePickerProps = {
  open: boolean;
  selectedId?: string | null;
  onSelect: (image: ImageAsset) => void;
  onClose: () => void;
};

export function ImagePicker({ open, selectedId, onSelect, onClose }: ImagePickerProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="admin-picker-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="admin-picker-dialog" role="dialog" aria-modal="true" aria-label="Выбор изображения">
        <button className="admin-picker-close" type="button" onClick={onClose} aria-label="Закрыть">
          <X aria-hidden="true" />
        </button>
        <ImageLibrary
          mode="select"
          selectedId={selectedId}
          onSelect={(image) => {
            onSelect(image);
            onClose();
          }}
        />
      </section>
    </div>
  );
}
