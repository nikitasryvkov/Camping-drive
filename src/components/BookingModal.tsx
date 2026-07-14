import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { BOOKING_ACTIVITIES, BOOKING_FORMATS, SITE } from "../data/siteContent";
import { track } from "../lib/analytics";
import { formatPhone } from "../lib/formatPhone";
import { cn } from "../lib/utils";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Textarea } from "./ui/Textarea";

export interface BookingPayload {
  name: string;
  phone: string;
  dates: string;
  guests: string;
  format: string;
  activities: string[];
  comment: string;
  consent: boolean;
  botcheck: boolean;
}

interface Web3FormsResponse {
  success?: boolean;
  message?: string;
}

export async function submitBooking(payload: BookingPayload) {
  const accessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY?.trim();
  if (!accessKey) throw new Error("Web3Forms access key is not configured");

  const response = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      access_key: accessKey,
      subject: "Новая заявка на отдых — Кемпинг Драйв",
      from_name: "Сайт «Кемпинг Драйв»",
      name: payload.name,
      phone: payload.phone,
      "Желаемые даты": payload.dates || "Не указаны",
      "Количество гостей": payload.guests || "Не указано",
      "Формат отдыха": payload.format || "Не выбран",
      "Интересующие активности": payload.activities.join(", ") || "Не выбраны",
      message: payload.comment || "Без комментария",
      "Согласие на обработку данных": payload.consent ? "Да" : "Нет",
      botcheck: payload.botcheck,
    }),
  });
  const result = (await response.json().catch(() => ({}))) as Web3FormsResponse;
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Не удалось отправить заявку");
  }
  return { ok: true };
}

const emptyPayload: BookingPayload = { name: "", phone: "", dates: "", guests: "", format: "", activities: [], comment: "", consent: false, botcheck: false };

export default function BookingModal({ open, initialFormat, onClose }: { open: boolean; initialFormat?: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<BookingPayload>(emptyPayload);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) {
      setPayload((current) => ({ ...current, format: initialFormat ?? current.format }));
      setErrors({});
      setStatus("idle");
      setMessage("");
    }
  }, [initialFormat, open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => panel?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    window.setTimeout(() => focusables()?.[0]?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const nodes = focusables();
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const update = <K extends keyof BookingPayload>(key: K, value: BookingPayload[K]) => {
    setPayload((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
    if (status !== "loading") {
      setStatus("idle");
      setMessage("");
    }
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!payload.name.trim()) next.name = "Укажите имя";
    if (payload.phone.replace(/\D/g, "").length < 11) next.phone = "Укажите полный номер телефона";
    if (!payload.consent) next.consent = "Нужно согласие на обработку данных";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === "loading" || !validate()) return;
    setStatus("loading");
    setMessage("");
    try {
      await submitBooking(payload);
      track("booking_submit", { format: payload.format, provider: "web3forms" });
      setStatus("success");
      setMessage("Заявка отправлена. Администратор свяжется с вами, чтобы уточнить доступность и детали поездки.");
    } catch {
      setStatus("error");
      setMessage(`Не удалось отправить заявку. Позвоните нам по номеру ${SITE.phoneDisplay}.`);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/64 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="booking-title" className="mx-auto my-3 w-full max-w-3xl rounded-4xl border border-border bg-background text-foreground shadow-2xl sm:my-8">
        <div className="flex items-start justify-between gap-6 border-b border-border p-6 sm:p-8">
          <div><p className="eyebrow">Заявка на отдых</p><h2 id="booking-title" className="mt-3 font-display text-3xl sm:text-4xl">Расскажите, как хотите отдохнуть</h2></div>
          <button type="button" onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Закрыть форму"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <form onSubmit={handleSubmit} noValidate className="space-y-6 p-6 sm:p-8">
          <input type="checkbox" name="botcheck" checked={payload.botcheck} onChange={(event) => update("botcheck", event.target.checked)} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Имя *" error={errors.name}><Input value={payload.name} onChange={(e) => update("name", e.target.value)} autoComplete="name" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} /></Field>
            <Field label="Телефон *" error={errors.phone}><Input value={payload.phone} onChange={(e) => update("phone", formatPhone(e.target.value))} inputMode="tel" autoComplete="tel" placeholder="+7 (___) ___-__-__" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "phone-error" : undefined} /></Field>
            <Field label="Желаемые даты"><Input value={payload.dates} onChange={(e) => update("dates", e.target.value)} placeholder="Например, 21–23 августа" /></Field>
            <Field label="Количество гостей"><Input type="number" min="1" inputMode="numeric" value={payload.guests} onChange={(e) => update("guests", e.target.value)} placeholder="Сколько вас будет" /></Field>
          </div>
          <Field label="Формат отдыха"><Select value={payload.format} onChange={(e) => update("format", e.target.value)}><option value="">Пока не решили</option>{BOOKING_FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}</Select></Field>
          <fieldset>
            <legend className="mb-3 text-sm font-semibold">Интересующие активности</legend>
            <div className="flex flex-wrap gap-2">{BOOKING_ACTIVITIES.map((activity) => { const selected = payload.activities.includes(activity); return <button type="button" key={activity} aria-pressed={selected} onClick={() => update("activities", selected ? payload.activities.filter((item) => item !== activity) : [...payload.activities, activity])} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", selected ? "border-forest bg-forest text-white" : "border-border bg-surface hover:bg-surface-strong")}>{selected && <Check className="size-4" aria-hidden="true" />}{activity}</button>; })}</div>
          </fieldset>
          <Field label="Комментарий"><Textarea value={payload.comment} onChange={(e) => update("comment", e.target.value)} placeholder="Дети, питомцы, вопросы по снаряжению или трансферу" /></Field>
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" checked={payload.consent} onChange={(e) => update("consent", e.target.checked)} className="mt-1 size-4 accent-forest" aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? "consent-error" : undefined} /><span>Я согласен на обработку персональных данных и ознакомился с <a href="#privacy" className="underline underline-offset-4">политикой конфиденциальности</a>.</span></label>
          {errors.consent && <p id="consent-error" className="text-sm text-red-500">{errors.consent}</p>}
          <p className="rounded-2xl bg-surface p-4 text-sm leading-6 text-muted">Заявка не является подтвержденным бронированием. Администратор свяжется с вами и уточнит доступность.</p>
          {message && <div className={cn("rounded-2xl border p-4 text-sm leading-6", status === "success" ? "border-forest/30 bg-forest/10" : "border-red-500/30 bg-red-500/10")} role="status">{message}</div>}
          <div aria-live="polite" className="sr-only">{status === "loading" ? "Заявка отправляется" : message}</div>
          <Button type="submit" disabled={status === "loading" || status === "success"} className="w-full sm:w-auto">{status === "loading" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{status === "loading" ? "Отправляем…" : status === "success" ? "Заявка отправлена" : "Отправить заявку"}</Button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const id = label.startsWith("Имя") ? "name-error" : label.startsWith("Телефон") ? "phone-error" : undefined;
  return <label className="block"><span className="mb-2 block text-sm font-semibold">{label}</span>{children}{error && <span id={id} className="mt-2 block text-sm text-red-500">{error}</span>}</label>;
}
