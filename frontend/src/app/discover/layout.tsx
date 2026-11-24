import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "文献发现 · MedRead" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
