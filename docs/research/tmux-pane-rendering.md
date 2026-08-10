# Ongoing Research: tmux Pane Rendering

Last updated: 2026-08-09

## Current implementation direction

The MVP shares the same tmux pane between desktop and mobile and acquires a viewport lease only while a mobile client is connected. The user selects a target pane, then the mobile client attaches with active-pane and enables zoom.

~~~text
xterm.js
  <-> WebSocket (control JSON + terminal bytes)
agentd
  <-> node-pty
tmux attach-session -t <target>
  <->
tmux window / pane TUI
~~~

xterm.js is responsible for interpreting terminal escape sequences, cursor state, scrollback, copy selection, and mouse input. agentd does not interpret terminal bytes. It forwards PTY input and output, resizes the PTY, and manages the tmux viewport lease.

When connecting, the current xterm.js cols and rows are sent to the PTY. The TUI therefore renders at the actual mobile terminal size. The initial implementation may expose that size change to a desktop client attached to the same tmux session.

## Why Control Mode is not the display route

tmux Control Mode is useful for pane discovery, lifecycle management, input, resize, metadata monitoring, and recovery. A terminal client with a PTY and a terminal emulator is the natural way to provide an interactive mobile terminal.

The terminal data route and the management route are therefore separate:

- terminal data route: run tmux attach-session through node-pty and relay raw bytes over WebSocket;
- management route: use tmux Control Mode inside agentd for pane discovery, user options, Run state, and events;
- web client: interpret and render terminal bytes with xterm.js.

## Candidates for rendering an individual pane without desktop interference

### A. Use tmux zoom (MVP)

Use zoom equivalent to resize-pane -Z and a normal tmux client connected to the selected pane. This is simple and makes the TUI's actual terminal size match the viewport. attach-session with the active-pane flag isolates the mobile client's active pane from the desktop client. Zoom and window size remain window-level properties, so the desktop view becomes narrow while the lease is active.

When acquiring the lease, snapshot the layout, zoom state, active pane, window-size setting, and window dimensions. Add a temporary active-pane flag to existing desktop clients so mobile pane selection does not move their cursor. When client-active, client-resized, or client-focus-in activity is observed, transition ownership to the desktop, remove zoom, and restore the desktop dimensions. When the lease ends, restore the original snapshot unless the desktop has already taken over.

### B. Create a dedicated tmux client

agentd should own a dedicated mobile tmux client even in the MVP. This is not a twin agent Run; it is another client attached to the same pane. The active-pane flag isolates pane selection, while the lease manages window-level zoom and size.

### C. Control Mode plus a headless xterm instance per pane

Receive raw output from tmux and keep an independent terminal-emulator state for every pane. This can be independent of the desktop layout, but Control Mode output depends on the size of its client. Correctly rebuilding a TUI at a different mobile width requires running the agent in another PTY or having the TUI support multiple viewports.

### D. Start a mobile-only Run for each agent

This provides completely independent dimensions, but the desktop and mobile processes are no longer the same process. History, work state, and simultaneous input conflicts require separate semantics, so this is not selected at the current stage.

## Cases to validate next

- Connect desktop and mobile clients to the same window and resize them to different widths (implemented).
- Verify that a mobile client using active-pane does not change the desktop active pane (implemented).
- Verify desktop takeover when a desktop client inputs or resizes during mobile zoom (implemented).
- Verify temporary active-pane flags on existing desktop clients and restoration of their original flags (implemented).
- Test combinations of window-size latest, largest, smallest, and manual with lease restoration.
- Feed tmux Control Mode percent-output and capture-pane data into xterm.js or @xterm/headless for initial synchronization.
- Test copy mode, mouse input, alternate screen, IME, Unicode width, and image protocols.
- Measure client count, CPU use, reconnect behavior, and cleanup with one dedicated client per pane.

## Deferred design

The MVP introduces an explicit viewport lease and owner. Revisit twin sessions if simultaneous operation or independent agent dimensions become necessary.

~~~text
viewportOwner: none | desktop | mobile
mode: interactive | observer
~~~

The design should allow a non-owner to observe output without changing size or focus. This makes it possible to add an observer mode later without weakening ownership rules.
