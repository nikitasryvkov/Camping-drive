DO $$
DECLARE
  legacy_page_id bigint;
  candidate_slug text := 'news-archive';
  suffix integer := 1;
BEGIN
  SELECT id INTO legacy_page_id FROM pages WHERE slug = 'news';

  IF legacy_page_id IS NOT NULL THEN
    WHILE EXISTS (SELECT 1 FROM pages WHERE slug = candidate_slug) LOOP
      suffix := suffix + 1;
      candidate_slug := 'news-archive-' || suffix::text;
    END LOOP;

    UPDATE pages SET slug = candidate_slug WHERE id = legacy_page_id;
    RAISE NOTICE 'Reserved CMS page slug news moved to %', candidate_slug;
  END IF;
END;
$$;

UPDATE news
SET status = 'draft'
WHERE status = 'published'
  AND (
    excerpt !~ '[^[:space:]]'
    OR content !~ '[^[:space:]]'
  );

ALTER TABLE pages
ADD CONSTRAINT pages_slug_not_reserved_news
CHECK (slug <> 'news');

ALTER TABLE news
ADD CONSTRAINT news_published_content_present
CHECK (
  status <> 'published'
  OR (
    excerpt ~ '[^[:space:]]'
    AND content ~ '[^[:space:]]'
  )
);
