-- DESIGN DRAFT ONLY. NOT in netlify/database/migrations.
-- Depends on docs/sql-drafts/20261028151000_sync_schema.sql.
-- Never auto-enroll devices on sign-in; this key must be approved by the
-- actual device owner in a separate, explicitly confirmed pairing flow.
ALTER TABLE sync_publisher_devices
  ADD COLUMN public_key_jwk JSONB,
  ADD CONSTRAINT publisher_public_key_shape CHECK (
    public_key_jwk IS NULL OR
    (public_key_jwk->>'kty' = 'EC'
      AND public_key_jwk->>'crv' = 'P-256'
      AND jsonb_typeof(public_key_jwk->'x') = 'string'
      AND jsonb_typeof(public_key_jwk->'y') = 'string'
      AND NOT public_key_jwk ? 'd')
  );

-- One actively registered publisher per verified Netlify account.
-- Revoking that publisher allows a NEW phone to be registered after
-- deliberate user approval; old public keys remain an audit entry.
CREATE UNIQUE INDEX one_live_publisher_per_account
  ON sync_publisher_devices(subject)
  WHERE revoked_at IS NULL;

CREATE TABLE sync_device_challenges (
  subject TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nonce UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(subject, device_id, nonce),
  FOREIGN KEY(subject, device_id)
    REFERENCES sync_publisher_devices(subject, device_id)
);
CREATE INDEX sync_device_challenges_expiry_idx
  ON sync_device_challenges(expires_at);

-- This is intentionally not a pairing endpoint, migration, or SQL admin grant.
-- Caller must register a fresh device public key separately, with confirmation.
