/**
 * "Notify members by email" — tell the people who can see a wiki page about it.
 *
 * Who gets the mail follows the page's scope, the same rule that decides who
 * may READ the page (buildKnowledgeTextVisibilityConditions):
 *
 *   - team page (`teamId` set)         → every member of that team
 *   - organisation page (`tenantWide`) → every member of the organisation
 *   - personal page (owner only)       → the owner alone — pointless in daily
 *                                        use, but handy to try a mail out
 *
 * Sending needs WRITE access to the page: reading a page is not enough to
 * mail the whole organisation about it.
 *
 * The author edits the message in the frontend dialog; the mail always ends
 * with a button linking to the page, so the text can never "forget" the link.
 * Every recipient gets a mail of their own (one `to:` each), so addresses are
 * not disclosed to each other, and sending happens in the background — the
 * SMTP service retries for minutes and must not hold the request.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import {
  teamMembers,
  teams,
  tenantMembers,
  users,
} from "@framework/lib/db/db-schema";
import {
  checkKnowledgeTextWritePermission,
  getKnowledgeTextById,
} from "@framework/lib/knowledge/knowledge-texts";
import { smtpService } from "@framework/lib/email";
import { _GLOBAL_SERVER_CONFIG } from "@framework/store";
import { renderEmail, truncateSubject } from "../email-templates";
import { wikiPageUrl } from "./page-url";

export type PageNotificationScope = "team" | "organisation" | "personal";

export interface PageNotificationAudience {
  scope: PageNotificationScope;
  /** name of the page's team (team pages only) */
  teamName: string | null;
  /** number of distinct addresses the mail goes to */
  recipientCount: number;
  /** whether the current user may send (write access to the page) */
  canNotify: boolean;
}

export interface PageNotificationInput {
  /** the mail's subject; empty = a default naming the page */
  subject?: string | null;
  /** the text the author wrote; blank lines separate paragraphs */
  message: string;
}

export interface PageNotificationResult {
  scope: PageNotificationScope;
  recipientCount: number;
}

interface Context {
  tenantId: string;
  userId: string;
}

/** A refusal with the HTTP status the route answers with. */
export class PageNotificationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403
  ) {
    super(message);
  }
}

export const MAX_NOTIFICATION_MESSAGE_LENGTH = 5000;
export const MAX_NOTIFICATION_SUBJECT_LENGTH = 100;

type Page = Awaited<ReturnType<typeof getKnowledgeTextById>>;

const scopeOf = (page: Page): PageNotificationScope =>
  page.teamId ? "team" : page.tenantWide ? "organisation" : "personal";

/** Distinct, valid-looking e-mail addresses of everyone the scope reaches. */
const recipientsOf = async (page: Page): Promise<string[]> => {
  const db = getDb();
  let rows: { email: string | null }[];
  if (page.teamId) {
    rows = await db
      .select({ email: users.email })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, page.teamId));
  } else if (page.tenantWide) {
    rows = await db
      .select({ email: users.email })
      .from(tenantMembers)
      .innerJoin(users, eq(tenantMembers.userId, users.id))
      .where(eq(tenantMembers.tenantId, page.tenantId));
  } else if (page.userId) {
    rows = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, page.userId));
  } else {
    rows = [];
  }
  const seen = new Set<string>();
  for (const { email } of rows) {
    const address = email?.trim().toLowerCase();
    if (address && address.includes("@")) seen.add(address);
  }
  return [...seen].sort();
};

const teamNameOf = async (page: Page): Promise<string | null> => {
  if (!page.teamId) return null;
  const [team] = await getDb()
    .select({ name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, page.teamId), eq(teams.tenantId, page.tenantId)));
  return team?.name ?? null;
};

const canWrite = async (page: Page, ctx: Context): Promise<boolean> => {
  try {
    await checkKnowledgeTextWritePermission(page, ctx);
    return true;
  } catch {
    return false;
  }
};

/** Who a notification about this page would reach — for the dialog. */
export const getPageNotificationAudience = async (
  pageId: string,
  ctx: Context
): Promise<PageNotificationAudience> => {
  const page = await getKnowledgeTextById(pageId, ctx);
  const [recipients, teamName, canNotify] = await Promise.all([
    recipientsOf(page),
    teamNameOf(page),
    canWrite(page, ctx),
  ]);
  return {
    scope: scopeOf(page),
    teamName,
    recipientCount: recipients.length,
    canNotify,
  };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** The author's text as html paragraphs: blank lines split, newlines break. */
export const messageParagraphs = (message: string): string[] =>
  message
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => escapeHtml(paragraph).replace(/\n/g, "<br />"));

const senderNameOf = async (userId: string): Promise<string> => {
  const [user] = await getDb()
    .select({
      firstname: users.firstname,
      surname: users.surname,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId));
  const name = [user?.firstname, user?.surname]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || user?.email || "";
};

/** Subject, html and text of the mail — pure, so it can be tested on its own. */
export const buildPageNotificationEmail = (options: {
  appName: string;
  pageTitle: string;
  pageUrl: string;
  senderName: string;
  subject?: string | null;
  message: string;
}): { subject: string; html: string; text: string } => {
  const title = options.pageTitle.trim() || "Wiki";
  const subject = truncateSubject(
    options.subject?.trim() || `Neue Wiki-Seite: ${title}`
  );
  const sender = escapeHtml(options.senderName);
  const html = renderEmail({
    appName: escapeHtml(options.appName),
    de: {
      heading: escapeHtml(title),
      paragraphs: messageParagraphs(options.message),
      note: sender
        ? `${sender} hat dich über diese Seite benachrichtigt.`
        : undefined,
    },
    en: {
      heading: "A wiki page for you",
      paragraphs: [
        `${sender || "Someone"} wants you to see the page “${escapeHtml(title)}”.`,
      ],
    },
    button: { link: options.pageUrl, text: "Seite öffnen / Open page" },
  });
  const text = [
    options.message.trim(),
    "",
    `${title}: ${options.pageUrl}`,
    ...(options.senderName
      ? ["", `${options.senderName} hat dich über diese Seite benachrichtigt.`]
      : []),
  ].join("\n");
  return { subject, html, text };
};

/** Send the mail to everyone the page's scope reaches. */
export const notifyPageMembers = async (
  pageId: string,
  input: PageNotificationInput,
  ctx: Context
): Promise<PageNotificationResult> => {
  const message = input.message.trim();
  if (!message) {
    throw new PageNotificationError("The message must not be empty", 400);
  }
  if (message.length > MAX_NOTIFICATION_MESSAGE_LENGTH) {
    throw new PageNotificationError("The message is too long", 400);
  }

  const page = await getKnowledgeTextById(pageId, ctx);
  if (!(await canWrite(page, ctx))) {
    throw new PageNotificationError(
      "Only people who can edit this page may notify its members",
      403
    );
  }

  const recipients = await recipientsOf(page);
  const mail = buildPageNotificationEmail({
    appName: _GLOBAL_SERVER_CONFIG.appName,
    pageTitle: page.title ?? "",
    pageUrl: wikiPageUrl(page.tenantId, page.id),
    senderName: await senderNameOf(ctx.userId),
    subject: input.subject,
    message,
  });
  for (const recipient of recipients) {
    smtpService.sendMailInBackground({ recipients: [recipient], ...mail });
  }
  return { scope: scopeOf(page), recipientCount: recipients.length };
};
