"use client";

import { useEffect } from "react";

/** Marks <html data-hydrated> once React is interactive. End-to-end tests wait for it before clicking. */
export function HydrationMarker() {
  useEffect(() => { document.documentElement.dataset.hydrated = "true"; }, []);
  return null;
}
