/**
 * Generates the secrets a preview container needs on its first start and
 * prints them as KEY=VALUE lines on stdout (the entrypoint stores them in the
 * data volume with 0600).
 *
 * Mirrors what `bun run init` produces for a local checkout:
 *   SECRETS_AES_KEY / SECRETS_AES_IV  – AES-256 key + IV for tenant secrets
 *                                       (framework/src/lib/crypt/aes-generate.ts)
 *   JWT_PRIVATE_KEY / JWT_PUBLIC_KEY  – session token secret, see below
 *   OAUTH_INTROSPECTION_SECRET        – shared secret for OAuth2 token
 *                                       introspection (see .env.required-variables)
 *
 * On the JWT keys: tokens are signed with JWT_PRIVATE_KEY and verified with
 * JWT_PUBLIC_KEY using HS256, so both variables must carry the SAME secret —
 * an actual RSA key pair would make every issued token fail verification.
 * `bun run init` does the same thing (it writes the public key into both), and
 * this script matches it so a preview behaves like a normal local setup.
 */
import { randomBytes } from "node:crypto";

const { subtle } = globalThis.crypto;

const keyPair = await subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"]
);

const publicKey = Buffer.from(
  await subtle.exportKey("spki", keyPair.publicKey)
).toString("base64");

process.stdout.write(
  [
    `SECRETS_AES_KEY=${randomBytes(32).toString("hex")}`,
    `SECRETS_AES_IV=${randomBytes(16).toString("hex")}`,
    `JWT_PRIVATE_KEY=${publicKey}`,
    `JWT_PUBLIC_KEY=${publicKey}`,
    `OAUTH_INTROSPECTION_SECRET=${randomBytes(32).toString("hex")}`,
    "",
  ].join("\n")
);
