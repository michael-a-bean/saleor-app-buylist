/**
 * Extract user-friendly identifier from JWT token
 * JWT format: header.payload.signature (base64 encoded)
 * Payload contains: email, user_id, etc.
 */
export function extractUserFromToken(token: string | null | undefined): string | null {
  if (!token) {
    return null;
  }

  try {
    // JWT has 3 parts separated by dots
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (middle part)
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));

    // Return email if available, otherwise user_id
    if (payload.email) {
      return payload.email;
    }

    if (payload.user_id) {
      return payload.user_id;
    }

    return null;
  } catch {
    // If decoding fails, return null
    return null;
  }
}
