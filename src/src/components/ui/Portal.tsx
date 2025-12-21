import { useEffect, useState } from "react";
import * as ReactDOM from "react-dom";

interface PortalProps {
  children: React.ReactNode;
}

const Portal: React.FC<PortalProps> = ({ children }) => {
  const [portalElement, setPortalElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Create a div element that will be our portal
    const element = document.createElement("div");
    element.className = "tagify-portal";
    document.body.appendChild(element);
    setPortalElement(element);

    // Clean up
    return () => {
      if (element && document.body.contains(element)) {
        document.body.removeChild(element);
      }
    };
  }, []);

  // Only render the children when we have a portal element
  return portalElement ? ReactDOM.createPortal(children, portalElement) : null;
};

export default Portal;
