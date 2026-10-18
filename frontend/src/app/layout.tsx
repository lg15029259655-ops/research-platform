import type { Metadata } from "next";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedRead · 跨学科科研工作台",
  description: "文献发现、全文精读、文献综合与科研设计：让研究过程有迹可循。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>
    {/* 跳过导航直达主内容（ux-spec D13）；#main 由各页 <main> 承担 */}
    <a href="#main" className="skipLink">跳到主要内容</a>
    {children}
  </body></html>;
}
