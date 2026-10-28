-- DESIGN DRAFT ONLY. Deliberately NOT under netlify/database/migrations/.
-- Copy into the actual migration directory only after security review and
-- a deliberate deploy-preview rehearsal with SYNTHETIC data.
-- This schema must never receive real observation plaintext.
CREATE TABLE sync_heads (
    subject TEXT PRIMARY KEY,
    snapshot_id UUID,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    CHECK ((snapshot_id IS NULL AND revision = 0)
        OR (snapshot_id IS NOT NULL AND revision > 0))
);

CREATE TABLE sync_publisher_devices (
    subject TEXT NOT NULL,
    device_id TEXT NOT NULL,
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (subject, device_id)
);

CREATE TABLE sync_snapshots (
    subject TEXT NOT NULL,
    snapshot_id UUID NOT NULL,
    parent_snapshot_id UUID,
    revision BIGINT NOT NULL CHECK (revision > 0),
    envelope JSONB NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
    committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, snapshot_id),
    UNIQUE (subject, revision),
    FOREIGN KEY (subject, parent_snapshot_id)
        REFERENCES sync_snapshots(subject, snapshot_id),
    CHECK (snapshot_id IS DISTINCT FROM parent_snapshot_id)
);

CREATE INDEX sync_snapshots_subject_recent_idx
    ON sync_snapshots (subject, revision DESC);

-- No blanket INSERT into sync_publisher_devices. Device provisioning and
-- revocation must be a separate authenticated, approved pairing workflow.
-- No PUBLIC grants, exposed SQL endpoints or user-supplied identity columns.
