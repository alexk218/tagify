import { useEffect } from "react";

export function useFontAwesome() {
  useEffect(() => {
    if (!document.getElementById("font-awesome-css")) {
      const link = document.createElement("link");
      link.id = "font-awesome-css";
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.0/css/all.min.css";
      document.head.appendChild(link);
    }
  }, []);
}
