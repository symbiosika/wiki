/**
 * Signed, short-lived access tokens for artifact content.
 *
 * The artifact is served with a CSP `sandbox` (see ./serve.ts), so it runs in
 * an opaque origin: the browser sends it no session cookie and it cannot be
 * given an Authorization header. Access is therefore carried in the URL — a
 * token that names ONE artifact version and an expiry, signed with an HMAC of
 * the server's secret. It sits in the PATH (`/artifact-content/<token>/…`), so
 * the artifact's relative references (`app.js`, `data/x.json`) resolve under
 * it on their own.
 *
 * The token is only ever minted for a user who can read the page at that
 * moment (GET …/artifact). Like a presigned URL it then works for anyone who
 * holds it until it expires; `Referrer-Policy: no-referrer` on the content
 * keeps it from leaking to the CDNs the artifact loads from.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** How long a minted content URL stays valid. */
export const ARTIFACT_TOKEN_TTL_SECONDS = 8 * 60 * 60;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * HMAC key, derived from the server secret so a token can never double as
 * anything else signed with that secret.
 */
const signingKey = (): Buffer => {
  const secret = process.env.JWT_PRIVATE_KEY || process.env.SECRETS_AES_KEY;
  if (!secret) {
    throw new Error("No server secret configured for artifact tokens");
  }
  return createHash("sha256").update(`artifact-content:${secret}`).digest();
};

const sign = (payload: string): string =>
  createHmac("sha256", signingKey()).update(payload).digest("base64url");

/** Mint a content token for one artifact version. */
export const createArtifactToken = (
  versionId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string => {
  const payload = `${versionId}.${nowSeconds + ARTIFACT_TOKEN_TTL_SECONDS}`;
  return `${payload}.${sign(payload)}`;
};

/**
 * The version id a token grants access to, or null when the token is
 * malformed, forged or expired.
 */
export const verifyArtifactToken = (
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [versionId, exp, signature] = parts as [string, string, string];
  if (!UUID.test(versionId) || !/^\d{1,12}$/.test(exp)) return null;

  const expected = Buffer.from(sign(`${versionId}.${exp}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  if (Number(exp) < nowSeconds) return null;
  return versionId.toLowerCase();
};
