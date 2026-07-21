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

Workflow: get_wiki_overview ONCE at session start (metrics, areas, recent
changes, and the organisation's agent-instructions page — follow those
instructions). Then search_wiki (hybrid by default; narrow with parentId /
pageType / status), resolve_page when you know a title, and read with
get_page or get_pages (batch). Mind status facets: prefer "verified" content,
treat "outdated" and pages past validUntil with care.

Context economy: read only what you need. For long pages use get_page_outline
+ read_page_section instead of the whole page; bound get_page_subtree with
maxDepth/maxChars; get_pages loads several pages in one call; metadata is a
separate, explicit call (get_page_metadata). list_recent_changes answers
"what changed?" without opening pages.

Writing: append_to_page is the safe default for adding notes/log entries. For
edits inside a page, read first (read_page_content), then edit_page_content —
its oldString must match exactly and unambiguously. create_page defaults to a
private personal page; set teamId or organisation:true deliberately. Curate
with update_page facets (pageType/status from get_wiki_config, validUntil,
supersedesId). Confirm with the user before delete_page or before publishing
personal notes org-wide.
`.trim();
