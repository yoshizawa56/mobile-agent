---
name: clean-architecture
description: Enforce Muximo's Clean Architecture dependency direction when reviewing or changing domain, application, interface-adapter, infrastructure, composition-root, package, or entrypoint code.
---

# Muximo Clean Architecture

Apply this skill to any change that can affect package dependencies, layer boundaries, entrypoints, plugins, persistence, host integrations, authentication, HTTP, CLI, or terminal runtime behavior.

## Dependency rule

Dependencies point inward:

```text
entrypoints/composition roots -> interface adapters and infrastructure
interface adapters -> application and domain
infrastructure -> application and domain
application -> domain and application-owned ports
domain -> no outer packages or runtime adapters
```

The source layer owns its abstractions. A concrete outer implementation may implement an inner port, but an inner layer must not import the concrete implementation, its package, or its runtime library.

## Muximo layer rules

- `packages/domain` contains entities, value rules, and pure policies. It must not import `api`, HTTP, Bun, Node, SQLite, tmux, agent providers, or UI code.
- `packages/application` contains use cases, application-owned input/output models, and ports. It must not import `api`, HTTP route types, persistence implementations, provider plugins, tmux, PTY, filesystem, child processes, sockets, or browser APIs.
- `packages/api` contains wire schemas and oRPC contracts. Do not use API DTOs as the application model when a use case-owned model is needed; map at the adapter boundary. It must remain free of Node, Bun, database, host, and UI dependencies.
- `packages/infrastructure` contains the concrete outer adapters, organized by technical concern: HTTP/WebSocket under `src/http`, provider plugins under `src/agents`, CLI adapters and host commands under `src/cli`, persistence under `src/persistence`, logging under `src/logging`, and Tailscale integration under `src/tailscale`.
- `apps/web` owns the browser/native oRPC client because it uses browser `fetch`, `WebSocket`, and UI-facing connection state. It may depend on `api`, but `api` and `application` must not depend on it.
- Infrastructure owns concrete filesystem, process, tmux, PTY, Unix socket, SQLite, Tailscale, browser-facing transport adapters, authentication crypto, and provider-specific agent implementations.
- `apps/*/src/index.ts` is a composition root and entrypoint. It may read argv/environment/I/O, select a command, construct concrete dependencies, and report process-level errors. It must not contain business workflows or infrastructure policy.
- A server composition module may construct concrete adapters, but keep runtime lifecycle and application policy in separate collaborators where practical.

## Plugins and providers

Provider implementations belong in infrastructure. Keep provider-neutral application ports separate from provider-specific plugin registries, default plugin lists, monitors, sidecars, and RPC clients. The composition root registers defaults and injects the resulting port implementation; use cases do not import or register concrete plugins.

## Review workflow

Before changing code:

1. Identify the layer of every touched module and inspect its imports and package dependencies.
2. Separate business decisions from I/O, process control, persistence, transport, and presentation.
3. Put the narrow abstraction in the inward layer and the concrete implementation in infrastructure.
4. Make the composition root wire the concrete graph.
5. Test application rules with fakes and adapter behavior with focused integration tests.
6. Check for reverse imports and new public exports that expose infrastructure to inner layers.

Run `bun run check:architecture` after the change. The check validates workspace
package dependencies, production workspace imports, and the most important
domain/application/interface-adapter boundaries without requiring a database,
tmux, or external provider to be available.

Preserve existing behavior and security invariants while moving boundaries, especially authentication replay prevention, credential ownership, session execution claims, worktree containment and cleanup, hook ordering, provider lifecycle disposal, and tmux identity/reconciliation.

When a boundary is intentionally relaxed, document the reason in the code or architecture reference and keep the dependency one-way.
