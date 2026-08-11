/**
 * Microsoft Teams SSO routes.
 *
 *   POST /auth/teams/exchange              Entra ID token → framework session
 *   POST /auth/teams/complete-registration  same, with an invitation code
 *
 * Unauthenticated by design: these routes *establish* the session. What
 * authorises the caller is the Entra token, validated in `lib/teams-sso`.
 *
 * Why a second pair of routes next to the browser login: the Teams tab has no
 * usable session cookie. In the tab our page runs cross-site under
 * teams.microsoft.com, where a `SameSite=Lax` cookie is never sent — and on
 * iPadOS a cross-site cookie is not an option at all. So the session token is
 * returned in the response body and the embedded SPA sends it as
 * `Authorization: Bearer`, which the framework's auth middleware already
 * accepts. Nothing is written to a cookie here.
 *
 * Everything behind the token validation is the framework's social-login chain:
 * account lookup by `oid` (falling back to the verified address, which links a
 * magic-link account), the invitation-code gate, registration with tenant
 * joining. A Teams user and a browser user with the same Microsoft identity are
 * the same account.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import jwt from "jsonwebtoken";
import { eq, or } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { users } from "@framework/lib/db/db-schema";
import {
  completePendingOAuthRegistration,
  createPendingRegistrationToken,
  type OAuthProfile,
} from "@framework/lib/auth/oauth2";
import {
  checkIfInvitationCodeIsNeededToRegister,
  getPendingInvitationsForEmail,
} from "@framework/lib/usermanagement/invitations";
import { normalizeEmail } from "@framework/lib/utils/email";
import log from "@framework/lib/log";
import { isTeamsSsoActive, verifyTeamsSsoToken } from "../../../lib/teams-sso";

/**
 * Where the SPA is sent after the account exists. Carried inside the pending
 * registration so the second attempt lands in the same place; the Teams client
 * ignores it, but the value is part of the framework's token shape.
 */
const TEAMS_REDIRECT = "/static/app/?host=teams";

const authenticatedResponse = v.object({
  status: v.literal("authenticated"),
  token: v.string(),
  expiresAt: v.string(),
  user: v.object({
    id: v.string(),
    email: v.string(),
    firstname: v.string(),
    surname: v.string(),
  }),
});

const invitationCodeRequiredResponse = v.object({
  status: v.literal("invitation_code_required"),
  pendingRegistrationToken: v.string(),
  email: v.string(),
});

/* ── Brute-force budget for invitation codes ──────────────────────────────
 *
 * A valid Teams token proves who someone is, not that they may use this
 * instance. On a gated instance the invitation code is the only thing between a
 * verified stranger and an account, and codes are short enough to guess if
 * guessing is free.
 *
 * Counted per pending registration, i.e. per sign-up attempt: that is the unit a
 * guesser has to work with, and it gives every real user their own budget
 * instead of one shared pool. Where a client IP is visible (behind a proxy that
 * forwards it) a wider per-IP budget is spent as well, so minting fresh pending
 * registrations does not reset the clock indefinitely. Without such a header
 * every caller looks identical, so the IP budget is skipped rather than applied
 * to everyone at once.
 *
 * In-memory on purpose: the app runs as a single process per deployment, and a
 * limiter that needs shared state would make Redis mandatory. Entries are
 * dropped as they expire, so the map cannot grow without bound.
 */
const CODE_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const CODE_ATTEMPT_LIMIT_PER_REGISTRATION = 10;
const CODE_ATTEMPT_LIMIT_PER_IP = 30;

const codeAttempts = new Map<string, { count: number; resetAt: number }>();

const clientIp = (c: {
  req: { header: (name: string) => string | undefined };
}): string | undefined =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
  c.req.header("x-real-ip") ||
  undefined;

/** Bookkeeping key for a token; the token itself never goes into the map. */
const registrationKey = (token: string): string =>
  `reg:${Bun.hash(token).toString(36)}`;

const spend = (key: string, limit: number): boolean => {
  const now = Date.now();

  for (const [entryKey, entry] of codeAttempts) {
    if (entry.resetAt <= now) codeAttempts.delete(entryKey);
  }

  const current = codeAttempts.get(key);
  if (!current || current.resetAt <= now) {
    codeAttempts.set(key, { count: 1, resetAt: now + CODE_ATTEMPT_WINDOW_MS });
    return true;
  }

  current.count += 1;
  return current.count <= limit;
};

const spendCodeAttempt = (
  pendingRegistrationToken: string,
  ip: string | undefined
): boolean => {
  // Both budgets are spent, not short-circuited: a caller who exhausted one
  // must not be able to keep the other one full by hammering the first.
  const perRegistration = spend(
    registrationKey(pendingRegistrationToken),
    CODE_ATTEMPT_LIMIT_PER_REGISTRATION
  );
  const perIp = ip ? spend(`ip:${ip}`, CODE_ATTEMPT_LIMIT_PER_IP) : true;

  return perRegistration && perIp;
};

/** Only needed by tests, which must not inherit a spent budget. */
export const _resetTeamsCodeAttempts = (): void => {
  codeAttempts.clear();
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Does an account for this identity already exist?
 *
 * Mirrors the framework's resolution order (subject id first, then the verified
 * address) and is used only to decide whether an invitation code has to be
 * asked for. The account itself is always resolved by the framework, so a race
 * between two tabs cannot produce two accounts.
 */
const accountExists = async (profile: OAuthProfile): Promise<boolean> => {
  const email = normalizeEmail(profile.email);
  const found = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.extUserId, profile.id), eq(users.email, email)))
    .limit(1);

  return found.length > 0;
};

/**
 * Same rule as the browser login: a pending organisation invitation authorises
 * the sign-up on its own, otherwise a general invitation code is required when
 * the instance has any active.
 */
const needsInvitationCode = async (email: string): Promise<boolean> => {
  const { invitedInTenantIds } = await getPendingInvitationsForEmail(email);
  if (invitedInTenantIds.length > 0) return false;
  return await checkIfInvitationCodeIsNeededToRegister();
};

/** Turn a verified profile into a session, honouring the invitation gate. */
const signIn = async (
  profile: OAuthProfile,
  invitationCode: string | undefined,
  pendingRegistrationToken?: string
) => {
  // The framework does the work behind one entry point: it re-resolves the
  // account, checks the gate again and registers if needed. Passing our own
  // freshly minted pending-registration token keeps that single path for both
  // the first attempt and the retry with a code.
  const token =
    pendingRegistrationToken ??
    createPendingRegistrationToken({ profile, redirect: TEAMS_REDIRECT });

  return await completePendingOAuthRegistration(token, invitationCode);
};

const sessionPayload = (result: {
  token: string;
  expiresAt: Date;
  user: { id: string; email: string; firstname: string; surname: string };
}) => ({
  status: "authenticated" as const,
  token: result.token,
  expiresAt: result.expiresAt.toISOString(),
  user: {
    id: result.user.id,
    email: result.user.email,
    firstname: result.user.firstname,
    surname: result.user.surname,
  },
});

/* ── Routes ──────────────────────────────────────────────────────────────── */

export default function defineTeamsAuthRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = ""
) {
  /**
   * Exchange the Entra ID token the Teams host handed the tab for a session.
   *
   * Three outcomes, all of them final for this request:
   *  - the identity maps to an account (or may create one) → session token
   *  - the instance is gated and the address is unknown → the verified identity
   *    comes back as a pending registration, so the tab can ask for a code
   *    without repeating the Teams round-trip
   *  - anything else → 401, no session
   */
  app.post(
    `${API_BASE_PATH}/auth/teams/exchange`,
    describeRoute({
      tags: ["user"],
      summary: "Exchange a Microsoft Teams SSO token for a session",
      responses: {
        200: {
          description: "Session, or a request for an invitation code",
          content: {
            "application/json": {
              schema: resolver(
                v.union([authenticatedResponse, invitationCodeRequiredResponse])
              ),
            },
          },
        },
        401: { description: "The Teams token was not accepted" },
        503: { description: "Teams SSO is not configured on this server" },
      },
    }),
    validator("json", v.object({ teamsToken: v.string() })),
    async (c) => {
      if (!isTeamsSsoActive()) {
        throw new HTTPException(503, { message: "Teams SSO is not configured" });
      }

      let profile: OAuthProfile;
      try {
        profile = await verifyTeamsSsoToken(c.req.valid("json").teamsToken);
      } catch (err) {
        // Deliberately terse to the client: which check failed is useful to an
        // attacker and useless to a user. The reason goes to the log.
        log.info(
          `Teams SSO exchange rejected: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        throw new HTTPException(401, { message: "Teams sign-in failed" });
      }

      const email = normalizeEmail(profile.email);

      if (!(await accountExists(profile)) && (await needsInvitationCode(email))) {
        log.info(
          `Teams SSO by unknown address ${email}: invitation code required before an account is created`
        );
        return c.json({
          status: "invitation_code_required" as const,
          pendingRegistrationToken: createPendingRegistrationToken({
            profile,
            redirect: TEAMS_REDIRECT,
          }),
          email,
        });
      }

      try {
        return c.json(sessionPayload(await signIn(profile, undefined)));
      } catch (err) {
        log.error(`Teams SSO sign-in failed for ${email}: ${err}`);
        throw new HTTPException(401, { message: "Teams sign-in failed" });
      }
    }
  );

  /**
   * Second attempt: the user has produced an invitation code.
   *
   * The identity comes from the pending-registration token, never from the
   * request body — the client must not be able to name the account it gets. The
   * token is signed by this server, expires after 15 minutes and carries no
   * privileges of its own; it travels in the body because the Teams tab has no
   * usable cookie.
   */
  app.post(
    `${API_BASE_PATH}/auth/teams/complete-registration`,
    describeRoute({
      tags: ["user"],
      summary: "Finish a Teams sign-up with an invitation code",
      responses: {
        200: {
          description: "Successful response",
          content: {
            "application/json": { schema: resolver(authenticatedResponse) },
          },
        },
        400: { description: "Missing or unknown invitation code" },
        401: { description: "No valid pending registration" },
        429: { description: "Too many invitation-code attempts" },
      },
    }),
    validator(
      "json",
      v.object({
        pendingRegistrationToken: v.string(),
        invitationCode: v.optional(v.string()),
      })
    ),
    async (c) => {
      if (!isTeamsSsoActive()) {
        throw new HTTPException(503, { message: "Teams SSO is not configured" });
      }

      const { pendingRegistrationToken, invitationCode } = c.req.valid("json");

      if (!spendCodeAttempt(pendingRegistrationToken, clientIp(c))) {
        log.info("Teams SSO invitation-code attempts exhausted");
        throw new HTTPException(429, {
          message: "Too many attempts, please try again later",
        });
      }

      try {
        const result = await completePendingOAuthRegistration(
          pendingRegistrationToken,
          invitationCode
        );
        return c.json(sessionPayload(result));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Two very different failures arrive here and the client has to tell
        // them apart: a wrong invitation code is worth retrying in place (400),
        // while a token that is forged, expired or malformed means the Teams
        // round-trip has to start over (401).
        //
        // The token cases surface as `jsonwebtoken` errors ("invalid token",
        // "jwt expired", "invalid signature") plus the framework's own shape
        // check, so both are matched — a `JsonWebTokenError` covers the expired
        // and not-before subclasses too.
        if (
          err instanceof jwt.JsonWebTokenError ||
          message.toLowerCase().includes("pending registration")
        ) {
          log.info(`Teams sign-up with an unusable pending registration: ${message}`);
          throw new HTTPException(401, { message: "Please sign in again" });
        }
        log.info(`Teams sign-up rejected: ${message}`);
        throw new HTTPException(400, { message });
      }
    }
  );
}
