-- LYY initial schema (Phase 1)
-- Apply with: psql "$DIRECT_URL" -f migrations/0001_init.sql

-- pgcrypto provides gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────────────────
-- peers: identity / directory
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE peers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  disabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- invites: one-time pairing codes (admin-issued)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  for_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────────────────────
-- threads: long-lived peer conversations
-- short_id is the user-facing display id (e.g. #12), allocated monotonically
-- ────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE thread_short_id_seq;

CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id BIGINT UNIQUE NOT NULL DEFAULT nextval('thread_short_id_seq'),
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE thread_participants (
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
  peer_id UUID REFERENCES peers(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, peer_id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- messages: append-only conversation log
-- seq is monotonic per thread, used for "since last seen" diff sync
-- body_tsv is a derived FTS column (trigger below)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE NOT NULL,
  from_peer UUID REFERENCES peers(id) NOT NULL,
  body TEXT NOT NULL,
  body_tsv TSVECTOR,
  sent_at TIMESTAMPTZ DEFAULT now(),
  seq BIGSERIAL
);

CREATE INDEX messages_thread_seq_idx ON messages(thread_id, seq);
CREATE INDEX messages_tsv_idx ON messages USING GIN(body_tsv);

CREATE FUNCTION update_message_tsv() RETURNS trigger AS $$
BEGIN
  NEW.body_tsv := to_tsvector('simple', coalesce(NEW.body, ''));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER messages_tsv_trigger
  BEFORE INSERT OR UPDATE OF body ON messages
  FOR EACH ROW EXECUTE FUNCTION update_message_tsv();

-- ────────────────────────────────────────────────────────────────────────────
-- message_reads: per-peer read state
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE message_reads (
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  peer_id UUID REFERENCES peers(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, peer_id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- thread_archives: per-peer archive state (hides from inbox; recipient-only)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE thread_archives (
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
  peer_id UUID REFERENCES peers(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (thread_id, peer_id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- attachments: blob refs (Supabase Storage paths)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  mime TEXT,
  size BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);
