// Imported first by every bundle entry (the app and each extension) so the onboarding preview's
// storage sandbox is in place before any module reads Tagify's storage.
import { installOnboardingPreviewSandbox } from "./onboardingPreview";

installOnboardingPreviewSandbox();
