"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageFocus } from "@/components/PageMain";
import ResearchNav from "@/components/ResearchNav";

const workspaceRoutes = new Set(["/discover", "/read", "/synthesis", "/design"]);

export default function ResearchShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <PageFocus>{workspaceRoutes.has(path) ? <div className={path === "/read" ? "researchShell readerShell" : "researchShell"}>
    <ResearchNav current={path} />
    {children}
  </div> : children}</PageFocus>;
}
