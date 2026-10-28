-- DESIGN DRAFT ONLY; deliberately NOT under netlify/database/migrations.
-- Depends on 20261028151000_sync_schema.sql, 20261028163500_device_proof_schema.sql,
-- and 20261028191000_pending_pairing.sql.
--
-- Operator signing key lives OUTSIDE the Netlify browser, and must be pinned
-- in server-only configuration when a real operator workflow is approved.
-- Do not put the private key in env vars, Netlify Functions, git or backups.
CREATE TABLE sync_operator_actions (
  site_id UUID NOT NULL,
  nonce UUID NOT NULL,
  subject TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve-publisher','revoke-publisher')),
  request_id UUID NOT NULL,
  device_id UUID NOT NULL,
  fingerprint CHAR(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT NOT NULL CHECK (result IN ('approved','revoked','not-eligible')),
  PRIMARY KEY (site_id, nonce)
);
CREATE INDEX sync_operator_actions_by_owner
  ON sync_operator_actions(subject, applied_at DESC);
-- No grants, exposed SQL endpoints, or live database migrations in this PR.
