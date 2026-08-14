import { useEffect, useMemo, useState } from "react";
import {
  UpdateInfo,
  VersionCheckerService,
} from "@/services/VersionCheckerService";

export interface UseUpdateCheckerProps {
  currentVersion: string;
  repoOwner: string;
  repoName: string;
  checkOnMount?: boolean;
  delayMs?: number;
}

export interface UseUpdateCheckerReturn {
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
  const [temporarilyDismissedVersions, setTemporarilyDismissedVersions] =
    useState<Set<string>>(new Set());

  const versionChecker = useMemo(
    () => new VersionCheckerService(currentVersion, repoOwner, repoName),
    [currentVersion, repoOwner, repoName],
  );

  const checkForUpdates = async () => {
    try {
      const result = await versionChecker.checkForUpdates();

      if (
        result.hasUpdate &&
        result.latestVersion &&
        !VersionCheckerService.isDismissed(result.latestVersion) &&
        !temporarilyDismissedVersions.has(result.latestVersion)
      ) {
        setUpdateInfo(result);
      } else {
        setUpdateInfo(null);
      }
    } catch (error) {
      console.error("Update check failed:", error);
    }
  };

  const dismissUpdate = (permanently = false) => {
    if (!updateInfo?.latestVersion) {
      return;
    }

    if (permanently) {
      VersionCheckerService.dismissVersion(updateInfo.latestVersion);
    } else {
      setTemporarilyDismissedVersions((prev) =>
        new Set([...prev, updateInfo.latestVersion!]),
      );
    }

    setUpdateInfo(null);
  };

  useEffect(() => {
    if (!checkOnMount) {
      return;
    }

    const timeoutId = setTimeout(() => {
      void checkForUpdates();
    }, delayMs);

    return () => clearTimeout(timeoutId);
  }, [checkOnMount, delayMs]);

  return {
    updateInfo,
    checkForUpdates,
    dismissUpdate,
  };
};
