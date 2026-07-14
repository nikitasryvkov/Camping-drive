export type AnalyticsEvent =
  | "phone_click"
  | "route_click"
  | "booking_open"
  | "booking_submit"
  | "glamping_click"
  | "gallery_open"
  | "theme_toggle";

declare global {
  interface Window {
    ym?: (id: number, method: string, ...args: unknown[]) => void;
  }
}

export function track(event: AnalyticsEvent, data?: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    console.debug("[analytics]", event, data ?? {});
  }

  const id = Number(import.meta.env.VITE_YANDEX_METRIKA_ID);
  if (id && window.ym) {
    window.ym(id, "reachGoal", event, data ?? {});
  }
}

export function initAnalytics() {
  const id = Number(import.meta.env.VITE_YANDEX_METRIKA_ID);
  if (!id || document.querySelector("script[data-metrika]")) return;

  window.ym =
    window.ym ??
    ((...args: unknown[]) => {
      const queue = (window.ym as unknown as { a?: unknown[] }).a ?? [];
      queue.push(args);
      (window.ym as unknown as { a: unknown[] }).a = queue;
    });

  const script = document.createElement("script");
  script.async = true;
  script.dataset.metrika = "true";
  script.src = "https://mc.yandex.ru/metrika/tag.js";
  document.head.append(script);
  window.ym(id, "init", { clickmap: true, trackLinks: true, accurateTrackBounce: true });
}
