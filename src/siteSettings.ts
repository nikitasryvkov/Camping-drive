export type SiteLink = { label: string; href: string };
export type SitePhone = SiteLink & { display: string };
export type SiteFooterColumn = { title: string; links: SiteLink[] };
export type FloatingAction = {
  label: string;
  icon: "phone" | "route" | "contacts" | "message" | "link";
  linkType: "primaryPhone" | "route" | "contacts" | "custom";
  href: string;
  enabled: boolean;
  highlighted: boolean;
};

export type SiteSettingsValue = {
  siteName: string;
  locationLabel: string;
  logoImageId: string | null;
  logoAlt: string;
  phones: SitePhone[];
  address: string;
  routeUrl: string;
  contactLinks: SiteLink[];
  menu: SiteLink[];
  footer: { description: string; columns: SiteFooterColumn[]; legalText: string };
  floatingActions: FloatingAction[];
  newsSeo: { title: string; description: string };
};

export type PublicSiteSettings = SiteSettingsValue & { logoUrl: string; updatedAt: string | null };

export const DEFAULT_SITE_SETTINGS: SiteSettingsValue = {
  siteName: "Кемпинг Драйв",
  locationLabel: "Киржач · Владимирская область",
  logoImageId: null,
  logoAlt: "Кемпинг Драйв",
  phones: [
    { label: "Основной телефон", display: "+7 (985) 801-24-43", href: "tel:+79858012443" },
    { label: "Экстренная связь", display: "+7 (915) 403-41-31", href: "tel:+79154034131" },
  ],
  address: "Киржач, Владимирская область",
  routeUrl: "https://yandex.ru/maps?ll=38.980568%2C55.988505&mode=route&rtext=~55.988505%2C38.980568&ruri=~ymapsbm1%3A%2F%2Forg%3Foid%3D179712262023",
  contactLinks: [
    { label: "Отзывы на Яндекс Картах", href: "https://yandex.ru/maps/org/kemping_drayv/179712262023/reviews/" },
    { label: "Глэмпинг Unity", href: "https://www.glamping-unity.ru" },
  ],
  menu: [
    { label: "Отдых", href: "/#stay" }, { label: "Чем заняться", href: "/#activities" },
    { label: "Территория", href: "/#territory" }, { label: "Фото", href: "/#gallery" },
    { label: "Отзывы", href: "/#reviews" }, { label: "Новости", href: "/news" },
    { label: "Как добраться", href: "/#route" },
  ],
  footer: {
    description: "Живой кемпинг в Киржаче: палатки, домики, костры, река и 30 гектаров пространства.",
    columns: [
      { title: "Отдых", links: [{ label: "Своя палатка", href: "/#stay" }, { label: "Домики", href: "/#stay" }, { label: "С детьми", href: "/#stay" }, { label: "С питомцами", href: "/#stay" }] },
      { title: "Активности", links: [{ label: "Байдарки", href: "/#activities" }, { label: "SUP", href: "/#activities" }, { label: "Квадроциклы", href: "/#activities" }, { label: "Баня и чан", href: "/#activities" }] },
      { title: "Информация", links: [{ label: "Как добраться", href: "/#route" }, { label: "Правила", href: "/#rules" }, { label: "Новости", href: "/news" }, { label: "Контакты", href: "/#contacts" }] },
    ],
    legalText: "Сайт не использует формы, аналитику и файлы cookie.",
  },
  floatingActions: [
    { label: "Позвонить", icon: "phone", linkType: "primaryPhone", href: "", enabled: true, highlighted: false },
    { label: "Маршрут", icon: "route", linkType: "route", href: "", enabled: true, highlighted: false },
    { label: "Контакты", icon: "contacts", linkType: "contacts", href: "", enabled: true, highlighted: true },
  ],
  newsSeo: {
    title: "Новости — Кемпинг Драйв",
    description: "Новости и события кемпинга «Кемпинг Драйв» во Владимирской области.",
  },
};

export const DEFAULT_PUBLIC_SITE_SETTINGS: PublicSiteSettings = {
  ...DEFAULT_SITE_SETTINGS,
  logoUrl: "/logo-kemping-drive.png",
  updatedAt: null,
};

export function cloneDefaultSiteSettings(): SiteSettingsValue {
  return JSON.parse(JSON.stringify(DEFAULT_SITE_SETTINGS)) as SiteSettingsValue;
}

export function resolveFloatingActionHref(action: FloatingAction, settings: SiteSettingsValue): string {
  if (action.linkType === "primaryPhone") return settings.phones[0]?.href ?? "/#contacts";
  if (action.linkType === "route") return settings.routeUrl;
  if (action.linkType === "contacts") return "/#contacts";
  return action.href;
}

export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href);
}
