import { ValidationError } from "./errors.js";
import { isSafeLinkUrl } from "../../shared/safe-url.js";

export const SITE_SETTINGS_KEY = "site";

export type SiteLink = {
  label: string;
  href: string;
};

export type SitePhone = SiteLink & {
  display: string;
};

export type SiteFooterColumn = {
  title: string;
  links: SiteLink[];
};

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
  footer: {
    description: string;
    columns: SiteFooterColumn[];
    legalText: string;
  };
  floatingActions: FloatingAction[];
  newsSeo: {
    title: string;
    description: string;
  };
};

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
    { label: "Отдых", href: "/#stay" },
    { label: "Чем заняться", href: "/#activities" },
    { label: "Территория", href: "/#territory" },
    { label: "Фото", href: "/#gallery" },
    { label: "Отзывы", href: "/#reviews" },
    { label: "Новости", href: "/news" },
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

export function parseSiteSettingsValue(input: unknown): SiteSettingsValue {
  const root = object(input, "value");
  exactKeys(root, ["siteName", "locationLabel", "logoImageId", "logoAlt", "phones", "address", "routeUrl", "contactLinks", "menu", "footer", "floatingActions", "newsSeo"], "value");
  const logoImageId = root.logoImageId;
  if (logoImageId !== null && (typeof logoImageId !== "string" || !/^[1-9]\d{0,18}$/.test(logoImageId))) {
    invalid("value.logoImageId", "Must be null or a positive image ID");
  }

  const footer = object(root.footer, "value.footer");
  exactKeys(footer, ["description", "columns", "legalText"], "value.footer");
  const newsSeo = object(root.newsSeo, "value.newsSeo");
  exactKeys(newsSeo, ["title", "description"], "value.newsSeo");

  return {
    siteName: text(root.siteName, "value.siteName", 100),
    locationLabel: text(root.locationLabel, "value.locationLabel", 150),
    logoImageId: logoImageId as string | null,
    logoAlt: text(root.logoAlt, "value.logoAlt", 200, true),
    phones: array(root.phones, "value.phones", 1, 5).map((item, index) => phone(item, `value.phones[${index}]`)),
    address: text(root.address, "value.address", 300),
    routeUrl: url(root.routeUrl, "value.routeUrl"),
    contactLinks: array(root.contactLinks, "value.contactLinks", 0, 12).map((item, index) => link(item, `value.contactLinks[${index}]`)),
    menu: array(root.menu, "value.menu", 1, 12).map((item, index) => link(item, `value.menu[${index}]`)),
    footer: {
      description: text(footer.description, "value.footer.description", 1_000, true),
      columns: array(footer.columns, "value.footer.columns", 0, 6).map((item, index) => footerColumn(item, `value.footer.columns[${index}]`)),
      legalText: text(footer.legalText, "value.footer.legalText", 500, true),
    },
    floatingActions: array(root.floatingActions, "value.floatingActions", 0, 5).map((item, index) => floatingAction(item, `value.floatingActions[${index}]`)),
    newsSeo: {
      title: text(newsSeo.title, "value.newsSeo.title", 300),
      description: text(newsSeo.description, "value.newsSeo.description", 500),
    },
  };
}

function phone(input: unknown, field: string): SitePhone {
  const value = object(input, field);
  exactKeys(value, ["label", "display", "href"], field);
  const href = url(value.href, `${field}.href`);
  if (!href.startsWith("tel:")) invalid(`${field}.href`, "Phone links must start with tel:");
  return { label: text(value.label, `${field}.label`, 80), display: text(value.display, `${field}.display`, 80), href };
}

function link(input: unknown, field: string): SiteLink {
  const value = object(input, field);
  exactKeys(value, ["label", "href"], field);
  return { label: text(value.label, `${field}.label`, 100), href: url(value.href, `${field}.href`) };
}

function footerColumn(input: unknown, field: string): SiteFooterColumn {
  const value = object(input, field);
  exactKeys(value, ["title", "links"], field);
  return {
    title: text(value.title, `${field}.title`, 100),
    links: array(value.links, `${field}.links`, 0, 10).map((item, index) => link(item, `${field}.links[${index}]`)),
  };
}

function floatingAction(input: unknown, field: string): FloatingAction {
  const value = object(input, field);
  exactKeys(value, ["label", "icon", "linkType", "href", "enabled", "highlighted"], field);
  const icon = enumeration(value.icon, `${field}.icon`, ["phone", "route", "contacts", "message", "link"] as const);
  const linkType = enumeration(value.linkType, `${field}.linkType`, ["primaryPhone", "route", "contacts", "custom"] as const);
  const href = text(value.href, `${field}.href`, 2_000, linkType !== "custom");
  if (linkType === "custom") url(href, `${field}.href`);
  return {
    label: text(value.label, `${field}.label`, 40),
    icon,
    linkType,
    href,
    enabled: boolean(value.enabled, `${field}.enabled`),
    highlighted: boolean(value.highlighted, `${field}.highlighted`),
  };
}

function object(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid(field, "Must be an object");
  return input as Record<string, unknown>;
}

function array(input: unknown, field: string, min: number, max: number): unknown[] {
  if (!Array.isArray(input) || input.length < min || input.length > max) invalid(field, `Must contain between ${min} and ${max} items`);
  return input;
}

function text(input: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof input !== "string") invalid(field, "Must be a string");
  const value = input.trim();
  if ((!allowEmpty && value.length === 0) || value.length > max) invalid(field, `Must contain ${allowEmpty ? "0" : "1"} to ${max} characters`);
  return value;
}

function url(input: unknown, field: string): string {
  const value = text(input, field, 2_000);
  if (!isSafeLinkUrl(value)) invalid(field, "Use a safe relative, http(s), tel: or mailto: URL");
  return value;
}

function boolean(input: unknown, field: string): boolean {
  if (typeof input !== "boolean") invalid(field, "Must be true or false");
  return input;
}

function enumeration<const T extends readonly string[]>(input: unknown, field: string, values: T): T[number] {
  if (typeof input !== "string" || !values.includes(input)) invalid(field, `Must be one of: ${values.join(", ")}`);
  return input as T[number];
}

function exactKeys(input: Record<string, unknown>, allowed: string[], field: string): void {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) invalid(`${field}.${unknown}`, "Unknown field");
  const missing = allowed.find((key) => !(key in input));
  if (missing) invalid(`${field}.${missing}`, "Field is required");
}

function invalid(field: string, message: string): never {
  throw new ValidationError("The site settings contain invalid data", { fields: [{ field, message }] });
}
