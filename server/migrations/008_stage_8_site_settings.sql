INSERT INTO site_settings (key, value, description, is_public)
SELECT 'site.legacy', value, 'Резервная копия настройки site до этапа 8', false
FROM site_settings
WHERE key = 'site'
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_settings (key, value, description, is_public)
VALUES (
  'site',
  '{
    "siteName": "Кемпинг Драйв",
    "locationLabel": "Киржач · Владимирская область",
    "logoImageId": null,
    "logoAlt": "Кемпинг Драйв",
    "phones": [
      {"label": "Основной телефон", "display": "+7 (985) 801-24-43", "href": "tel:+79858012443"},
      {"label": "Экстренная связь", "display": "+7 (915) 403-41-31", "href": "tel:+79154034131"}
    ],
    "address": "Киржач, Владимирская область",
    "routeUrl": "https://yandex.ru/maps?ll=38.980568%2C55.988505&mode=route&rtext=~55.988505%2C38.980568&ruri=~ymapsbm1%3A%2F%2Forg%3Foid%3D179712262023",
    "contactLinks": [
      {"label": "Отзывы на Яндекс Картах", "href": "https://yandex.ru/maps/org/kemping_drayv/179712262023/reviews/"},
      {"label": "Глэмпинг Unity", "href": "https://www.glamping-unity.ru"}
    ],
    "menu": [
      {"label": "Отдых", "href": "/#stay"},
      {"label": "Чем заняться", "href": "/#activities"},
      {"label": "Территория", "href": "/#territory"},
      {"label": "Фото", "href": "/#gallery"},
      {"label": "Отзывы", "href": "/#reviews"},
      {"label": "Новости", "href": "/news"},
      {"label": "Как добраться", "href": "/#route"}
    ],
    "footer": {
      "description": "Живой кемпинг в Киржаче: палатки, домики, костры, река и 30 гектаров пространства.",
      "columns": [
        {"title": "Отдых", "links": [{"label": "Своя палатка", "href": "/#stay"}, {"label": "Домики", "href": "/#stay"}, {"label": "С детьми", "href": "/#stay"}, {"label": "С питомцами", "href": "/#stay"}]},
        {"title": "Активности", "links": [{"label": "Байдарки", "href": "/#activities"}, {"label": "SUP", "href": "/#activities"}, {"label": "Квадроциклы", "href": "/#activities"}, {"label": "Баня и чан", "href": "/#activities"}]},
        {"title": "Информация", "links": [{"label": "Как добраться", "href": "/#route"}, {"label": "Правила", "href": "/#rules"}, {"label": "Новости", "href": "/news"}, {"label": "Контакты", "href": "/#contacts"}]}
      ],
      "legalText": "Сайт не использует формы, аналитику и файлы cookie."
    },
    "floatingActions": [
      {"label": "Позвонить", "icon": "phone", "linkType": "primaryPhone", "href": "", "enabled": true, "highlighted": false},
      {"label": "Маршрут", "icon": "route", "linkType": "route", "href": "", "enabled": true, "highlighted": false},
      {"label": "Контакты", "icon": "contacts", "linkType": "contacts", "href": "", "enabled": true, "highlighted": true}
    ],
    "newsSeo": {
      "title": "Новости — Кемпинг Драйв",
      "description": "Новости и события кемпинга «Кемпинг Драйв» во Владимирской области."
    }
  }'::jsonb,
  'Логотип, контакты, меню, подвал, кнопки связи и общие SEO-настройки сайта',
  true
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE site_setting_images (
  setting_key varchar(100) NOT NULL REFERENCES site_settings(key) ON DELETE CASCADE,
  image_id bigint NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
  PRIMARY KEY (setting_key, image_id)
);

CREATE INDEX site_setting_images_image_idx ON site_setting_images (image_id, setting_key);

CREATE FUNCTION sync_site_setting_images() RETURNS trigger AS $$
DECLARE
  raw_logo_id text;
BEGIN
  DELETE FROM site_setting_images WHERE setting_key = NEW.key;

  IF NEW.key <> 'site' OR NEW.value->'logoImageId' IS NULL OR jsonb_typeof(NEW.value->'logoImageId') = 'null' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.value->'logoImageId') <> 'string' THEN
    RAISE EXCEPTION 'Site logoImageId must be a string or null' USING ERRCODE = '23514';
  END IF;

  raw_logo_id := NEW.value->>'logoImageId';
  IF raw_logo_id !~ '^[1-9][0-9]{0,18}$' OR raw_logo_id::numeric > 9223372036854775807 THEN
    RAISE EXCEPTION 'Site logoImageId is invalid' USING ERRCODE = '23514';
  END IF;

  INSERT INTO site_setting_images (setting_key, image_id) VALUES (NEW.key, raw_logo_id::bigint);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER site_settings_sync_images
AFTER INSERT OR UPDATE OF value ON site_settings
FOR EACH ROW EXECUTE FUNCTION sync_site_setting_images();

INSERT INTO site_setting_images (setting_key, image_id)
SELECT setting.key, (setting.value->>'logoImageId')::bigint
FROM site_settings AS setting
WHERE setting.key = 'site'
  AND jsonb_typeof(setting.value->'logoImageId') = 'string'
  AND setting.value->>'logoImageId' ~ '^[1-9][0-9]{0,18}$'
  AND (setting.value->>'logoImageId')::numeric <= 9223372036854775807;
