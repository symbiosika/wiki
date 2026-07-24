import type { EmailTemplateFunction } from "@framework/types";

/**
 * App-specific email templates for Symbiosika Wiki.
 *
 * These override the framework defaults (see the framework's
 * `store/email-templates.ts`) and are registered in `src/index.ts` via
 * `defineServer({ emailTemplates: { ... } })`.
 *
 * Design goals: keep every mail clean and simple – the app name as a centred
 * wordmark, one clear heading, a short line of text and a single prominent
 * button. No coloured background, no heavy card/header/footer chrome. Content
 * stays bilingual (German first, a compact English block below).
 */

// Email validation caps subjects at 100 characters – keep them short.
function truncateSubject(subject: string, maxLength: number = 100): string {
  if (subject.length <= maxLength) return subject;
  return subject.substring(0, maxLength - 3) + "...";
}

/** One language block: a heading, one or more paragraphs and an optional
 * muted note (e.g. "if you didn't request this, ignore it"). */
interface EmailSection {
  heading: string;
  paragraphs: string[];
  note?: string;
}

interface RenderEmailOptions {
  appName: string;
  /** @deprecated No longer rendered – the app name is shown as a text wordmark. */
  logoUrl?: string;
  /** @deprecated No longer used – kept for backwards compatibility with callers. */
  baseUrl?: string;
  /** Primary language block (rendered prominently). */
  de: EmailSection;
  /** Secondary language block (rendered smaller / muted below). */
  en: EmailSection;
  /** Optional call-to-action button. */
  button?: { link?: string; text: string };
  /** Optional one-time code (OTP) shown prominently near the top. */
  code?: string;
}

// A small, brand-neutral palette. The button is near-black like a clean
// transactional mail; text greys keep good contrast without a background.
const COLOR = {
  text: "#1a1a1a",
  muted: "#6b7280",
  hairline: "#eaeaea",
  button: "#111111",
  buttonText: "#ffffff",
};

function paragraphsHtml(paragraphs: string[], color: string, size: string) {
  return paragraphs
    .map(
      (p) =>
        `<p style="margin: 0 0 14px; color: ${color}; font-size: ${size}; line-height: 1.6;">${p}</p>`
    )
    .join("");
}

/**
 * Bulletproof, table-based email layout. Uses inline styles only (email
 * clients strip most <style> rules) and a max-width of 480px so it reads well
 * on phones and desktop alike.
 */
function renderEmail({
  appName,
  de,
  en,
  button,
  code,
}: RenderEmailOptions): string {
  // Show the app name as a text wordmark instead of an image logo.
  const logoHtml = appName
    ? `<p style="margin: 0 auto 28px; font-size: 22px; font-weight: 700; color: ${COLOR.text}; letter-spacing: -0.2px;">${appName}</p>`
    : "";

  const codeHtml = code
    ? `<p style="text-align: center; font-size: 34px; font-weight: 700; letter-spacing: 8px; color: ${COLOR.text}; margin: 8px 0 24px;">${code}</p>`
    : "";

  const buttonHtml =
    button && button.link
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px auto 28px;">
           <tr>
             <td align="center" bgcolor="${COLOR.button}" style="border-radius: 8px;">
               <a href="${button.link}" style="display: inline-block; padding: 14px 30px; font-size: 15px; font-weight: 600; color: ${COLOR.buttonText}; text-decoration: none; border-radius: 8px;">${button.text}</a>
             </td>
           </tr>
         </table>`
      : "";

  const deNote = de.note
    ? `<p style="margin: 0; color: ${COLOR.muted}; font-size: 13px; line-height: 1.6;">${de.note}</p>`
    : "";
  const enNote = en.note
    ? `<p style="margin: 0; color: ${COLOR.muted}; font-size: 12px; line-height: 1.6;">${en.note}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <title>${appName}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff;">
      <tr>
        <td align="center" style="padding: 40px 20px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 480px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, Helvetica, sans-serif; text-align: center;">
            <tr>
              <td style="padding: 8px 8px 0;">
                ${logoHtml}
                <h1 style="margin: 0 0 12px; font-size: 26px; font-weight: 700; color: ${COLOR.text}; line-height: 1.3;">${de.heading}</h1>
                ${codeHtml}
                ${paragraphsHtml(de.paragraphs, COLOR.muted, "15px")}
                ${buttonHtml}
                ${deNote}
                <hr style="border: none; border-top: 1px solid ${COLOR.hairline}; margin: 32px 0 24px;" />
                <p style="margin: 0 0 10px; font-size: 15px; font-weight: 700; color: ${COLOR.text};">${en.heading}</p>
                ${paragraphsHtml(en.paragraphs, COLOR.muted, "13px")}
                ${enNote}
                <p style="margin: 28px 0 0; font-size: 12px; color: ${COLOR.muted};">© ${appName}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export const magicLink: EmailTemplateFunction = async (data) => {
  const appName = data.appName;
  return {
    html: renderEmail({
      appName,
      logoUrl: data.logoUrl,
      baseUrl: data.baseUrl,
      de: {
        heading: `Bei ${appName} anmelden`,
        paragraphs: [
          "Klicken Sie auf den Button unten, um sich sicher anzumelden. Der Link ist 15 Minuten gültig.",
        ],
        note: "Falls Sie diese Anmeldung nicht angefordert haben, können Sie diese E-Mail ignorieren.",
      },
      en: {
        heading: `Sign in to ${appName}`,
        paragraphs: [
          "Click the button above to securely sign in. The link is valid for 15 minutes.",
        ],
        note: "If you didn't request this, you can safely ignore this email.",
      },
      button: { link: data.link, text: "Jetzt anmelden / Sign in" },
    }),
    subject: `Ihr Login-Link für ${appName} / Your login link`,
  };
};

export const emailLoginCode: EmailTemplateFunction = async (data) => {
  const appName = data.appName;
  return {
    html: renderEmail({
      appName,
      logoUrl: data.logoUrl,
      baseUrl: data.baseUrl,
      code: data.code ?? "",
      de: {
        heading: `Ihr Login-Code`,
        paragraphs: [
          "Verwenden Sie diesen Code, um die Anmeldung fortzusetzen. Er ist 10 Minuten gültig.",
        ],
        note: "Falls Sie diesen Code nicht angefordert haben, können Sie diese E-Mail ignorieren.",
      },
      en: {
        heading: "Your login code",
        paragraphs: [
          "Use this code to continue signing in. It is valid for 10 minutes.",
        ],
        note: "If you didn't request this, you can safely ignore this email.",
      },
    }),
    subject: `Ihr Login-Code für ${appName} / Your login code`,
  };
};

export const verifyEmail: EmailTemplateFunction = async (data) => {
  const appName = data.appName;
  return {
    html: renderEmail({
      appName,
      logoUrl: data.logoUrl,
      baseUrl: data.baseUrl,
      de: {
        heading: "E-Mail bestätigen",
        paragraphs: [
          "Klicken Sie auf den Button unten, um Ihre E-Mail-Adresse zu bestätigen. Der Link ist 15 Minuten gültig.",
        ],
        note: "Falls Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.",
      },
      en: {
        heading: "Verify your email",
        paragraphs: [
          "Click the button above to confirm your email address. The link is valid for 15 minutes.",
        ],
        note: "If you didn't request this, you can safely ignore this email.",
      },
      button: { link: data.link, text: "E-Mail bestätigen / Verify email" },
    }),
    subject: `E-Mail-Bestätigung für ${appName} / Verify your email`,
  };
};

export const resetPassword: EmailTemplateFunction = async (data) => {
  const appName = data.appName;
  return {
    html: renderEmail({
      appName,
      logoUrl: data.logoUrl,
      baseUrl: data.baseUrl,
      de: {
        heading: "Passwort zurücksetzen",
        paragraphs: [
          "Klicken Sie auf den Button unten, um ein neues Passwort zu setzen. Der Link ist 15 Minuten gültig.",
        ],
        note: "Falls Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.",
      },
      en: {
        heading: "Reset your password",
        paragraphs: [
          "Click the button above to set a new password. The link is valid for 15 minutes.",
        ],
        note: "If you didn't request this, you can safely ignore this email.",
      },
      button: { link: data.link, text: "Passwort zurücksetzen / Reset password" },
    }),
    subject: `Passwort zurücksetzen für ${appName} / Reset your password`,
  };
};

export const resetPasswordWelcome: EmailTemplateFunction = async (data) => {
  const appName = data.appName;
  return {
    html: renderEmail({
      appName,
      logoUrl: data.logoUrl,
      baseUrl: data.baseUrl,
      de: {
        heading: `Willkommen bei ${appName}`,
        paragraphs: [
          "Klicken Sie auf den Button unten, um Ihr Passwort zu setzen und loszulegen.",
        ],
      },
      en: {
        heading: `Welcome to ${appName}`,
        paragraphs: [
          "Click the button above to set your password and get started.",
        ],
      },
      button: { link: data.link, text: "Passwort setzen / Set password" },
    }),
    subject: `Willkommen bei ${appName} / Welcome`,
  };
};

export const inviteToOrganization: EmailTemplateFunction = async (data) => {
  const appName = data.appName;
  const orgName = data.tenant?.name;
  return {
    html: renderEmail({
      appName,
      logoUrl: data.logoUrl,
      baseUrl: data.baseUrl,
      de: {
        heading: orgName ? `Einladung zu ${orgName}` : `Einladung zu ${appName}`,
        paragraphs: [
          orgName
            ? `Sie wurden eingeladen, <strong>${orgName}</strong> auf ${appName} beizutreten. Klicken Sie auf den Button unten, um sich zu registrieren.`
            : `Sie wurden eingeladen, ${appName} beizutreten. Klicken Sie auf den Button unten, um sich zu registrieren.`,
        ],
      },
      en: {
        heading: orgName ? `Invitation to join ${orgName}` : `Invitation to join ${appName}`,
        paragraphs: [
          orgName
            ? `You've been invited to join <strong>${orgName}</strong> on ${appName}. Click the button above to register.`
            : `You've been invited to join ${appName}. Click the button above to register.`,
        ],
      },
      button: { link: data.link, text: "Jetzt registrieren / Register" },
    }),
    subject: truncateSubject(
      orgName
        ? `Einladung zu ${orgName} / Invitation to join ${orgName}`
        : `Einladung zu ${appName} / Invitation to join`
    ),
  };
};

export const inviteToOrganizationWhenUserExists: EmailTemplateFunction = async (
  data
) => {
  const appName = data.appName;
  const orgName = data.tenant?.name;
  return {
    html: renderEmail({
      appName,
      logoUrl: data.logoUrl,
      baseUrl: data.baseUrl,
      de: {
        heading: orgName ? `Einladung zu ${orgName}` : "Sie wurden eingeladen",
        paragraphs: [
          orgName
            ? `Sie wurden eingeladen, <strong>${orgName}</strong> auf ${appName} beizutreten. Klicken Sie auf den Button unten, um die Einladung anzunehmen. Der Link ist 7 Tage gültig.`
            : `Sie wurden zu einer Organisation auf ${appName} eingeladen. Klicken Sie auf den Button unten, um die Einladung anzunehmen. Der Link ist 7 Tage gültig.`,
        ],
        note: "Falls Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.",
      },
      en: {
        heading: orgName ? `Invitation to join ${orgName}` : "You've been invited",
        paragraphs: [
          orgName
            ? `You've been invited to join <strong>${orgName}</strong> on ${appName}. Click the button above to accept. The link is valid for 7 days.`
            : `You've been invited to join an organization on ${appName}. Click the button above to accept. The link is valid for 7 days.`,
        ],
        note: "If you didn't expect this invitation, you can safely ignore this email.",
      },
      button: { link: data.link, text: "Einladung annehmen / Accept invitation" },
    }),
    subject: truncateSubject(
      orgName
        ? `Einladung zu ${orgName} / Invitation to join ${orgName}`
        : `Einladung / Invitation to join an organization`
    ),
  };
};
