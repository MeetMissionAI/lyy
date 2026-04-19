-- Inverse-direction index on thread_participants for "list all threads
-- this peer is in" lookups in listThreadsForPeer / archive checks.
-- The PK is (thread_id, peer_id) which doesn't help when filtering by peer_id alone.
CREATE INDEX IF NOT EXISTS thread_participants_peer_idx
  ON thread_participants(peer_id);
