import Link from "next/link";
import WorkspaceBar from "@/components/WorkspaceBar";

const items = [
  ["/discover", "科研发现"], ["/read", "深度精读"],
  ["/synthesis", "文献综合"], ["/design", "科研设计"],
];

export default function ResearchNav({ current }: { current: string }) {
  return <><header className="researchNav"><Link href="/" className="navBrand"><span>✳</span> MedRead</Link><nav aria-label="主要功能">{items.map(([href, label], index) => <Link key={href} href={href} className={current === href ? "active" : ""} aria-current={current === href ? "page" : undefined}><small>{String(index + 1).padStart(2, "0")}</small><strong>{label}</strong></Link>)}</nav></header><WorkspaceBar current={current} /></>;
}
