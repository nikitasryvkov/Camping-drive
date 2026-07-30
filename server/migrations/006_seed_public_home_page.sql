DO $migration$
DECLARE
  home_page_id bigint;
  should_seed boolean;
BEGIN
  INSERT INTO pages (slug, title, status, seo_title, seo_description)
  VALUES (
    'home',
    'Главная',
    'published',
    'Кемпинг Драйв в Киржаче — палатки, домики и отдых на природе',
    'Кемпинг Драйв во Владимирской области: 30 гектаров природы, места для палаток, домики, костры, баня, байдарки, SUP и активный отдых рядом с рекой Киржач.'
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO home_page_id;

  IF home_page_id IS NULL THEN
    SELECT page.id, NOT EXISTS (SELECT 1 FROM page_blocks AS block WHERE block.page_id = page.id)
    INTO home_page_id, should_seed
    FROM pages AS page
    WHERE page.slug = 'home';

    IF should_seed THEN
      UPDATE pages
      SET
        title = 'Главная',
        status = 'published',
        seo_title = 'Кемпинг Драйв в Киржаче — палатки, домики и отдых на природе',
        seo_description = 'Кемпинг Драйв во Владимирской области: 30 гектаров природы, места для палаток, домики, костры, баня, байдарки, SUP и активный отдых рядом с рекой Киржач.'
      WHERE id = home_page_id;
    ELSE
      -- An administrator may already have started the home page during stage 5.
      -- Preserve its blocks, metadata and publication status exactly as they are.
      RAISE NOTICE 'Existing home page has content and will not be changed';
    END IF;
  ELSE
    should_seed := true;
  END IF;

  IF NOT should_seed THEN
    RETURN;
  END IF;

  INSERT INTO page_blocks (page_id, type, position, is_visible, content)
  VALUES
    (
      home_page_id,
      'hero',
      0,
      true,
      $json${
        "anchor": "top",
        "eyebrow": "Киржач · Владимирская область",
        "title": "Здесь заканчивается суета и начинается отдых.",
        "text": "30 гектаров леса и полей, река в десяти минутах пешком, палатки, домики, костры и активный отдых — недалеко от Москвы.",
        "primaryButtonLabel": "Позвонить и уточнить",
        "primaryButtonUrl": "tel:+79858012443",
        "secondaryButtonLabel": "Построить маршрут",
        "secondaryButtonUrl": "https://yandex.ru/maps?ll=38.980568%2C55.988505&mode=route&rtext=~55.988505%2C38.980568&ruri=~ymapsbm1%3A%2F%2Forg%3Foid%3D179712262023",
        "backgroundImageId": null,
        "backgroundImageUrl": "/media/hero-day.webp",
        "backgroundImageAlt": "Кемпинг среди полей и леса днём",
        "backgroundImageNightId": null,
        "backgroundImageNightUrl": "/media/hero-night.webp",
        "backgroundImageNightAlt": "Кемпинг среди полей и леса ночью"
      }$json$::jsonb
    ),
    (
      home_page_id,
      'text',
      1,
      true,
      $json${
        "anchor": "intro",
        "eyebrow": "Не база отдыха по расписанию",
        "title": "Можно приехать за тишиной. А можно — за приключением.",
        "body": "Поставьте свою палатку в уединенной части территории, выберите домик, отправьтесь на сплав или проведите вечер у костра. Мы поможем с маршрутом, снаряжением и бытовыми мелочами.",
        "alignment": "left"
      }$json$::jsonb
    ),
    (
      home_page_id,
      'marquee',
      2,
      true,
      $json${
        "anchor": "formats",
        "items": [
          {"text":"Своя палатка"},
          {"text":"Домики"},
          {"text":"Костры"},
          {"text":"Байдарки"},
          {"text":"SUP"},
          {"text":"Квадроциклы"},
          {"text":"Баня"},
          {"text":"Сибирский чан"},
          {"text":"Ферма"},
          {"text":"Тишина после 23:00"}
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'cards',
      3,
      true,
      $json${
        "anchor": "stay",
        "eyebrow": "Как хотите отдохнуть?",
        "title": "Выберите свой уровень свободы и комфорта.",
        "intro": "Можно приехать налегке, поставить свою палатку или остановиться в домике — территория позволяет не мешать друг другу.",
        "items": [
          {
            "title": "Приехать со своей палаткой",
            "text": "Для обычного палаточного отдыха предварительное бронирование места не требуется. На территории подберут участок для компании, семьи или уединенного отдыха.\n\nКостровые зоны и мангалы · столы и лавки · летние души и санузлы · парковка под видеонаблюдением.",
            "linkLabel": "Узнать условия",
            "linkUrl": "tel:+79858012443",
            "imageId": null,
            "imageUrl": "/media/stay-own-tent-day.webp",
            "imageAlt": "Палатка на территории кемпинга",
            "imageNightId": null,
            "imageNightUrl": "/media/stay-own-tent-night.webp",
            "imageNightAlt": "Палатка на территории кемпинга ночью"
          },
          {
            "title": "Арендовать необходимое на месте",
            "text": "Если давно не были в кемпинге или едете впервые, часть оборудования можно взять в аренду. Точный состав и наличие уточняются перед поездкой.\n\nПалатки и туристическое снаряжение · помощь с бытовыми мелочами · рекомендации по подготовке.",
            "linkLabel": "Спросить о наличии",
            "linkUrl": "tel:+79858012443",
            "imageId": null,
            "imageUrl": "/media/stay-rental-day.webp",
            "imageAlt": "Арендное туристическое снаряжение",
            "imageNightId": null,
            "imageNightUrl": "/media/stay-rental-night.webp",
            "imageNightAlt": "Арендное туристическое снаряжение ночью"
          },
          {
            "title": "Остановиться в домике",
            "text": "Комфортные домики находятся на территории партнерского глэмпинга Unity. Для размещения требуется предварительное бронирование.\n\nОтдельное размещение · доступ к территории кемпинга · баня и сибирские чаны.",
            "linkLabel": "Посмотреть домики",
            "linkUrl": "https://www.glamping-unity.ru",
            "imageId": null,
            "imageUrl": "/media/stay-glamping-day.webp",
            "imageAlt": "Домик глэмпинга среди берёз",
            "imageNightId": null,
            "imageNightUrl": "/media/stay-glamping-night.webp",
            "imageNightAlt": "Домик глэмпинга среди берёз ночью"
          },
          {
            "title": "Выбрать подходящую часть территории",
            "text": "Для семей с детьми предусмотрена отдельная зона. Для гостей с питомцами действует дальняя зона кемпинга, где больше пространства и меньше соседей.\n\nСемейная зона · ферма с животными · дальняя зона для питомцев.",
            "linkLabel": "Подобрать зону",
            "linkUrl": "tel:+79858012443",
            "imageId": null,
            "imageUrl": "/media/stay-family-day.webp",
            "imageAlt": "Семейный отдых на природе",
            "imageNightId": null,
            "imageNightUrl": "/media/stay-family-night.webp",
            "imageNightAlt": "Семейный отдых на природе ночью"
          }
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'cards',
      4,
      true,
      $json${
        "anchor": "activities",
        "eyebrow": "Чем заняться",
        "title": "Выберите темп: от спокойного вечера до маршрута по реке.",
        "intro": "Активности доступны по предварительному согласованию.",
        "items": [
          {"title":"Сплав на байдарках","text":"Маршруты по реке Киржач, доставка к точке старта и встреча после сплава — по предварительному согласованию.","linkLabel":"Уточнить доступность","linkUrl":"tel:+79858012443","imageId":null,"imageUrl":"/media/activity-kayak.webp","imageAlt":"Гость на байдарке во время сплава по реке","imageNightId":null,"imageNightUrl":"","imageNightAlt":""},
          {"title":"SUP-доски","text":"Прогулка по воде или самостоятельный маршрут. Аренда и трансфер согласуются заранее.","linkLabel":"Уточнить доступность","linkUrl":"tel:+79858012443","imageId":null,"imageUrl":"/media/activity-sup.webp","imageAlt":"Прогулка на SUP-доске по реке рядом с кемпингом","imageNightId":null,"imageNightUrl":"","imageNightAlt":""},
          {"title":"Квадроциклы и мототехника","text":"Прокат техники и активные маршруты по окрестностям. Услуга недоступна гостям в состоянии опьянения.","linkLabel":"Уточнить доступность","linkUrl":"tel:+79858012443","imageId":null,"imageUrl":"/media/activity-quad.webp","imageAlt":"Квадроцикл на полевом маршруте во время заката","imageNightId":null,"imageNightUrl":"","imageNightAlt":""},
          {"title":"Баня и сибирский чан","text":"Дровяная баня и горячий чан для спокойного завершения дня.","linkLabel":"Уточнить доступность","linkUrl":"tel:+79858012443","imageId":null,"imageUrl":"/media/activity-bath.webp","imageAlt":"Освещенная вечером деревянная зона отдыха","imageNightId":null,"imageNightUrl":"","imageNightAlt":""},
          {"title":"Ферма и животные","text":"Козы, коты, свиньи, гусь и другие обитатели территории. Подходит для семейного отдыха.","linkLabel":"Узнать подробнее","linkUrl":"tel:+79858012443","imageId":null,"imageUrl":"/media/activity-farm.webp","imageAlt":"Козы на ферме Кемпинг Драйв","imageNightId":null,"imageNightUrl":"","imageNightAlt":""},
          {"title":"Костер и вечер на природе","text":"Разжигать огонь можно только в оборудованных костровых зонах и мангалах.","linkLabel":"Узнать правила","linkUrl":"#rules","imageId":null,"imageUrl":"/media/activity-campfire.webp","imageAlt":"Вечерний костер в оборудованной зоне","imageNightId":null,"imageNightUrl":"","imageNightAlt":""}
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'image-text',
      5,
      true,
      $json${
        "anchor": "territory",
        "eyebrow": "30 гектаров пространства",
        "title": "Ближе к общему огню или дальше от всех.",
        "body": "Территория вытянута примерно на километр. Можно расположиться ближе к общей инфраструктуре или выбрать более удаленное место, где почти не слышно других гостей. Леса и поля начинаются сразу за территорией, а до реки Киржач — примерно десять минут пешком.",
        "buttonLabel": "Открыть схему территории",
        "buttonUrl": "/media/territory-scheme.png",
        "imagePosition": "right",
        "imageId": null,
        "imageUrl": "/media/territory-main.webp",
        "imageAlt": "Просторное поле и леса рядом с Кемпинг Драйв"
      }$json$::jsonb
    ),
    (
      home_page_id,
      'features',
      6,
      true,
      $json${
        "anchor": "amenities",
        "eyebrow": "Что есть на месте",
        "title": "Бытовые вещи продуманы. Природа остается дикой.",
        "items": [
          {"icon":"◉","title":"Wi‑Fi","text":"Связь на территории.","imageId":null,"imageUrl":"/media/amenities/wifi.webp","imageAlt":"Wi-Fi на территории"},
          {"icon":"◇","title":"Общие туалеты","text":"Общая санитарная зона.","imageId":null,"imageUrl":"/media/amenities/shared-toilets.webp","imageAlt":"Общие туалеты"},
          {"icon":"≈","title":"Летние души","text":"Душевые на территории.","imageId":null,"imageUrl":"/media/amenities/summer-showers.webp","imageAlt":"Летние души"},
          {"icon":"≈","title":"Теплый душ для детей","text":"Доступность уточняйте перед поездкой.","imageId":null,"imageUrl":"/media/amenities/kids-warm-shower.webp","imageAlt":"Тёплый душ для детей"},
          {"icon":"●","title":"Техническая вода","text":"Вода для бытовых нужд.","imageId":null,"imageUrl":"/media/amenities/utility-water.webp","imageAlt":"Техническая вода"},
          {"icon":"●","title":"Питьевая вода","text":"Сотрудники помогут с питьевой водой.","imageId":null,"imageUrl":"/media/amenities/drinking-water.webp","imageAlt":"Питьевая вода"},
          {"icon":"▰","title":"Столы и лавки","text":"Места для отдыха и приёма пищи.","imageId":null,"imageUrl":"/media/amenities/tables-benches.webp","imageAlt":"Столы и лавки"},
          {"icon":"✦","title":"Костровые зоны","text":"Огонь разрешён в оборудованных местах.","imageId":null,"imageUrl":"/media/amenities/campfire.webp","imageAlt":"Костровая зона"},
          {"icon":"✦","title":"Мангалы","text":"Оборудованные места для приготовления еды.","imageId":null,"imageUrl":"/media/amenities/brazier.webp","imageAlt":"Мангал"},
          {"icon":"P","title":"Парковка","text":"Парковка под видеонаблюдением.","imageId":null,"imageUrl":"/media/amenities/parking.webp","imageAlt":"Парковка"},
          {"icon":"24","title":"Сотрудники 24/7","text":"Сотрудники постоянно находятся на территории.","imageId":null,"imageUrl":"/media/amenities/staff-24-7.webp","imageAlt":"Сотрудники на территории"},
          {"icon":"☕","title":"Завтраки и напитки","text":"Место с завтраками и напитками.","imageId":null,"imageUrl":"/media/amenities/breakfast-drinks.webp","imageAlt":"Завтраки и напитки"},
          {"icon":"♨","title":"Баня","text":"Дровяная баня по согласованию.","imageId":null,"imageUrl":"/media/amenities/bathhouse.webp","imageAlt":"Баня"},
          {"icon":"♨","title":"Сибирский чан","text":"Горячий чан для отдыха.","imageId":null,"imageUrl":"/media/amenities/siberian-hot-tub.webp","imageAlt":"Сибирский чан"},
          {"icon":"+","title":"Аренда инвентаря","text":"Необходимое снаряжение можно уточнить заранее.","imageId":null,"imageUrl":"/media/amenities/equipment-rental.webp","imageAlt":"Аренда инвентаря"},
          {"icon":"→","title":"Маршрут и трансфер","text":"Помощь с маршрутом и трансфером по согласованию.","imageId":null,"imageUrl":"/media/amenities/route-transfer.webp","imageAlt":"Помощь с маршрутом"}
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'steps',
      7,
      true,
      $json${
        "anchor": "booking",
        "eyebrow": "Как все устроено",
        "title": "Три шага — и можно собирать рюкзак.",
        "items": [
          {"title":"Выберите формат","text":"Со своей палаткой можно приехать без предварительного бронирования места. Домики, техника и водные активности согласуются заранее."},
          {"title":"Уточните детали","text":"Сообщите даты, число гостей, наличие детей или питомцев и интересующие активности."},
          {"title":"Приезжайте на природу","text":"Постройте маршрут в навигаторе или договоритесь о встрече и трансфере."}
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'stats',
      8,
      true,
      $json${
        "anchor": "stats",
        "eyebrow": "Кемпинг Драйв в цифрах",
        "title": "Пространство для отдыха",
        "items": [
          {"value":"30 га","label":"территория"},
          {"value":"10 мин","label":"пешком до реки"},
          {"value":"24/7","label":"сотрудники на территории"},
          {"value":"5.0","label":"рейтинг на Яндекс Картах"}
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'gallery',
      9,
      true,
      $json${
        "anchor": "gallery",
        "eyebrow": "Фото",
        "title": "Как выглядит день, который никуда не торопится.",
        "items": [
          {"imageId":null,"imageUrl":"/media/gallery-01.webp","imageAlt":"Палатки среди берез на территории кемпинга","caption":""},
          {"imageId":null,"imageUrl":"/media/gallery-02.webp","imageAlt":"Вечернее поле и закат рядом с кемпингом","caption":""},
          {"imageId":null,"imageUrl":"/media/gallery-03.webp","imageAlt":"Сплав на байдарке по реке Киржач","caption":""},
          {"imageId":null,"imageUrl":"/media/gallery-04.webp","imageAlt":"Квадроцикл на маршруте по полям","caption":""},
          {"imageId":null,"imageUrl":"/media/gallery-05.webp","imageAlt":"Костер в оборудованной зоне кемпинга","caption":""},
          {"imageId":null,"imageUrl":"/media/gallery-06.webp","imageAlt":"Домик Unity среди берез","caption":""},
          {"imageId":null,"imageUrl":"/media/gallery-07.webp","imageAlt":"Гусь на ферме кемпинга","caption":""},
          {"imageId":null,"imageUrl":"/media/gallery-08.webp","imageAlt":"Деревянный стол и лавки в лесу","caption":""}
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'reviews',
      10,
      true,
      $json${
        "anchor": "reviews",
        "eyebrow": "Отзывы гостей",
        "title": "Что гости запоминают после поездки",
        "items": [
          {"name":"Валерия","text":"Живописное место среди полей, березовых рощ и рядом с рекой. Есть душ, туалет, аренда необходимого и небольшой дворик с животными.","rating":5},
          {"name":"Евгений","text":"Для большой компании подобрали удобное место и подготовили площадку. Чувствуется забота о гостях и внимание к деталям.","rating":5},
          {"name":"Наталья","text":"Тихое и уютное место без шума и суеты. Настоящий глоток свежего воздуха.","rating":5},
          {"name":"Константин","text":"Чистая территория среди молодых сосен, дружелюбный персонал и приятная стоимость.","rating":5}
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'route-map',
      11,
      true,
      $json${
        "anchor": "route",
        "eyebrow": "Как добраться",
        "title": "Последний поворот — и город остается позади.",
        "address": "Киржач, Владимирская область · 55.988505, 38.980568",
        "body": "На автомобиле\nПо трассе М‑12 — ориентировочно от 1 часа 30 минут из восточной части Москвы. По Горьковскому шоссе — ориентировочно от 1 часа 50 минут. Фактическое время зависит от трафика.\n\nНа электричке через Александров\nС Ярославского вокзала до Александрова, затем пересадка на поезд в сторону Орехово‑Зуево и выход на станции Санино. Возможность встречи согласуйте заранее.\n\nЧерез Покров\nС Курского вокзала до станции Покров, затем такси или заранее согласованный трансфер.\n\nТрансфер\nВозможна встреча в Покрове, Киржаче или Санино. Трансфер из Москвы и поездки в магазин доступны только по предварительному согласованию.",
        "mapUrl": "https://yandex.ru/maps?ll=38.980568%2C55.988505&mode=route&rtext=~55.988505%2C38.980568&ruri=~ymapsbm1%3A%2F%2Forg%3Foid%3D179712262023",
        "buttonLabel": "Открыть маршрут",
        "buttonUrl": "https://yandex.ru/maps?ll=38.980568%2C55.988505&mode=route&rtext=~55.988505%2C38.980568&ruri=~ymapsbm1%3A%2F%2Forg%3Foid%3D179712262023",
        "imageId": null,
        "imageUrl": "/media/territory-scheme.png",
        "imageAlt": "Схема расположения объектов на территории"
      }$json$::jsonb
    ),
    (
      home_page_id,
      'faq',
      12,
      true,
      $json${
        "anchor": "rules",
        "eyebrow": "Правила и ответы",
        "title": "Чтобы отдых оставался спокойным для всех.",
        "items": [
          {"question":"Нужно ли бронировать место под свою палатку?","answer":"Обычно предварительное бронирование места не требуется. Перед дальней поездкой рекомендуется проверить актуальный режим работы и временные ограничения."},
          {"question":"Можно ли приехать с детьми?","answer":"Да. Для семей предусмотрена отдельная зона, а на территории есть ферма с животными."},
          {"question":"Можно ли с питомцами?","answer":"Да, в дальней pet-friendly зоне. Она расположена примерно в 800 метрах от основных удобств."},
          {"question":"Где оставить автомобиль?","answer":"На общей парковке у въезда или рядом с административным зданием под видеонаблюдением. К месту размещения можно подъехать для разгрузки, после чего автомобиль нужно переставить."},
          {"question":"Можно ли разводить костер?","answer":"Да, только в оборудованных костровых зонах или мангалах."},
          {"question":"Когда действует режим тишины?","answer":"С 23:00 до 9:00 нельзя шуметь и громко включать музыку."},
          {"question":"Какая вода доступна на территории?","answer":"На территории есть техническая вода. С питьевой водой сотрудники помогут, но запас бутилированной воды лучше взять с собой."},
          {"question":"Как бронируются домики и активности?","answer":"Домики, квадроциклы, байдарки, SUP-доски и другие услуги требуют предварительного согласования и могут требовать предоплату."},
          {"question":"Какие правила возврата предоплаты?","answer":"Перед оплатой необходимо подтвердить актуальные условия. При отказе менее чем за семь дней может возвращаться только половина суммы."},
          {"question":"Что важно знать о дикой природе?","answer":"Не кормите и не пытайтесь трогать диких животных. Если вы потерялись, застряли или столкнулись с происшествием на воде, сразу свяжитесь с администрацией."}
        ]
      }$json$::jsonb
    ),
    (
      home_page_id,
      'cta',
      13,
      true,
      $json${
        "anchor": "final-cta",
        "eyebrow": "Пора выбраться из города",
        "title": "Один свободный вечер может стать целыми выходными на природе.",
        "text": "Позвоните, чтобы уточнить детали отдыха со своей палаткой, в домике или с активным маршрутом.",
        "buttonLabel": "Позвонить",
        "buttonUrl": "tel:+79858012443",
        "backgroundImageId": null,
        "backgroundImageUrl": "/media/final-day.webp",
        "backgroundImageAlt": "Отдых в Кемпинг Драйв",
        "backgroundImageNightId": null,
        "backgroundImageNightUrl": "/media/final-night.webp",
        "backgroundImageNightAlt": "Вечер в Кемпинг Драйв"
      }$json$::jsonb
    );
END
$migration$;
