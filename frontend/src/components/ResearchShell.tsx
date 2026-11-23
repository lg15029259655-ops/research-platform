"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import ResearchNav from "@/components/ResearchNav";

const workspaceRoutes = new Set(["/discover", "/read", "/synthesis", "/design"]);

export default function ResearchShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (!workspaceRoutes.has(path)) return children;
  return <div className={path === "/read" ? "researchShell readerShell" : "researchShell"}>
    <ResearchNav current={path} />
    {children}
  </div>;
}
