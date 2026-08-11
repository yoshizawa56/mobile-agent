import type { NewSessionViewModel } from "./new-session-viewmodel";

export function NewSessionView({ viewModel }: { viewModel: NewSessionViewModel }) {
  const canCreate = viewModel.name.trim().length > 0 && viewModel.cwd.trim().length > 0;

  return (
    <main className="new-session-view">
      <header className="new-session-toolbar">
        <button className="new-session-back" type="button" onClick={viewModel.onBack}>‹ <span>{viewModel.terminal.name}</span></button>
        <span className="new-session-terminal"><span /> {viewModel.terminal.tailnetIp}</span>
      </header>
      <section className="new-session-content">
        <div className="connection-flow-intro">
          <span className="connection-flow-step"><span className="connection-flow-step-line" /> NEW SESSION</span>
          <h1>Create a tmux session</h1>
          <p>Start a durable workspace on {viewModel.terminal.name}. You can add agent panes after the session is ready.</p>
        </div>

        <form className="new-session-form" onSubmit={(event) => { event.preventDefault(); if (canCreate) viewModel.onCreate(); }}>
          <label className="new-session-field">
            <span>SESSION NAME</span>
            <input value={viewModel.name} onChange={(event) => viewModel.onNameChange(event.target.value)} placeholder="mobile-agent" autoComplete="off" />
            <small>Use a short name you can recognize on every device.</small>
          </label>
          <label className="new-session-field">
            <span>PROJECT DIRECTORY</span>
            <input value={viewModel.cwd} onChange={(event) => viewModel.onCwdChange(event.target.value)} placeholder="~/work/project" autoComplete="off" />
            <small>The first pane starts as a normal shell in this directory.</small>
          </label>
          <div className="new-session-agent-note"><span>⌁</span><span><strong>Shell first</strong><small>Create agent panes from the session overview when you need them.</small></span></div>
          {viewModel.errorMessage ? <p className="new-session-error" role="alert">{viewModel.errorMessage}</p> : null}
          <button className="connection-flow-primary" type="submit" disabled={!canCreate || viewModel.isCreating}>{viewModel.isCreating ? "Creating session…" : "Create session"}<span>{viewModel.isCreating ? "…" : "→"}</span></button>
        </form>
      </section>
    </main>
  );
}
