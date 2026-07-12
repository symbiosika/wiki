/**
 * Bun WebSocket adapter, shared across the app.
 *
 * `createBunWebSocket()` returns a matched pair:
 *   - `upgradeWebSocket` — Hono middleware used inside a route to accept a WS
 *     upgrade and register per-connection handlers.
 *   - `websocket`        — the Bun.serve `websocket` handler that dispatches raw
 *     socket events to those per-connection handlers.
 *
 * Both halves must come from the SAME `createBunWebSocket()` call, so this
 * module owns the single instance: routes import `upgradeWebSocket`, and the
 * server entry point (src/index.ts) spreads `websocket` into the Bun.serve
 * config that `defineServer` returns (the framework itself is WS-agnostic).
 */
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";

export const { upgradeWebSocket, websocket } =
  createBunWebSocket<ServerWebSocket>();
