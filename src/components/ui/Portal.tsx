import React, { Fragment, useEffect, useState } from "react";
import * as ReactDOM from "react-dom";

interface PortalProps {
  children: React.ReactNode;
}

type CreatePortalFn = (
  children: React.ReactNode,
  container: Element | DocumentFragment
) => React.ReactPortal;

interface GlobalPortalSources {
  ReactDOM?: {
    createPortal?: unknown;
  };
  Spicetify?: {
    ReactDOM?: {
      createPortal?: unknown;
    };
  };
}

let hasWarnedAboutInlinePortalFallback = false;

function resolveCreatePortal():
  | {
      createPortal: CreatePortalFn;
      source: "spicetify" | "react-dom" | "window";
    }
  | null {
  const globalSources = globalThis as typeof globalThis & GlobalPortalSources;
  const candidates: Array<{
    source: "spicetify" | "react-dom" | "window";
    implementation: unknown;
  }> = [
    {
      source: "spicetify",
      implementation: globalSources.Spicetify?.ReactDOM?.createPortal,
    },
    {
      source: "react-dom",
      implementation: (ReactDOM as { createPortal?: unknown }).createPortal,
    },
    {
      source: "window",
      implementation: globalSources.ReactDOM?.createPortal,
    },
  ];

  for (const candidate of candidates) {
    if (typeof candidate.implementation === "function") {
      return {
        createPortal: candidate.implementation as CreatePortalFn,
        source: candidate.source,
      };
    }
  }

  return null;
}

const Portal: React.FC<PortalProps> = ({ children }) => {
  const portalSupport = resolveCreatePortal();
  const supportsPortal = Boolean(portalSupport);
  const [portalElement, setPortalElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!supportsPortal || typeof document === "undefined") {
      return undefined;
    }

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
  }, [supportsPortal]);

  if (!portalSupport) {
    if (!hasWarnedAboutInlinePortalFallback) {
      console.warn(
        "[Tagify] Portal rendering is unavailable in this runtime. Falling back to inline modal rendering."
      );
      hasWarnedAboutInlinePortalFallback = true;
    }
    return <Fragment>{children}</Fragment>;
  }

  return portalElement
    ? portalSupport.createPortal(children, portalElement)
    : null;
};

export default Portal;
