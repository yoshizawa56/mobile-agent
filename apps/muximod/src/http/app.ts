/**
 * Compatibility entry point for muximod-internal tests and imports.
 *
 * The HTTP application is owned by @muximo/muximod-http. Keeping this
 * re-export avoids coupling the composition root back to route internals.
 */
export {
  MuximodHttpError,
  createMuximodApp,
  type MuximodApp,
} from "@muximo/muximod-http";
export type {
  MuximodAuthContext,
  MuximodAuthDevice,
  MuximodAuthPort,
  MuximodHttpDependencies,
  MuximodHttpLogger,
  MuximodHttpStatus,
  MuximodHookEvent,
} from "@muximo/muximod-http";
