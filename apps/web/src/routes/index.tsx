import { createFileRoute } from "@tanstack/react-router";
import { MobileExperienceView } from "../features/product/mobile-experience-view";
import { useMobileExperienceViewModel } from "../features/product/mobile-experience-viewmodel";

export const Route = createFileRoute("/")({
  component: IndexRoute,
});

function IndexRoute() {
  const viewModel = useMobileExperienceViewModel();
  return <MobileExperienceView viewModel={viewModel} />;
}
