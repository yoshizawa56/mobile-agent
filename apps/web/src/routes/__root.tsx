import { Outlet, createRootRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { MobileExperienceProvider } from "../app/mobile-experience-context";
import { AppErrorView } from "../app/app-error-view";

export const Route = createRootRoute({
  component: RootRoute,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
});

function RootRoute() {
  return (
    <MobileExperienceProvider>
      <Outlet />
    </MobileExperienceProvider>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  return <AppErrorView error={error} onRetry={reset} />;
}

function RootNotFound() {
  return (
    <AppErrorView
      error={new Error("The requested route does not exist")}
      title="That route does not exist"
      description="The app is still running, but this URL is not one of its routes. Return to the terminal list to continue."
    />
  );
}
