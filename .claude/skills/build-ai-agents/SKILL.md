---
name: build-ai-agents
description: >
  Use when the user asks to create an AI agent, define AI tools, add a chat feature,
  or build an AI-powered endpoint. Use when editing files in backend/src/ai/.
  Use when the user mentions tool(), valibotSchema, ToolLoopAgent, streamText, or chat streaming.
---

# Building AI Agents

AI agents combine tools with a language model to handle user requests via streaming chat.

## File Structure

```
backend/src/ai/
├── index.ts                    # Exports STANDARD_AI_MODEL and all tools
└── tools/
    └── <domain>/
        └── index.ts            # Tools + agent factory for a domain
```

## Step 1: Standard AI Model

```typescript
// backend/src/ai/index.ts
import { mistral } from "@ai-sdk/mistral";

export const STANDARD_AI_MODEL = mistral('mistral-large-latest');

// Re-export all tool modules
export * from './tools/roadmap';
```

## Step 2: Define Tools

Tools wrap business logic functions from `src/lib/`. Never put DB operations in tools directly.

Each tool module exports:
1. A `create<Domain>Tools(tenantId)` function returning all tools
2. A `create<Domain>Agent(tenantId)` function returning the configured agent

```typescript
// backend/src/ai/tools/<domain>/index.ts
import { valibotSchema } from '@ai-sdk/valibot';
import * as v from 'valibot';
import { tool, ToolLoopAgent, stepCountIs } from 'ai';
import { STANDARD_AI_MODEL } from '../..';
import { createEntry, updateEntry, deleteEntry, getEntries } from '../../../lib/<domain>';

export async function create<Domain>Tools(tenantId: string) {

  // Optional: Load dynamic context for tool descriptions
  const availableTypes = await getTypes(tenantId);
  const typesDescription = availableTypes.length > 0
    ? `\n\nAvailable types:\n${availableTypes.map(t => `- ${t.name} (ID: ${t.id})`).join('\n')}`
    : '\n\nNo types available yet.';

  const createTool = tool({
    description: `Create a new entry.${typesDescription}`,
    inputSchema: valibotSchema(
      v.object({
        name: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(255),
          v.description('The name of the entry (required)')
        ),
        typeId: v.pipe(
          v.string(),
          v.description('The type/category ID (required)')
        ),
        description: v.optional(
          v.pipe(
            v.string(),
            v.description('Detailed description (optional)')
          )
        ),
      })
    ),
    execute: async ({ name, typeId, description }) => {
      try {
        const newEntry = await createEntry(tenantId, {
          name,
          typeId,
          description: description || null,
        });
        return { success: true, data: newEntry };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create entry',
        };
      }
    },
  });

  const listTool = tool({
    description: `List all entries.${typesDescription}`,
    inputSchema: valibotSchema(
      v.object({
        typeId: v.optional(
          v.pipe(v.string(), v.description('Filter by type ID'))
        ),
      })
    ),
    execute: async ({ typeId }) => {
      try {
        const entries = await getEntries(tenantId, typeId);
        return { success: true, data: entries, count: entries.length };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list entries',
        };
      }
    },
  });

  // ... more tools (update, delete, search)

  return {
    createEntry: createTool,
    listEntries: listTool,
  };
}
```

### Tool Rules

- **Always try/catch** in `execute`, return `{ success: true, data }` or `{ success: false, error }`
- **Use `v.description()`** on every field - the AI uses this to understand parameters
- **Tools call `src/lib/` functions** - never import DB or ORM directly in tools
- **TenantId via closure** - captured from `createTools(tenantId)`, not as a tool parameter
- **Dynamic context in descriptions** - load available options (types, categories) at tool creation time and include in description string
- **Optional fields use `v.optional()`** - update tools should make most fields optional

## Step 3: Create Agent

```typescript
function buildAgentInstructions(): string {
  return `You are an AI assistant specialized in managing entries.

Guidelines:
- When creating, ensure all required fields are provided
- When updating, only provide fields that need to be changed
- Always confirm successful operations to the user
- If an operation fails, explain the error clearly`;
}

export async function create<Domain>Agent(tenantId: string) {
  const tools = await create<Domain>Tools(tenantId);

  return new ToolLoopAgent({
    model: STANDARD_AI_MODEL,
    instructions: buildAgentInstructions(),
    tools,
    stopWhen: stepCountIs(10),
  });
}
```

### Agent Rules

- **`stopWhen: stepCountIs(10)`** - prevents infinite loops
- **Instructions as separate function** - keeps agent factory clean
- **Instructions describe the agent's role and guidelines** - not the tools (tools have their own descriptions)

## Step 4: Chat Route with Persistence

Routes are registered via `customHonoAppsWithAuth` (auth is automatic).

```typescript
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { convertToModelMessages, type UIMessage } from "ai";
import { create<Domain>Agent } from "../../../../ai/tools/<domain>";
import {
  getChatById, createChat, updateChatTitle, deleteChat,
  saveMessage, uiMessageToStorage, storageToUIMessage, generateTitleFromMessage,
} from "../../../../lib/chat";

export default function defineChatRoutes(app: SymbiosikaFrameworkHonoApp, API_BASE_PATH = "") {
  const baseRoute = `${API_BASE_PATH}/tenant/:tenantId/chat`;
  const chatsRoute = `${API_BASE_PATH}/tenant/:tenantId/chats`;

  // GET /chats - List all chats for user
  // POST /chats - Create new chat
  // GET /chats/:chatId - Get chat with messages
  // PATCH /chats/:chatId - Update title
  // DELETE /chats/:chatId - Delete chat

  // POST /chat - Stream chat messages
  app.post(
    baseRoute,
    validator("param", v.object({ tenantId: v.string() })),
    async (c) => {
      try {
        const { messages, chatId }: { messages: UIMessage[]; chatId: string } =
          await c.req.json();
        const { tenantId } = c.req.valid("param");
        const userId = c.get("usersId");

        if (!chatId) {
          throw new HTTPException(400, { message: "chatId is required" });
        }

        // Verify chat belongs to user
        const existingChat = await getChatById(chatId, tenantId, userId);
        if (!existingChat) {
          throw new HTTPException(404, { message: "Chat not found" });
        }

        // Save user message
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === "user") {
          const storageMsg = uiMessageToStorage(lastMessage);
          await saveMessage(chatId, {
            role: storageMsg.role,
            content: storageMsg.content || undefined,
            parts: storageMsg.parts,
          });

          // Auto-generate title from first message
          if (existingChat.messages.length === 0) {
            const textPart = lastMessage.parts?.find((p: any) => p.type === "text");
            if (textPart && "text" in textPart) {
              const title = generateTitleFromMessage(textPart.text);
              await updateChatTitle(chatId, tenantId, userId, title);
            }
          }
        }

        // Create agent and stream
        const agent = await create<Domain>Agent(tenantId);
        const result = await agent.stream({
          messages: await convertToModelMessages(messages),
        });

        // Save assistant response non-blocking
        (async () => {
          try {
            await result.consumeStream();
            const text = await result.text;
            if (text) {
              await saveMessage(chatId, {
                role: "assistant",
                content: text,
                parts: [{ type: "text", text }],
              });
            }
          } catch (error) {
            console.error("[Chat] Error saving assistant message:", error);
          }
        })();

        return result.toUIMessageStreamResponse();
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        throw new HTTPException(500, {
          message: `Failed to stream chat: ${(error as Error).message}`,
        });
      }
    }
  );
}
```

### Chat Route Rules

- **Messages as `UIMessage[]`** from AI SDK, convert with `convertToModelMessages()`
- **`chatId` required** - chats are persisted, no anonymous streaming
- **Verify ownership** - always check chat belongs to user via `getChatById()`
- **Save user message before streaming** - persist before agent runs
- **Auto-generate title** from first user message using `generateTitleFromMessage()`
- **Save assistant response non-blocking** - use IIFE with `consumeStream()` + `result.text`
- **Return `result.toUIMessageStreamResponse()`** for SSE streaming

## Step 5: Chat Frontend (Vue)

```typescript
import { Chat } from '@ai-sdk/vue';
import { DefaultChatTransport } from 'ai';

const userStore = useUser();
const tenantId = computed(() => userStore.state.selectedTenant);

const chatApiUrl = computed(() => `/api/v1/tenant/${tenantId.value}/chat`);

const chat = ref<any>(null);

const initializeChat = () => {
  if (tenantId.value) {
    chat.value = new Chat({
      transport: new DefaultChatTransport({ api: chatApiUrl.value }),
    });
  }
};

// Send message
chat.value.sendMessage({ text: input.value.trim() });

// Reactive state
const messages = computed(() => chat.value?.state?.messagesRef || []);
const isStreaming = computed(() => chat.value?.state?.statusRef === 'streaming');
```

## Checklist for New Agent

1. Create business logic in `src/lib/<domain>/` (CRUD functions)
2. Create tools in `src/ai/tools/<domain>/index.ts`
3. Export from `src/ai/index.ts`
4. Create chat route in `src/routes/tenant/[tenantId]/chat/`
5. Register route in `src/index.ts` via `customHonoAppsWithAuth`
6. Create frontend chat component using `@ai-sdk/vue`
