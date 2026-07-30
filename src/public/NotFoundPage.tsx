import { ArrowLeft, MapPinned } from "lucide-react";

import { buttonStyles } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { useSiteSettings } from "../SiteSettingsContext";

export function NotFoundPage() {
  const settings = useSiteSettings();
  return (
    <main className="relative isolate grid min-h-dvh place-items-center overflow-hidden bg-[#07191d] py-20 text-white">
      <img src="/media/hero-night.webp" alt="" className="absolute inset-0 -z-20 size-full object-cover opacity-45" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_70%_30%,rgba(42,157,194,.24),transparent_35%),linear-gradient(135deg,rgba(3,18,20,.76),rgba(3,18,20,.96))]" />
      <Container className="text-center">
        <a href="/" className="mx-auto inline-flex rounded-2xl bg-white p-2 shadow-2xl" aria-label={`${settings.siteName} — на главную`}>
          <img src={settings.logoUrl} alt={settings.logoAlt} className="h-14 w-auto" />
        </a>
        <p className="mt-12 font-display text-[clamp(6rem,22vw,14rem)] leading-[.7] text-white/12" aria-hidden="true">404</p>
        <h1 className="mt-8 font-display text-4xl leading-tight sm:text-6xl">Эта тропа никуда не ведёт</h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-8 text-white/65 sm:text-lg">
          Возможно, адрес изменился или страница ещё не опубликована. Вернитесь на главную — там начинается маршрут к отдыху.
        </p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="/" className={buttonStyles("light")}><ArrowLeft className="size-4" />На главную</a>
          <a href={settings.routeUrl} target="_blank" rel="noreferrer" className={buttonStyles("light")}><MapPinned className="size-4" />Построить маршрут</a>
        </div>
      </Container>
    </main>
  );
}
