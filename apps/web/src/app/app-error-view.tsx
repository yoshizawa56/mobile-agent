import type { ReactNode } from "react";

type AppErrorViewProps = {
  error: unknown;
  title?: string;
  description?: string;
  onRetry?: () => void;
  children?: ReactNode;
};

export function AppErrorView({
  error,
  title = "The control room hit an unexpected error",
  description = "The page could not be rendered. Retry the current route or return to the terminal list.",
  onRetry,
  children,
}: AppErrorViewProps) {
  const message = errorMessage(error);

  return (
    <main className="app-error-shell" role="alert">
      <div className="app-error-card">
        <div className="app-error-mark" aria-hidden="true">!</div>
        <p className="eyebrow">CONTROL ROOM / RECOVERY</p>
        <h1>{title}</h1>
        <p className="app-error-description">{description}</p>
        <div className="app-error-actions">
          <button className="button button-primary" type="button" onClick={onRetry ?? reloadPage}>
            Retry
          </button>
          <a className="button button-secondary" href="/terminals">
            Terminal list
          </a>
        </div>
        <details className="app-error-details">
          <summary>Technical details</summary>
          <code>{message}</code>
        </details>
        {children}
      </div>
    </main>
  );
}

export function errorMessage(error: unknown): string {
  if (error == null) return "Unknown error";
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;

  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : "Unknown error";
  } catch {
    return "Unknown error";
  }
}

function reloadPage() {
  window.location.reload();
}
