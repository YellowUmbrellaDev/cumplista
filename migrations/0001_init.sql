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
  id            TEXT PRIMARY KEY,
  list_id       TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT,
  code          TEXT NOT NULL CHECK (length(code) = 4 AND code NOT GLOB '*[^0-9]*'),
  invite_token  TEXT NOT NULL UNIQUE CHECK (length(invite_token) >= 22),
  session_nonce TEXT NOT NULL CHECK (length(session_nonce) >= 22),
  joined_at     TEXT,
  created_at    TEXT NOT NULL,
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

CREATE TABLE attempts (
  kind   TEXT NOT NULL,
  scope  TEXT NOT NULL,
  client TEXT NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX attempts_by_scope ON attempts(kind, scope, at);
CREATE INDEX attempts_by_client ON attempts(kind, client, at);
CREATE INDEX attempts_by_kind_at ON attempts(kind, at);

-- Gifts a guest plans to buy that are not on the owner's list. Kept out of
-- `items` on purpose: the owner path never reads this table, so privacy does
-- not depend on a filter being remembered in every owner query. The author is
-- the implicit claimer.
CREATE TABLE side_gifts (
  id          TEXT PRIMARY KEY,
  list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  guest_id    TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  url         TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX side_gifts_by_list ON side_gifts(list_id, created_at);
