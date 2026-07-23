import type { PageBlockContent } from "./api";

export type BlockField =
  | {
      kind: "text" | "textarea" | "url" | "number";
      key: string;
      label: string;
      placeholder?: string;
      maxLength?: number;
      min?: number;
      max?: number;
    }
  | {
      kind: "select";
      key: string;
      label: string;
      options: Array<{ value: string; label: string }>;
    }
  | { kind: "image"; key: string; label: string }
  | {
      kind: "repeater";
      key: string;
      label: string;
      addLabel: string;
      itemLabel: string;
      defaultItem: Record<string, unknown>;
      maxItems?: number;
      fields: BlockField[];
    };

export type BlockDefinition = {
  type: string;
  label: string;
  description: string;
  defaultContent: PageBlockContent;
  fields: BlockField[];
};

const headingFields: BlockField[] = [
  { kind: "text", key: "anchor", label: "HTML-якорь", placeholder: "about" },
  { kind: "text", key: "eyebrow", label: "Надзаголовок", placeholder: "Короткая подпись" },
  { kind: "text", key: "title", label: "Заголовок", placeholder: "Заголовок блока" },
];

const buttonFields: BlockField[] = [
  { kind: "text", key: "buttonLabel", label: "Текст кнопки", placeholder: "Подробнее" },
  { kind: "url", key: "buttonUrl", label: "Ссылка кнопки", placeholder: "/booking или https://…" },
];

export const BLOCK_DEFINITIONS: BlockDefinition[] = [
  {
    type: "hero",
    label: "Главный экран",
    description: "Крупный заголовок, фон и две кнопки.",
    defaultContent: {
      eyebrow: "Отдых на природе",
      title: "Новый взгляд на кемпинг",
      text: "Расскажите посетителю самое важное о месте.",
      primaryButtonLabel: "Забронировать",
      primaryButtonUrl: "#booking",
      secondaryButtonLabel: "Узнать больше",
      secondaryButtonUrl: "#about",
      backgroundImageId: null,
      backgroundImageUrl: "",
      backgroundImageAlt: "",
      backgroundImageNightId: null,
      backgroundImageNightUrl: "",
      backgroundImageNightAlt: "",
    },
    fields: [
      ...headingFields,
      { kind: "textarea", key: "text", label: "Описание" },
      { kind: "text", key: "primaryButtonLabel", label: "Основная кнопка" },
      { kind: "url", key: "primaryButtonUrl", label: "Ссылка основной кнопки" },
      { kind: "text", key: "secondaryButtonLabel", label: "Вторая кнопка" },
      { kind: "url", key: "secondaryButtonUrl", label: "Ссылка второй кнопки" },
      { kind: "image", key: "backgroundImage", label: "Фоновое изображение" },
      { kind: "image", key: "backgroundImageNight", label: "Фоновое изображение ночью (необязательно)" },
    ],
  },
  {
    type: "text",
    label: "Текстовый блок",
    description: "Заголовок и многострочный текст.",
    defaultContent: { eyebrow: "О нас", title: "Заголовок раздела", body: "Введите текст раздела.", alignment: "left" },
    fields: [
      ...headingFields,
      { kind: "textarea", key: "body", label: "Текст" },
      {
        kind: "select",
        key: "alignment",
        label: "Выравнивание",
        options: [
          { value: "left", label: "По левому краю" },
          { value: "center", label: "По центру" },
        ],
      },
    ],
  },
  {
    type: "image-text",
    label: "Текст с изображением",
    description: "Две колонки с текстом, кнопкой и фотографией.",
    defaultContent: {
      eyebrow: "Атмосфера",
      title: "Заголовок раздела",
      body: "Опишите преимущество или формат отдыха.",
      buttonLabel: "Подробнее",
      buttonUrl: "#",
      imagePosition: "right",
      imageId: null,
      imageUrl: "",
      imageAlt: "",
    },
    fields: [
      ...headingFields,
      { kind: "textarea", key: "body", label: "Текст" },
      ...buttonFields,
      { kind: "image", key: "image", label: "Изображение" },
      {
        kind: "select",
        key: "imagePosition",
        label: "Положение изображения",
        options: [
          { value: "right", label: "Справа" },
          { value: "left", label: "Слева" },
        ],
      },
    ],
  },
  {
    type: "cards",
    label: "Карточки",
    description: "Сетка карточек с изображениями и ссылками.",
    defaultContent: {
      eyebrow: "Варианты",
      title: "Выберите свой формат",
      intro: "Добавьте несколько вариантов для сравнения.",
      items: [
        { title: "Первая карточка", text: "Описание карточки", linkLabel: "Подробнее", linkUrl: "#", imageId: null, imageUrl: "", imageAlt: "", imageNightId: null, imageNightUrl: "", imageNightAlt: "" },
      ],
    },
    fields: [
      ...headingFields,
      { kind: "textarea", key: "intro", label: "Вводный текст" },
      {
        kind: "repeater",
        key: "items",
        label: "Карточки",
        addLabel: "Добавить карточку",
        itemLabel: "Карточка",
        defaultItem: { title: "Новая карточка", text: "", linkLabel: "Подробнее", linkUrl: "#", imageId: null, imageUrl: "", imageAlt: "", imageNightId: null, imageNightUrl: "", imageNightAlt: "" },
        fields: [
          { kind: "text", key: "title", label: "Название" },
          { kind: "textarea", key: "text", label: "Описание" },
          { kind: "text", key: "linkLabel", label: "Текст ссылки" },
          { kind: "url", key: "linkUrl", label: "Ссылка" },
          { kind: "image", key: "image", label: "Изображение" },
          { kind: "image", key: "imageNight", label: "Изображение ночью (необязательно)" },
        ],
      },
    ],
  },
  {
    type: "features",
    label: "Список преимуществ",
    description: "Преимущества с короткими подписями.",
    defaultContent: {
      eyebrow: "Почему мы",
      title: "Всё для комфортного отдыха",
      items: [{ title: "Преимущество", text: "Короткое описание", icon: "★", imageId: null, imageUrl: "", imageAlt: "" }],
    },
    fields: [
      ...headingFields,
      {
        kind: "repeater",
        key: "items",
        label: "Преимущества",
        addLabel: "Добавить преимущество",
        itemLabel: "Преимущество",
        defaultItem: { title: "Новое преимущество", text: "", icon: "★", imageId: null, imageUrl: "", imageAlt: "" },
        fields: [
          { kind: "text", key: "icon", label: "Иконка или символ" },
          { kind: "text", key: "title", label: "Название" },
          { kind: "textarea", key: "text", label: "Описание" },
          { kind: "image", key: "image", label: "Изображение (необязательно)" },
        ],
      },
    ],
  },
  {
    type: "steps",
    label: "Этапы или шаги",
    description: "Нумерованный процесс из нескольких шагов.",
    defaultContent: {
      eyebrow: "Как это работает",
      title: "Три шага до отдыха",
      items: [{ title: "Первый шаг", text: "Опишите действие посетителя" }],
    },
    fields: [
      ...headingFields,
      {
        kind: "repeater",
        key: "items",
        label: "Шаги",
        addLabel: "Добавить шаг",
        itemLabel: "Шаг",
        defaultItem: { title: "Новый шаг", text: "" },
        fields: [
          { kind: "text", key: "title", label: "Название" },
          { kind: "textarea", key: "text", label: "Описание" },
        ],
      },
    ],
  },
  {
    type: "stats",
    label: "Показатели",
    description: "Крупные цифры и короткие подписи.",
    defaultContent: {
      eyebrow: "В цифрах",
      title: "Camping Drive",
      items: [{ value: "24/7", label: "поддержка гостей" }],
    },
    fields: [
      ...headingFields,
      {
        kind: "repeater",
        key: "items",
        label: "Показатели",
        addLabel: "Добавить показатель",
        itemLabel: "Показатель",
        defaultItem: { value: "100+", label: "описание" },
        fields: [
          { kind: "text", key: "value", label: "Значение" },
          { kind: "text", key: "label", label: "Подпись" },
        ],
      },
    ],
  },
  {
    type: "gallery",
    label: "Галерея",
    description: "Набор фотографий с подписями.",
    defaultContent: {
      eyebrow: "Галерея",
      title: "Посмотрите, как у нас",
      items: [{ imageId: null, imageUrl: "", imageAlt: "", caption: "" }],
    },
    fields: [
      ...headingFields,
      {
        kind: "repeater",
        key: "items",
        label: "Фотографии",
        addLabel: "Добавить фотографию",
        itemLabel: "Фотография",
        defaultItem: { imageId: null, imageUrl: "", imageAlt: "", caption: "" },
        fields: [
          { kind: "image", key: "image", label: "Изображение" },
          { kind: "text", key: "caption", label: "Подпись" },
        ],
      },
    ],
  },
  {
    type: "reviews",
    label: "Отзывы",
    description: "Цитаты гостей, имена и оценка.",
    defaultContent: {
      eyebrow: "Отзывы",
      title: "Что говорят гости",
      items: [{ name: "Имя гостя", text: "Текст отзыва", rating: 5 }],
    },
    fields: [
      ...headingFields,
      {
        kind: "repeater",
        key: "items",
        label: "Отзывы",
        addLabel: "Добавить отзыв",
        itemLabel: "Отзыв",
        defaultItem: { name: "Имя гостя", text: "", rating: 5 },
        fields: [
          { kind: "text", key: "name", label: "Имя" },
          { kind: "textarea", key: "text", label: "Отзыв" },
          { kind: "number", key: "rating", label: "Оценка", min: 1, max: 5 },
        ],
      },
    ],
  },
  {
    type: "faq",
    label: "FAQ",
    description: "Вопросы и ответы в раскрывающемся списке.",
    defaultContent: {
      eyebrow: "Частые вопросы",
      title: "Всё, что важно знать",
      items: [{ question: "Первый вопрос", answer: "Ответ на вопрос" }],
    },
    fields: [
      ...headingFields,
      {
        kind: "repeater",
        key: "items",
        label: "Вопросы",
        addLabel: "Добавить вопрос",
        itemLabel: "Вопрос",
        defaultItem: { question: "Новый вопрос", answer: "" },
        fields: [
          { kind: "text", key: "question", label: "Вопрос" },
          { kind: "textarea", key: "answer", label: "Ответ" },
        ],
      },
    ],
  },
  {
    type: "route-map",
    label: "Маршрут и карта",
    description: "Адрес, инструкция, ссылка на карту и изображение.",
    defaultContent: {
      eyebrow: "Как добраться",
      title: "Маршрут до Camping Drive",
      address: "Укажите адрес",
      body: "Опишите маршрут и важные ориентиры.",
      mapUrl: "https://maps.google.com/",
      buttonLabel: "Открыть карту",
      buttonUrl: "https://maps.google.com/",
      imageId: null,
      imageUrl: "",
      imageAlt: "",
    },
    fields: [
      ...headingFields,
      { kind: "text", key: "address", label: "Адрес" },
      { kind: "textarea", key: "body", label: "Описание маршрута" },
      { kind: "url", key: "mapUrl", label: "Ссылка для карты" },
      ...buttonFields,
      { kind: "image", key: "image", label: "Схема или фотография маршрута" },
    ],
  },
  {
    type: "cta",
    label: "Призыв к действию",
    description: "Контрастный финальный блок с кнопкой.",
    defaultContent: {
      eyebrow: "Готовы к поездке?",
      title: "Забронируйте отдых",
      text: "Выберите удобные даты и приезжайте за впечатлениями.",
      buttonLabel: "Забронировать",
      buttonUrl: "#booking",
      backgroundImageId: null,
      backgroundImageUrl: "",
      backgroundImageAlt: "",
      backgroundImageNightId: null,
      backgroundImageNightUrl: "",
      backgroundImageNightAlt: "",
    },
    fields: [
      ...headingFields,
      { kind: "textarea", key: "text", label: "Текст" },
      ...buttonFields,
      { kind: "image", key: "backgroundImage", label: "Фоновое изображение" },
      { kind: "image", key: "backgroundImageNight", label: "Фоновое изображение ночью (необязательно)" },
    ],
  },
  {
    type: "latest-news",
    label: "Последние новости",
    description: "Автоматическая подборка последних публикаций.",
    defaultContent: {
      eyebrow: "Новости",
      title: "Последнее из Camping Drive",
      count: 3,
      buttonLabel: "Все новости",
      buttonUrl: "/news",
    },
    fields: [
      ...headingFields,
      { kind: "number", key: "count", label: "Количество новостей", min: 1, max: 12 },
      ...buttonFields,
    ],
  },
  {
    type: "marquee",
    label: "Бегущая строка",
    description: "Горизонтальная лента с короткими подписями.",
    defaultContent: {
      anchor: "formats",
      items: [{ text: "Своя палатка" }, { text: "Домики" }, { text: "Активный отдых" }],
    },
    fields: [
      { kind: "text", key: "anchor", label: "HTML-якорь", placeholder: "formats" },
      {
        kind: "repeater",
        key: "items",
        label: "Подписи",
        addLabel: "Добавить подпись",
        itemLabel: "Подпись",
        defaultItem: { text: "Новая подпись" },
        maxItems: 20,
        fields: [{ kind: "text", key: "text", label: "Текст" }],
      },
    ],
  },
];

const definitionByType = new Map(BLOCK_DEFINITIONS.map((definition) => [definition.type, definition]));

export function getBlockDefinition(type: string): BlockDefinition | undefined {
  return definitionByType.get(type);
}

export function createDefaultBlockContent(type: string): PageBlockContent {
  const definition = getBlockDefinition(type);
  return definition ? structuredClone(definition.defaultContent) : {};
}
