-- Owner accounts. A user is an owner, owns many lists, and signs in with a
-- password, Google, or both. session_epoch invalidates every cookie at once.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name          TEXT NOT NULL,
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  session_epoch INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX password_resets_by_user ON password_resets(user_id);

-- invite_token is the single generic link the owner shares. Anyone holding it
-- may register as a guest of this list only.
CREATE TABLE lists (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  locale        TEXT NOT NULL,
  occasion_date TEXT,
  invite_token  TEXT NOT NULL UNIQUE CHECK (length(invite_token) >= 22),
  created_at    TEXT NOT NULL
);
CREATE INDEX lists_by_owner ON lists(owner_user_id, created_at);

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

-- A guest account exists for one list only. The owner path never reads this
-- table, so the owner cannot learn who registered.
CREATE TABLE guests (
  id            TEXT PRIMARY KEY,
  list_id       TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT NOT NULL CHECK (email = lower(email)),
  pin_hash      TEXT NOT NULL,
  session_nonce TEXT NOT NULL CHECK (length(session_nonce) >= 22),
  created_at    TEXT NOT NULL,
  UNIQUE (list_id, email)
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
