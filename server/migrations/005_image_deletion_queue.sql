CREATE TABLE image_deletion_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_id bigint NOT NULL,
  storage_path text NOT NULL,
  variants jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT image_deletion_queue_storage_path_not_blank
    CHECK (char_length(btrim(storage_path)) > 0),
  CONSTRAINT image_deletion_queue_variants_object
    CHECK (jsonb_typeof(variants) = 'object'),
  CONSTRAINT image_deletion_queue_attempts_non_negative
    CHECK (attempts >= 0)
);

CREATE INDEX image_deletion_queue_created_at_idx
  ON image_deletion_queue (created_at, id);

CREATE TRIGGER image_deletion_queue_set_updated_at
BEFORE UPDATE ON image_deletion_queue
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
