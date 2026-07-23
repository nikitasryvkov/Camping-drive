DO $$
DECLARE
  migration_applied_at timestamptz;
BEGIN
  SELECT applied_at INTO migration_applied_at
  FROM schema_migrations
  WHERE name = '006_seed_public_home_page.sql';

  IF migration_applied_at IS NOT NULL THEN
    UPDATE pages AS page
    SET status = 'draft', published_at = NULL
    WHERE page.slug = 'home'
      AND page.created_at < migration_applied_at
      AND page.published_at = migration_applied_at
      AND EXISTS (SELECT 1 FROM page_blocks AS block WHERE block.page_id = page.id);
  END IF;
END;
$$;

CREATE TABLE administrator_login_rate_limits (
  scope_hash char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL,
  CONSTRAINT administrator_login_rate_limits_hash_format CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT administrator_login_rate_limits_attempts_positive CHECK (attempts > 0)
);

CREATE INDEX administrator_login_rate_limits_window_idx
  ON administrator_login_rate_limits (window_started_at);

ALTER TABLE image_deletion_queue
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX image_deletion_queue_retry_idx
  ON image_deletion_queue (next_attempt_at, id);
