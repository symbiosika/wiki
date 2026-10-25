import { describe, test, expect } from "bun:test";
import {
  ARTIFACT_TOKEN_TTL_SECONDS,
  createArtifactToken,
  verifyArtifactToken,
} from "./token";

const VERSION = "0b0c5a8e-1111-4a2b-9c3d-123456789abc";
const NOW = 1_800_000_000;

describe("artifact content tokens", () => {
  test("a minted token names its version until it expires", () => {
    const token = createArtifactToken(VERSION, NOW);
    expect(verifyArtifactToken(token, NOW)).toBe(VERSION);
    expect(verifyArtifactToken(token, NOW + ARTIFACT_TOKEN_TTL_SECONDS)).toBe(VERSION);
    expect(verifyArtifactToken(token, NOW + ARTIFACT_TOKEN_TTL_SECONDS + 1)).toBeNull();
  });

  test("tampered or malformed tokens are rejected", () => {
    const token = createArtifactToken(VERSION, NOW);
    const [, exp, sig] = token.split(".");
    const otherVersion = "0b0c5a8e-2222-4a2b-9c3d-123456789abc";
    expect(verifyArtifactToken(`${otherVersion}.${exp}.${sig}`, NOW)).toBeNull();
    expect(verifyArtifactToken(`${VERSION}.${Number(exp) + 9999}.${sig}`, NOW)).toBeNull();
    expect(verifyArtifactToken(`${VERSION}.${exp}.${sig}x`, NOW)).toBeNull();
    expect(verifyArtifactToken("garbage", NOW)).toBeNull();
    expect(verifyArtifactToken(`not-a-uuid.${exp}.${sig}`, NOW)).toBeNull();
  });
});
