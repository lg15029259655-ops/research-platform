"use client";

import { createContext, useContext, useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

type CommittedPage = { current: string | null };
const PreviousPage = createContext<CommittedPage | null>(null);

export function PageFocus({ children }: { children: ReactNode }) {
  const lastPage = useRef<string | null>(null);
  return <PreviousPage.Provider value={lastPage}>{children}</PreviousPage.Provider>;
}

export default function PageMain({ route, ...props }: ComponentPropsWithoutRef<"main"> & { route: string }) {
  const previous = useContext(PreviousPage);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!previous) return;
    if (previous.current === null) previous.current = route;
    if (previous.current === route) return;
    const frame = requestAnimationFrame(() => {
      previous.current = route;
      if (main.current && !main.current.contains(document.activeElement)) {
        main.current.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [previous, route]);

  return <main {...props} id="main" tabIndex={-1} ref={main} />;
}
