ALTER TABLE administrators
  DROP CONSTRAINT administrators_login_length,
  ADD CONSTRAINT administrators_login_length
    CHECK (char_length(btrim(login)) BETWEEN 3 AND 100),
  ADD CONSTRAINT administrators_login_trimmed
    CHECK (login = btrim(login));

CREATE TABLE page_block_images (
  page_block_id bigint NOT NULL REFERENCES page_blocks(id) ON DELETE CASCADE,
  image_id bigint NOT NULL REFERENCES images(id) ON DELETE RESTRICT,
  PRIMARY KEY (page_block_id, image_id)
);

CREATE INDEX page_block_images_image_idx ON page_block_images (image_id, page_block_id);

CREATE FUNCTION migration_parse_image_id(input jsonb) RETURNS bigint AS $$
DECLARE
  raw_value text;
BEGIN
  IF jsonb_typeof(input) NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'Page block image ID must be a number or string'
      USING ERRCODE = '23514';
  END IF;

  raw_value := input #>> '{}';
  IF raw_value !~ '^[1-9][0-9]{0,18}$'
     OR raw_value::numeric > 9223372036854775807 THEN
    RAISE EXCEPTION 'Page block contains an invalid image ID'
      USING ERRCODE = '23514';
  END IF;

  RETURN raw_value::bigint;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION migration_extract_image_ids(input jsonb) RETURNS SETOF bigint AS $$
DECLARE
  entry record;
  item jsonb;
  normalized_key text;
BEGIN
  IF jsonb_typeof(input) = 'object' THEN
    FOR entry IN SELECT key, value FROM jsonb_each(input)
    LOOP
      normalized_key := lower(entry.key);

      IF right(normalized_key, 8) = 'imageids' THEN
        IF jsonb_typeof(entry.value) <> 'array' THEN
          RAISE EXCEPTION 'Page block imageIds field must be an array'
            USING ERRCODE = '23514';
        END IF;

        FOR item IN SELECT value FROM jsonb_array_elements(entry.value)
        LOOP
          RETURN NEXT migration_parse_image_id(item);
        END LOOP;
      ELSIF right(normalized_key, 7) = 'imageid' THEN
        IF jsonb_typeof(entry.value) <> 'null' THEN
          RETURN NEXT migration_parse_image_id(entry.value);
        END IF;
      ELSE
        RETURN QUERY SELECT * FROM migration_extract_image_ids(entry.value);
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(input) = 'array' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(input)
    LOOP
      RETURN QUERY SELECT * FROM migration_extract_image_ids(item);
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DO $$
DECLARE
  block_record record;
BEGIN
  FOR block_record IN SELECT id, content FROM page_blocks ORDER BY id
  LOOP
    BEGIN
      PERFORM * FROM migration_extract_image_ids(block_record.content);
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'Cannot migrate image references in page block %: %',
        block_record.id, SQLERRM
        USING
          ERRCODE = '23514',
          HINT = 'Correct or remove invalid imageId/imageIds values in this block and restart the backend.';
    END;
  END LOOP;
END;
$$;

DO $$
DECLARE
  dangling_references text;
BEGIN
  SELECT string_agg(
    format('block %s -> image %s', problem.page_block_id, problem.image_id),
    ', '
  )
  INTO dangling_references
  FROM (
    SELECT DISTINCT block.id AS page_block_id, extracted.image_id
    FROM page_blocks AS block
    CROSS JOIN LATERAL migration_extract_image_ids(block.content) AS extracted(image_id)
    LEFT JOIN images AS image ON image.id = extracted.image_id
    WHERE image.id IS NULL
    ORDER BY block.id, extracted.image_id
    LIMIT 50
  ) AS problem;

  IF dangling_references IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot migrate dangling page block image references: %',
      dangling_references
      USING
        ERRCODE = '23503',
        HINT = 'Restore the referenced images or remove their IDs from page block content, then restart the backend.';
  END IF;
END;
$$;

INSERT INTO page_block_images (page_block_id, image_id)
SELECT DISTINCT block.id, extracted.image_id
FROM page_blocks AS block
CROSS JOIN LATERAL migration_extract_image_ids(block.content) AS extracted(image_id);

DROP FUNCTION migration_extract_image_ids(jsonb);
DROP FUNCTION migration_parse_image_id(jsonb);
