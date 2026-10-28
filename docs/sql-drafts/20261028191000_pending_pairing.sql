-- DRAFT ONLY: intentionally NOT in netlify/database/migrations.
-- Depends on the base sync schema and device-proof schema in docs/sql-drafts.
-- A Private Netlify login may request and prove a candidate, but NOT approve it.
-- Manual operator approval is deliberately NOT an HTTP endpoint.
CREATE TABLE sync_pairing_requests (
  subject TEXT NOT NULL,
  request_id UUID NOT NULL,
  nonce UUID NOT NULL,
  device_id UUID NOT NULL,
  public_key_jwk JSONB NOT NULL CHECK (
    public_key_jwk->>'kty' = 'EC' AND public_key_jwk->>'crv' = 'P-256'
    AND jsonb_typeof(public_key_jwk->'x') = 'string'
    AND jsonb_typeof(public_key_jwk->'y') = 'string'
    AND NOT public_key_jwk ? 'd'
  ),
  fingerprint CHAR(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  proved_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  PRIMARY KEY (subject, request_id),
  CHECK (expires_at > created_at),
  CHECK (approved_at IS NULL OR proved_at IS NOT NULL),
  CHECK (approved_at IS NULL OR cancelled_at IS NULL)
);
CREATE UNIQUE INDEX one_pending_pairing_per_subject
  ON sync_pairing_requests(subject)
  WHERE approved_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX sync_pairing_by_owner_created
  ON sync_pairing_requests(subject, created_at DESC);

-- DO NOT add any trigger granting permission after signup or a POST.
-- Only an authenticated, separated operator channel may approve/revoke.
