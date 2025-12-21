import { useState, useEffect } from "react";
import { VersionCheckerService, UpdateInfo } from "@/services/VersionCheckerService";

interface UseUpdateCheckerProps {
  currentVersion: string;
  repoOwner: string;
  repoName: string;
  checkOnMount?: boolean;
  delayMs?: number;
}

interface UseUpdateCheckerReturn {
  updateInfo: UpdateInfo | null;
  checkForUpdates: () => Promise<void>;
  dismissUpdate: (permanently?: boolean) => void;
}

export const useUpdateChecker = ({
  currentVersion,
  repoOwner,
  repoName,
  checkOnMount = true,
  delayMs = 2000,
}: UseUpdateCheckerProps): UseUpdateCheckerReturn => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [temporarilyDismissedVersions, setTemporarilyDismissedVersions] = useState<Set<string>>(
    new Set()
  );

  const versionChecker = new VersionCheckerService(currentVersion, repoOwner, repoName);

  const checkForUpdates = async () => {
    try {
      const result = await versionChecker.checkForUpdates();

      // Check if update is available and not permanently or temporarily dismissed
      if (
        result.hasUpdate &&
        result.latestVersion &&
        !VersionCheckerService.isDismissed(result.latestVersion) &&
        !temporarilyDismissedVersions.has(result.latestVersion)
      ) {
        setUpdateInfo(result);
      } else {
        // Update exists but was dismissed (permanently or temporarily) or no update
        setUpdateInfo(null);
      }
    } catch (error) {
      console.error("Update check failed:", error);
    }
  };

  const dismissUpdate = (permanently: boolean = false) => {
    if (!updateInfo?.latestVersion) return;

    if (permanently) {
      // Permanently dismiss this version
      VersionCheckerService.dismissVersion(updateInfo.latestVersion);
    } else {
      // Temporarily dismiss for this session only
      setTemporarilyDismissedVersions((prev) => new Set([...prev, updateInfo.latestVersion!]));
    }

    setUpdateInfo(null);
  };

  useEffect(() => {
    if (!checkOnMount) return;

    // Check for updates on mount with a delay to not block initial render
    const timeoutId = setTimeout(() => {
      checkForUpdates();
    }, delayMs);

    return () => clearTimeout(timeoutId);
  }, [checkOnMount, delayMs]);

  return {
    updateInfo,
    checkForUpdates,
    dismissUpdate,
  };
};
