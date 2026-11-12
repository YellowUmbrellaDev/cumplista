CREATE TABLE lists (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  owner_name       TEXT NOT NULL,
  owner_email      TEXT NOT NULL,
  owner_token_hash TEXT NOT NULL,
  locale           TEXT NOT NULL,
  occasion_date    TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  url         TEXT,
  details     TEXT,
  position    INTEGER NOT NULL,
  received_at TEXT
);
CREATE INDEX items_by_list ON items(list_id, position);

CREATE TABLE guests (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT,
  code       TEXT NOT NULL CHECK (length(code) = 4 AND code NOT GLOB '*[^0-9]*'),
  joined_at  TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (list_id, code)
);

-- One row per taken item. The primary key is the concurrency guard: two guests
-- racing for the same item cannot both insert.
CREATE TABLE claims (
  item_id    TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  guest_id   TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX claims_by_guest ON claims(guest_id);

-- Failed code attempts, for brute-force throttling of a 4-digit space.
CREATE TABLE join_failures (
  list_id   TEXT NOT NULL,
  client    TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);
CREATE INDEX join_failures_by_list ON join_failures(list_id, failed_at);
