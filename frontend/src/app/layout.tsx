import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedRead · 跨学科科研工作台",
  description: "文献发现、深度精读、文献综合与科研设计",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
