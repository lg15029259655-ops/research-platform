import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "科研设计 · MedRead" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
