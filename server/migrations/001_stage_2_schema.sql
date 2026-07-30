CREATE TABLE administrators (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login varchar(100) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT administrators_login_length CHECK (char_length(login) BETWEEN 3 AND 100),
  CONSTRAINT administrators_password_hash_not_blank CHECK (char_length(btrim(password_hash)) > 0)
);

CREATE UNIQUE INDEX administrators_login_unique_idx ON administrators (lower(login));

CREATE TABLE images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename varchar(255) NOT NULL UNIQUE,
  original_filename varchar(255) NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type varchar(100) NOT NULL,
  size_bytes bigint NOT NULL,
  width integer,
  height integer,
  alt_text varchar(500),
  variants jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT images_filename_not_blank CHECK (char_length(btrim(filename)) > 0),
  CONSTRAINT images_original_filename_not_blank CHECK (char_length(btrim(original_filename)) > 0),
  CONSTRAINT images_storage_path_not_blank CHECK (char_length(btrim(storage_path)) > 0),
  CONSTRAINT images_mime_type_is_image CHECK (mime_type ~ '^image/[a-z0-9.+-]+$'),
  CONSTRAINT images_size_non_negative CHECK (size_bytes >= 0),
  CONSTRAINT images_width_positive CHECK (width IS NULL OR width > 0),
  CONSTRAINT images_height_positive CHECK (height IS NULL OR height > 0),
  CONSTRAINT images_variants_object CHECK (jsonb_typeof(variants) = 'object')
);

CREATE INDEX images_created_at_idx ON images (created_at DESC, id DESC);

CREATE TABLE pages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug varchar(200) NOT NULL UNIQUE,
  title varchar(300) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  seo_title varchar(300),
  seo_description varchar(500),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pages_slug_not_blank CHECK (char_length(btrim(slug)) > 0),
  CONSTRAINT pages_title_not_blank CHECK (char_length(btrim(title)) > 0),
  CONSTRAINT pages_status_valid CHECK (status IN ('draft', 'published'))
);

CREATE INDEX pages_status_updated_at_idx ON pages (status, updated_at DESC, id DESC);

CREATE TABLE page_blocks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id bigint NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  type varchar(100) NOT NULL,
  position integer NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT page_blocks_type_not_blank CHECK (char_length(btrim(type)) > 0),
  CONSTRAINT page_blocks_position_non_negative CHECK (position >= 0),
  CONSTRAINT page_blocks_content_object CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT page_blocks_page_position_unique UNIQUE (page_id, position)
);

CREATE INDEX page_blocks_page_order_idx ON page_blocks (page_id, position, id);

CREATE TABLE news (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug varchar(200) NOT NULL UNIQUE,
  title varchar(300) NOT NULL,
  excerpt varchar(1000) NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  cover_image_id bigint REFERENCES images(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  seo_title varchar(300),
  seo_description varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_slug_not_blank CHECK (char_length(btrim(slug)) > 0),
  CONSTRAINT news_title_not_blank CHECK (char_length(btrim(title)) > 0),
  CONSTRAINT news_status_valid CHECK (status IN ('draft', 'published'))
);

CREATE INDEX news_status_published_at_idx ON news (status, published_at DESC NULLS LAST, id DESC);
CREATE INDEX news_cover_image_idx ON news (cover_image_id) WHERE cover_image_id IS NOT NULL;

CREATE TABLE site_settings (
  key varchar(100) PRIMARY KEY,
  value jsonb NOT NULL,
  description varchar(500),
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_key_format CHECK (key ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$')
);

CREATE INDEX site_settings_public_key_idx ON site_settings (is_public, key);

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION set_published_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER administrators_set_updated_at
BEFORE UPDATE ON administrators
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER images_set_updated_at
BEFORE UPDATE ON images
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pages_set_updated_at
BEFORE UPDATE ON pages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pages_set_published_at
BEFORE INSERT OR UPDATE ON pages
FOR EACH ROW EXECUTE FUNCTION set_published_at();

CREATE TRIGGER page_blocks_set_updated_at
BEFORE UPDATE ON page_blocks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER news_set_updated_at
BEFORE UPDATE ON news
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER news_set_published_at
BEFORE INSERT OR UPDATE ON news
FOR EACH ROW EXECUTE FUNCTION set_published_at();

CREATE TRIGGER site_settings_set_updated_at
BEFORE UPDATE ON site_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
