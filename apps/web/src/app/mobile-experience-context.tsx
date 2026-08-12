import { createContext, useContext, type ReactNode } from "react";
import { useMobileExperienceViewModel, type MobileExperienceViewModel } from "../features/product/mobile-experience-viewmodel";
import { useMobileViewportHeight } from "./mobile-viewport";

const MobileExperienceContext = createContext<MobileExperienceViewModel | null>(null);

export function MobileExperienceProvider({ children }: { children: ReactNode }) {
  useMobileViewportHeight();
  const viewModel = useMobileExperienceViewModel();
  return <MobileExperienceContext.Provider value={viewModel}>{children}</MobileExperienceContext.Provider>;
}

export function useMobileExperience(): MobileExperienceViewModel {
  const value = useContext(MobileExperienceContext);
  if (!value) throw new Error("useMobileExperience must be used inside MobileExperienceProvider");
  return value;
}
