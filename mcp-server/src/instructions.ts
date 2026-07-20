/**
 * Server-level MCP instructions.
 *
 * The MCP spec lets a server ship an `instructions` string that the host
 * (the MCP client / chat app) keeps in context whenever the server is
 * connected. This is the always-on, server-side counterpart to the (opt-in)
 * Agent Skill in `skill/SKILL.md`: it makes the assistant reach for the wiki on
 * company questions even when no skill is loaded. Keep it short and
 * behavioural; the per-tool descriptions carry the mechanics.
 */
export const SERVER_INSTRUCTIONS = `
Company Wiki — the company's source of truth for internal knowledge
(processes, products, decisions, people, policies, handbook, onboarding). All
tools act with the signed-in user's own permissions; a 403 means "not allowed",
not "does not exist".

When to use this server:
- For any COMPANY / INTERNAL question ("how do we do X", "where is the doc for…",
  onboarding, guidelines, specs, decisions), consult the wiki BEFORE answering
  from general knowledge or the web.
- Ground company-specific claims in wiki content and cite the source page
  (title + id). If nothing is found, say so plainly and offer to create a page —
  do not invent facts.
- Proactively help the wiki grow: when durable knowledge appears (a decision,
  process, or reusable answer), offer to capture it.

Workflow: whoami (once) → search_wiki with mode "hybrid" (fall back to
"fulltext" only if empty / embeddings unavailable), or get_wiki_tree for
structure → read with get_page / get_page_subtree → answer with the source
page(s) cited. Use get_page_backlinks / get_related_pages to gather context.

Writing: always read a page (read_page_content) before edit_page_content — its
oldString must match exactly and unambiguously. create_page defaults to a
private personal page; set teamId or organisation:true deliberately. Confirm
with the user before delete_page or before publishing personal notes org-wide.
`.trim();
