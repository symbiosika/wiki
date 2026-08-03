/**
 * Public Microsoft 365 login routes.
 *
 *   GET /auth/microsoft/login     start the flow (redirects to Microsoft)
 *   GET /auth/microsoft/callback  finish it (sets the auth cookies)
 *
 * Deliberately unauthenticated — this *is* a login. The heavy lifting (PKCE,
 * token exchange, Graph lookup, session creation) lives in
 * ../../../lib/auth/microsoft-oauth.ts; this file only wires it to Hono,
 * carries the pending transaction in an HttpOnly cookie and reports failures
 * back to the static login page.
 *
 * Both routes sit next to the framework's own `/user/auth/:provider` endpoints
 * rather than replacing them; see the module doc of the lib for why the
 * framework flow cannot be used as-is.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import { setAuthCookies } from "@framework/lib/auth/auth-cookies";
import log from "@framework/lib/log";
import { describeRoute } from "hono-openapi";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  DEFAULT_LOGIN_REDIRECT,
  MICROSOFT_TX_COOKIE,
  MICROSOFT_TX_TTL_SECONDS,
  buildMicrosoftAuthorizeUrl,
  createCodeChallenge,
  createRandomToken,
  decodeTransaction,
  encodeTransaction,
  exchangeMicrosoftCode,
  fetchMicrosoftProfile,
  isMicrosoftLoginEnabled,
  isSameState,
  sanitizeRedirect,
  signInWithMicrosoftProfile,
} from "../../../lib/auth/microsoft-oauth";

/**
 * Error codes appended to the login page URL. The page turns them into a
 * German message (see public/login.html) — no server-side detail leaks.
 */
export type MicrosoftLoginError =
  | "microsoft_unavailable"
  | "microsoft_cancelled"
  | "microsoft_failed";

const loginPageWithError = (error: MicrosoftLoginError) =>
  `${_GLOBAL_SERVER_CONFIG.loginUrl}?error=${error}`;

const isSecureContext = () =>
  _GLOBAL_SERVER_CONFIG.baseUrl.startsWith("https://");

export default function defineMicrosoftLoginRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = ""
) {
  /**
   * Step 1: start the login. Creates the state/PKCE transaction, stores it in
   * a short-lived HttpOnly cookie and sends the browser to Microsoft.
   */
  app.get(
    `${API_BASE_PATH}/auth/microsoft/login`,
    describeRoute({
      tags: ["user"],
      summary: "Start the Microsoft 365 login",
      responses: {
        302: { description: "Redirect to Microsoft (or back to the login)" },
      },
    }),
    async (c) => {
      if (!isMicrosoftLoginEnabled()) {
        // Not configured on this instance: no button should have been shown,
        // so this is either a stale page or a hand-crafted URL.
        return c.redirect(loginPageWithError("microsoft_unavailable"));
      }

      const state = createRandomToken();
      const verifier = createRandomToken();
      const redirect = sanitizeRedirect(c.req.query("redirectUrl"));

      setCookie(
        c,
        MICROSOFT_TX_COOKIE,
        encodeTransaction({ state, verifier, redirect }),
        {
          httpOnly: true,
          secure: isSecureContext(),
          // Lax, not Strict: the user returns through a top-level navigation
          // initiated by login.microsoftonline.com.
          sameSite: "Lax",
          path: "/",
          maxAge: MICROSOFT_TX_TTL_SECONDS,
        }
      );

      return c.redirect(
        buildMicrosoftAuthorizeUrl({
          state,
          codeChallenge: createCodeChallenge(verifier),
        })
      );
    }
  );

  /**
   * Step 2: Microsoft redirects back here with `code` + `state`. On success the
   * user ends up signed in with the same cookie pair every other login sets.
   */
  app.get(
    `${API_BASE_PATH}/auth/microsoft/callback`,
    describeRoute({
      tags: ["user"],
      summary: "Finish the Microsoft 365 login",
      responses: {
        302: { description: "Redirect into the app (or back to the login)" },
      },
    }),
    async (c) => {
      const transaction = decodeTransaction(getCookie(c, MICROSOFT_TX_COOKIE));
      // One-shot: the transaction must never be replayable, not even after a
      // failure further down.
      deleteCookie(c, MICROSOFT_TX_COOKIE, {
        path: "/",
        secure: isSecureContext(),
        sameSite: "Lax",
      });

      if (!isMicrosoftLoginEnabled()) {
        return c.redirect(loginPageWithError("microsoft_unavailable"));
      }

      // The user declined the consent screen or Microsoft rejected the request.
      const oauthError = c.req.query("error");
      if (oauthError) {
        log.info(
          `Microsoft login aborted: ${oauthError} ${
            c.req.query("error_description") ?? ""
          }`
        );
        return c.redirect(
          loginPageWithError(
            oauthError === "access_denied"
              ? "microsoft_cancelled"
              : "microsoft_failed"
          )
        );
      }

      const code = c.req.query("code");
      const state = c.req.query("state");

      if (!transaction || !code || !state || !isSameState(transaction.state, state)) {
        // Missing/expired cookie or a state mismatch (CSRF, or the flow was
        // started in a different browser).
        log.info("Microsoft login callback with invalid state or transaction");
        return c.redirect(loginPageWithError("microsoft_failed"));
      }

      try {
        const accessToken = await exchangeMicrosoftCode(
          code,
          transaction.verifier
        );
        const profile = await fetchMicrosoftProfile(accessToken);
        const { token } = await signInWithMicrosoftProfile(profile);

        setAuthCookies(c, token);

        return c.redirect(transaction.redirect || DEFAULT_LOGIN_REDIRECT);
      } catch (err) {
        // Includes the "Invitation code needed" case: registration is closed
        // on this instance and the address has no pending invitation.
        log.error(`Microsoft login failed: ${err}`);
        return c.redirect(loginPageWithError("microsoft_failed"));
      }
    }
  );
}
