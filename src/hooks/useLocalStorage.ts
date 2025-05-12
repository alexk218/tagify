import { useState } from "react";

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key);

      // If no item exists, return initialValue
      if (!item) return initialValue;

      // Try to parse as JSON, but if it fails, return the raw string
      try {
        return JSON.parse(item);
      } catch (e) {
        // If parsing fails, just return the string value
        return item as unknown as T;
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage.
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;

      // Save state
      setStoredValue(valueToStore);

      // Save to local storage - handle both objects and primitive values
      if (typeof valueToStore === "object") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      } else {
        window.localStorage.setItem(key, String(valueToStore));
      }
    } catch (error) {
      console.error(`Error saving localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue];
}
