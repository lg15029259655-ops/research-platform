import Link, { useLinkStatus } from "next/link";
import WorkspaceBar from "@/components/WorkspaceBar";
import { preparedWorkspace } from "@/prepared/config";

const items = [
  ["/discover", "科研发现"], ["/read", "深度精读"],
  ["/synthesis", "文献综合"], ["/design", "科研设计"],
];

function NavPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="navPending" role="status" aria-label="正在切换页面" /> : null;
}

export default function ResearchNav({ current }: { current: string }) {
  return <header className="researchNav"><Link href="/" className="navBrand"><span aria-hidden="true">✳</span> MedRead</Link><nav aria-label="主要功能">{items.map(([href, label], index) => <Link key={href} href={href} className={current === href ? "active" : ""} aria-current={current === href ? "page" : undefined}><small>{String(index + 1).padStart(2, "0")}</small><strong>{label}</strong><NavPending /></Link>)}</nav>{!preparedWorkspace && <WorkspaceBar current={current} />}</header>;
}
