import { useEffect, useState } from "react";

export interface DiscoverySurveyState {
  hasCompletedSurvey: boolean;
  hasDismissedSurvey?: boolean;
  surveyVersion: string;
  completedAt?: string;
  source?: string;
  otherDetails?: string;
  skipCount?: number;
  lastSkippedAt?: string;
}

export interface UseDiscoverySurveyReturn {
  shouldShowSurvey: boolean;
  completeSurvey: (source: string, otherDetails?: string) => void;
  skipSurvey: () => void;
  skipCount: number;
}

const SURVEY_STORAGE_KEY = "tagify:discoverySurvey";
const SUPABASE_URL = "https://yointrjetbqqaupavfyt.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaW50cmpldGJxcWF1cGF2Znl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4Mjg1ODEsImV4cCI6MjA3MjQwNDU4MX0.tJoLNZxdsC_skk3JkYEG1o3ZTFJG8m-yNLEOnS9RDC0";

export function useDiscoverySurvey(
  currentVersion: string,
): UseDiscoverySurveyReturn {
  const [shouldShowSurvey, setShouldShowSurvey] = useState(false);
  const [skipCount, setSkipCount] = useState(0);

  useEffect(() => {
    checkSurveyStatus();
  }, [currentVersion]);

  const checkSurveyStatus = (): void => {
    try {
      const savedState = localStorage.getItem(SURVEY_STORAGE_KEY);

      if (!savedState) {
        setShouldShowSurvey(true);
        setSkipCount(0);
        return;
      }

      const surveyState = JSON.parse(savedState) as DiscoverySurveyState;

      const savedSkipCount = surveyState.skipCount ?? 0;
      const hasAlreadySeenSurvey =
        surveyState.hasCompletedSurvey ||
        surveyState.hasDismissedSurvey === true ||
        savedSkipCount > 0;

      setSkipCount(savedSkipCount);
      setShouldShowSurvey(!hasAlreadySeenSurvey);
    } catch (error) {
      console.error("Tagify: Error checking welcome survey status:", error);
    }
  };

  const completeSurvey = (source: string, otherDetails?: string): void => {
    try {
      const surveyState: DiscoverySurveyState = {
        hasCompletedSurvey: true,
        surveyVersion: currentVersion,
        completedAt: new Date().toISOString(),
        source,
        otherDetails,
        skipCount,
      };

      localStorage.setItem(SURVEY_STORAGE_KEY, JSON.stringify(surveyState));
      setShouldShowSurvey(false);

      void sendToSupabase(surveyState);
    } catch (error) {
      console.error("Tagify: Error saving welcome survey completion:", error);
      setShouldShowSurvey(false);
    }
  };

  const skipSurvey = (): void => {
    try {
      const existingData = localStorage.getItem(SURVEY_STORAGE_KEY);
      let currentState: DiscoverySurveyState = {
        hasCompletedSurvey: false,
        surveyVersion: currentVersion,
        skipCount: 0,
      };

      if (existingData) {
        currentState = {
          ...JSON.parse(existingData),
        };
      }

      const newSkipCount = (currentState.skipCount ?? 0) + 1;

      const updatedState: DiscoverySurveyState = {
        ...currentState,
        hasCompletedSurvey: false,
        hasDismissedSurvey: true,
        surveyVersion: currentVersion,
        skipCount: newSkipCount,
        lastSkippedAt: new Date().toISOString(),
      };

      localStorage.setItem(SURVEY_STORAGE_KEY, JSON.stringify(updatedState));
      setShouldShowSurvey(false);
      setSkipCount(newSkipCount);
    } catch (error) {
      console.error("Tagify: Error saving survey skip:", error);
      setShouldShowSurvey(false);
    }
  };

  return {
    shouldShowSurvey,
    completeSurvey,
    skipSurvey,
    skipCount,
  };
}

async function sendToSupabase(surveyData: DiscoverySurveyState): Promise<void> {
  try {
    console.log("Sending to Supabase:", {
      source: surveyData.source,
      other_details: surveyData.otherDetails || null,
      app_version: surveyData.surveyVersion,
      user_agent: navigator.userAgent,
      completed_at: surveyData.completedAt,
      skip_count: surveyData.skipCount || 0,
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/discovery_surveys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source: surveyData.source,
        other_details: surveyData.otherDetails || null,
        app_version: surveyData.surveyVersion,
        user_agent: navigator.userAgent,
        completed_at: surveyData.completedAt,
        skip_count: surveyData.skipCount || 0,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error("Tagify: Error sending survey data to Supabase:", error);
    throw error;
  }
}
