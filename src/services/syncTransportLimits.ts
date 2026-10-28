/**
 * Netlify synchronous Functions currently limit buffered request AND response
 * payloads to 6 MB. Keep a margin for implementation/wire overhead.
 *
 * This limit is strictly for the future hosted encrypted-sync transport.
 * Existing local encrypted JSON exports retain their separate, larger limit.
 * No chunked upload or external blob-storage fallback is implemented here.
 */
export const MAX_SYNC_HTTP_BODY_BYTES = 5 * 1024 * 1024

/** Count UTF-8 bytes, not JS UTF-16 code units. Never use string.length. */
export function serializedSyncJsonBytes(value: unknown): number {
  const json = JSON.stringify(value)
  if (typeof json !== 'string') throw Error('invalid-json-transport-body')
  return new TextEncoder().encode(json).byteLength
}

/**
 * A phone MUST check its serialized encrypted publish request against this
 * size limit before requesting a one-use challenge or sending data.
 * Returns a size-only decision; never logs the plaintext or ciphertext.
 */
export function checkEncryptedPublishSize(
  expectedHead: string | null,
  snapshot: unknown
): { bytes: number; fits: boolean } {
  const bytes = serializedSyncJsonBytes({ expectedHead, snapshot })
  return { bytes, fits: bytes <= MAX_SYNC_HTTP_BODY_BYTES }
}
