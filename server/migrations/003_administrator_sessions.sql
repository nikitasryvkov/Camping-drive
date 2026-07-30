ALTER TABLE administrators
  ADD COLUMN role varchar(32) NOT NULL DEFAULT 'administrator',
  ADD CONSTRAINT administrators_role_check CHECK (role = 'administrator');

CREATE TABLE administrator_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  administrator_id bigint NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT administrator_sessions_token_hash_format
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT administrator_sessions_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE INDEX administrator_sessions_administrator_idx
  ON administrator_sessions (administrator_id, expires_at DESC);

CREATE INDEX administrator_sessions_expiry_idx
  ON administrator_sessions (expires_at);
