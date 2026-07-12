---
name: backend-framework
description: >
  Use when editing or creating files in backend/framework/.
  Use when the user asks about the framework architecture, available services, defineServer(),
  customHonoApps, customHonoAppsWithAuth, authentication middleware, or the multi-tenant API structure.
  Use when the user asks "how does X work" about core features like auth, AI, plugins, jobs, or files.
---

# symbiosika-framework

TypeScript backend framework on Hono + Bun runtime. Multi-tenant, AI-powered.

## Architecture

### defineServer() Configuration

```typescript
defineServer({
  // Server
  port: number,
  appName: string,
  basePath: string,           // e.g. "/api/v1"
  baseUrl: string,            // e.g. "http://localhost:3100"
  allowedOrigins: string[],

  // Auth
  authType: "local" | "auth0" | "hanko",
  jwtExpiresAfter: string,    // e.g. "30d"
  loginUrl: string,
  magicLoginVerifyUrl: string,
  verifyEmailUrl: string,
  resetPasswordUrl: string,
  oauthCallbackUrl: string,

  // Custom routes
  customHonoApps: [{          // Public (no auth)
    baseRoute: string,
    app: (app: SymbiosikaFrameworkHonoApp) => void,
  }],
  customHonoAppsWithAuth: [{  // Protected (auth middleware applied)
    baseRoute: string,
    app: (app: SymbiosikaFrameworkHonoApp) => void,
  }],

  // Database
  customDbSchema: Record<string, any>,
  customCollectionPermissions: PermissionDefinitionPerTable,

  // Hooks
  customPreRegisterCustomVerifications: [(email, meta) => Promise<void>],
  customPostRegisterActions: [(userId, email) => Promise<void>],

  // Features
  jobHandlers: JobHandlerRegister[],
  customCronJobs: CronJob[],
  emailTemplates: Record<string, EmailTemplateFunction>,
  useStripe: boolean,
  useConsoleLogger: boolean,
  useLicenseSystem: boolean,
  useWhatsApp: boolean,
  whatsAppIncomingWebhookHandler: handler,
  customEnvVariablesToCheckOnStartup: string[],

  // Static files
  staticPublicDataPath: string,
  staticPrivateDataPath: string,
})
```

### Initialization Order

1. Set global config, validate env vars
2. Initialize DB schema (merge custom + framework schemas)
3. Create database client, register cron jobs
4. Create Hono app with context variables
5. Register pre/post-register hooks
6. Add CORS middleware
7. After DB: license check, Redis cache, server keys
8. Register framework routes (admin, user, tenant, files, secrets, webhooks, knowledge, WhatsApp, docs)
9. Register custom routes (public + protected)
10. Serve static files, start job queue

### Key Types

```typescript
// Context variables set by auth middleware
type SFContextVariables = {
  usersId: string;
  usersEmail: string;
  usersRoles: string[];
  scopes: string[];
};

type SymbiosikaFrameworkHonoApp = Hono<{ Variables: SFContextVariables }>;
```

### Exports from Framework

```typescript
import { defineServer } from "@framework/index";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { HTTPException } from "hono/http-exception";
import { getDb } from "@framework/lib/db/db-connection";
import { smtpService } from "@framework/lib/email";
import { log } from "@framework/index";
```

## Middleware

### authAndSetUsersInfo
- Reads token from: `?token=`, `X-API-KEY`, `Authorization: Bearer`, or `jwt` cookie
- Validates JWT using `JWT_PUBLIC_KEY`
- Caches tokens in Redis (1h TTL), falls back to in-memory
- Sets context: `usersId`, `usersEmail`, `scopes`
- Throws `HTTPException(401)` on failure

### Tenant Middleware (from routes)
- `isTenantMember` - Checks user is member of tenant
- `isTenantAdmin` - Checks user has admin/owner role
- `checkTenantIdInBody` - Validates body tenantId matches URL param

### Scope Validation
```typescript
import { validateScope } from "@framework/lib/auth/available-scopes";
app.post("/route", authAndSetUsersInfo, validateScope("tenants:write"), ...);
```

Available scopes: `"user:read"`, `"tenants:write"`, `"knowledge:read"`, `"files:write"`, `"all"`, etc.

## Authentication

### Local Auth
- `authorize(email, password)` - Login
- `register(email, password, sendVerificationEmail, meta)` - Register with hooks
- `login(email, password)` - Creates session + JWT
- `sendMagicLink(email, redirectUrl, createUserIfMissing, invitationCode)` - Magic link
- `verifyEmail(token)` - Email verification
- `setNewPassword(userId, newPassword)` - Password reset
- `refreshToken(userId)` - Refresh JWT

### JWT
- Generated with `jsonwebtoken` using `JWT_PRIVATE_KEY`
- Claims: `email`, `sub` (userId), `symbiosika.roles`, custom claims
- Default expiration: 30 days
- Verified with `JWT_PUBLIC_KEY`

### API Tokens
- Created per user, scoped to tenant
- Stored hashed (SHA-256)
- Converted to short-lived JWT (15 min) on use
- Support scope restrictions and expiration

### Registration Hooks
- Pre-register: Custom verification before user creation
- Post-register: Actions after user creation (e.g., create default tenant)

## Database

### Connection
```typescript
import { getDb } from "@framework/lib/db/db-connection";
```
- Singleton Drizzle client with `postgres-js` driver
- Configured via `POSTGRES_*` env vars
- Schema merged: framework (`base_*` prefix) + app custom schema

### Framework Tables
- Core: `users`, `tenants`, `workspaces`, `teams`, `tenant_members`, `user_groups`
- AI: `knowledge`, `knowledge_texts`, `knowledge_chunks`, `knowledge_groups`
- System: `jobs`, `logs`, `files`, `webhooks`, `server_settings`
- Security: `secrets`, `api_tokens`
- Connections: `connections` (server-to-server)

### Table Creator
```typescript
import { pgBaseTable } from "@framework/lib/db/schema";
// Framework tables prefixed with "base_"
// App tables use custom PREFIX from src/db/index.ts
```

## Route Structure

Tenant-centric multi-tenant API:
- `/user/*` - User management and authentication
- `/tenant/{tenantId}/*` - Tenant-scoped resources
  - `/ai/*` - AI features
  - `/files/*` - File management
  - `/teams/*` - Team management
  - `/plugins/*` - Plugin management
  - `/jobs/*` - Background jobs
- `/admin/*` - Administrative endpoints

### Custom Routes

**Public (no auth):**
```typescript
customHonoApps: [{
  baseRoute: "",
  app: (app) => {
    app.get("/public-endpoint", async (c) => { ... });
  },
}]
```

**Protected (auth auto-applied):**
```typescript
customHonoAppsWithAuth: [{
  baseRoute: "",
  app: (app) => {
    app.get("/protected-endpoint", async (c) => {
      const userId = c.get("usersId");
    });
  },
}]
```

## Email

- Service: `smtpService` from `@framework/lib/email`
- Console mode: `SMTP_HOST=console.localhost` logs emails to console
- Custom templates via `emailTemplates` config
- Template types: `verifyEmail`, `magicLink`, `resetPassword`, `inviteToOrganization`

## Validation

- Library: Valibot (`import * as v from "valibot"`)
- Route validation: `validator("json" | "param" | "query", schema)` from `hono-openapi`
- Business logic: `v.parse(schema, data)` for insert/update schemas
- Response validators: `RESPONSE_VALIDATORS` from `@framework/lib/responses`

## Key Library Locations

- `src/lib/ai/` - Knowledge base, embeddings, similarity search
- `src/lib/auth/` - JWT, magic links, OAuth2, API tokens, scopes, permissions
- `src/lib/db/` - Drizzle ORM, schema, connection
- `src/lib/email/` - SMTP service with templates
- `src/lib/usermanagement/` - Tenants, teams, invitations, permissions
- `src/lib/crypt/` - AES encryption for secrets
- `src/lib/utils/` - Middleware, JWT keys, env validation
