"use client";

import PageMain from "@/components/PageMain";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import JobProgress from "@/components/jobs/JobProgress";
import { ApiError, apiJson, postJson } from "@/lib/api";
import { useWorkspaceJob } from "@/lib/workspace-jobs";
import { saveManualDesign } from "@/lib/manual-design";
import { setPaperInSynthesis, useWorkspace, type Workspace } from "@/lib/workspace";
import { readTabDraft, useTabDraft, writeTabDraft } from "@/lib/tab-draft";
import { tabGroup } from "@/lib/tabs";
import type { SimilarPaper } from "@/components/NoveltySpace";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import DesignStepEditor from "@/components/DesignStepEditor";
import SavedHistory from "@/components/SavedHistory";
import { deferredPanel } from "@/components/deferred-panel";
import type { Step } from "@/components/DesignFlow";
import "@/components/design-insights.css";

const DesignFlow = deferredPanel(() => import("@/components/DesignFlow"), "设计沙盘");
const NoveltySpace = deferredPanel(() => import("@/components/NoveltySpace"), "新颖性扫描");
type Novelty = { query: string; similar_papers: SimilarPaper[];
  similarity_level: string; differences: string[]; novel_angles: string[]; evidence_scope: string;
  search_only?: boolean; search_message?: string };
type Design = { goal: string; change_summary: string; constraints: string[]; nodes: { id: string; label: string; type: string; detail: string; steps?: Step[] }[];
  edges: { source: string; target: string; label: string }[]; controls: string[]; readouts: string[]; assumptions: string[];
  input_constraints?: string; research_origin?: { research_gap?: string; synthesis_id?: string | null; selected_papers?: {paper_id: string; title: string}[] } };
type Artifact<T> = { id: string; payload: T; created_at: string };
type VersionEntry = { version_id: string; number: number; action: string; artifact_id: string };
type DesignVersion = VersionEntry & { payload: Design; changes: { added: string[]; removed: string[]; modified: string[] } };
type SavedDesign = { id: string; created_at: string; number: number; action: string; goal: string };
const actions = [["causality", "加强因果"], ["cost", "降低成本"], ["simplify", "简化方案"], ["mechanism", "增加机制"], ["application", "增强应用意义"]];
const actionLabels: Record<string, string> = {generate: "生成方案", manual: "手动编辑", node: "局部修改", causality: "加强因果",
  cost: "降低成本", simplify: "简化方案", mechanism: "增加机制", application: "增强应用"};
const sourceHref = (id: string) => `/synthesis?view=gaps&artifact=${encodeURIComponent(id)}`;

type DesignDraft = { idea?: string; constraints?: string };
type DesignView = "novelty" | "canvas";

function designView(value: string | null): DesignView | null {
  return value === "novelty" || value === "canvas" ? value : null;
}

function updateDesignUrl(params: URLSearchParams) {
  const { pathname, search, hash } = window.location;
  if (pathname !== "/design") return;
  const next = params.size ? `?${params}` : "";
  if (search !== next) window.history.replaceState(null, "", `${pathname}${next}${hash}`);
}

function setTab(view: DesignView) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === view) return;
  params.set("view", view);
  updateDesignUrl(params);
}

function designDraftKey(workspace: Workspace, urlIdea: string | null) {
  const idea = urlIdea ?? workspace.design_idea;
  const source = workspace.gap_context.question === idea ? workspace.gap_context.synthesis_id : null;
  return `design:${JSON.stringify([workspace.workspace_id, idea, source ?? null])}`;
}

async function restoreSavedVersion(
  version: VersionEntry, expectedUpdatedAt: string, refresh: (afterPending?: boolean) => Promise<Workspace>,
) {
  const signal = AbortSignal.timeout(10000);
  try {
    return await apiJson<DesignVersion>(`/api/research/design/versions/${encodeURIComponent(version.version_id)}/restore`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_updated_at: expectedUpdatedAt }), signal,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      await refresh(true).catch(() => {});
      throw error;
    }
    if (!signal.aborted && !(error instanceof TypeError)) throw error;
    const current = await refresh(true).catch(() => null);
    if (current?.design_version_id === version.artifact_id) return null;
    throw new Error("暂时无法确认版本是否已恢复，请重试。");
  }
}

export default function DesignPage() {
  const historical = useSearchParams().get("version");
  return historical ? <DesignPreview key={historical} id={historical} /> : <DesignWorkspace />;
}

function DesignPreview({ id }: { id: string }) {
  const router = useRouter();
  const { workspace, refresh } = useWorkspace();
  const [version, setVersion] = useState<DesignVersion | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (version) titleRef.current?.focus();
  }, [version]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    apiJson<DesignVersion[]>(`/api/research/design/versions?artifact_id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store",
    }).then(([entry]) => {
      if (controller.signal.aborted) return;
      if (entry) setVersion(entry); else setLoadError("找不到这个设计版本");
    }).catch(() => { if (!controller.signal.aborted) setLoadError("暂时无法读取这个设计版本"); });
    return () => controller.abort();
  }, [id, attempt]);

  async function resume() {
    if (!version || !confirmation || saving) return;
    setSaving(true); setRestoreError("");
    try {
      const restored = await restoreSavedVersion(version, confirmation, refresh);
      if (restored) await refresh(true).catch(() => {});
      if (active.current) router.replace("/design?view=canvas");
    } catch (e) {
      if (!active.current) return;
      setRestoreError(e instanceof Error ? e.message : "暂时无法恢复这个版本");
      setConfirmation(null);
      setSaving(false);
    }
  }

  const design = version?.payload;
  return <PageMain route="/design" className="researchPage">
    <div className="pageIntro">
      <h1 ref={titleRef} tabIndex={-1} style={{ overflowWrap: "anywhere" }}>{design?.goal || "历史设计"}</h1>
      {version && <p>历史版本 V{version.number} · {actionLabels[version.action] || version.action}</p>}
      <Link className="inlineLink" href="/design">返回当前设计</Link>
    </div>
    {design && version ? <>
      <section className="sectionBox">
        {design.change_summary && <p>{design.change_summary}</p>}
        {design.input_constraints && <p>原始约束 · {design.input_constraints}</p>}
        {design.research_origin?.synthesis_id && <Link className="quietButton" href={sourceHref(design.research_origin.synthesis_id)}>查看此版本的文献依据 ↗</Link>}
        {confirmation && <p>恢复后，这个版本将成为当前设计。其他已保存版本仍可在设计历史中打开。</p>}
        <div className="actionRow">
          <button type="button" disabled={!workspace || saving} onClick={() => setConfirmation(confirmation ? null : workspace?.updated_at || null)}>
            {confirmation ? "取消恢复" : "继续编辑此版本"}
          </button>
          {confirmation && <button type="button" disabled={saving} onClick={() => void resume()}>{saving ? "正在恢复…" : "确认恢复"}</button>}
        </div>
        {restoreError && <p className="researchError" role="alert">{restoreError}</p>}
        <details>
          <summary>查看对照、指标和假设</summary>
          {([["对照", design.controls], ["指标", design.readouts], ["假设", design.assumptions]] as const).map(([label, values]) =>
            <div key={label}><h3>{label}</h3><ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul></div>)}
        </details>
      </section>
      <DesignFlow design={design} artifactId={id} readOnly />
    </> : loadError ? <div className="researchError" role="alert">{loadError} <button className="quietButton" onClick={() => setAttempt((count) => count + 1)}>重试读取版本</button></div>
      : <p className="workspaceLoading" role="status">正在读取设计版本…</p>}
  </PageMain>;
}

function DesignWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlIdea = searchParams.get("idea");
  const { workspace, workspaceError, refresh } = useWorkspace();
  const savedIdea = workspace?.design_idea || "";
  const pinnedSource = workspace?.gap_context.synthesis_id;
  const draftKey = workspace ? designDraftKey(workspace, urlIdea) : null;
  const [formDraft, setFormDraft] = useTabDraft<DesignDraft>(draftKey);
  const idea = typeof formDraft?.idea === "string" ? formDraft.idea : urlIdea ?? savedIdea;
  const editDraft = (change: DesignDraft) => {
    if (draftKey) setFormDraft({ ...readTabDraft<DesignDraft>(draftKey), ...change });
  };
  const setIdea = (value: string) => editDraft({ idea: value });
  const setConstraints = (value: string) => editDraft({ constraints: value });
  const [novelty, setNovelty] = useState<Novelty | null>(null);
  const [noveltyReady, setNoveltyReady] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState<DesignVersion | null>(null);
  const currentDesignId = workspace?.design_version_id;
  const activeVersion = loadedVersion?.artifact_id === currentDesignId ? loadedVersion : null;
  const design = activeVersion?.payload;
  const constraints = typeof formDraft?.constraints === "string" ? formDraft.constraints
    : (design?.goal.trim() === idea.trim() ? design?.input_constraints || "" : "");
  const [localBusy, setBusy] = useState(false);
  const { job, start, cancel, dismiss } = useWorkspaceJob("design");
  const running = job?.status === "running";
  const busy = localBusy || running;
  const formDisabled = !draftKey || running;
  const [error, setError] = useState("");
  const [taskCanceled, setTaskCanceled] = useState(false);
  const [versionList, setVersionList] = useState<{ goal: string; entries: VersionEntry[] } | null>(null);
  const [versionListError, setVersionListError] = useState(false);
  const [versionListAttempt, setVersionListAttempt] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeInstruction, setNodeInstruction] = useState("");
  const [selectedChange, setSelectedChange] = useState<{label: string; kind: string} | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [noveltyError, setNoveltyError] = useState("");
  const [designError, setDesignError] = useState("");
  const currentNoveltyId = workspace?.novelty_id;
  const restoringDesign = !!currentDesignId && !activeVersion && !designError;
  const restoringNovelty = !!currentNoveltyId && !noveltyReady && !noveltyError;
  const active = useRef(false);
  const pendingStageSave = useRef<{ input: string; requestId: string } | null>(null);
  const sameDesignInput = design?.goal.trim() === idea.trim() && (design.input_constraints || "") === constraints.trim();
  const shownNovelty = novelty?.query.trim() === idea.trim() ? novelty : null;
  const shownDesign = design?.goal.trim() === idea.trim() ? design : null;
  const origin = shownDesign?.research_origin;
  const hasOriginNotes = !!(origin?.research_gap || origin?.selected_papers?.length);
  const tab = designView(searchParams.get("view"))
    ?? (shownDesign && !shownNovelty && !restoringNovelty ? "canvas" : "novelty");
  const workspaceTabs = tabGroup(["novelty", "canvas"] as const, tab, setTab);
  useEffect(() => {
    setNoveltyError("");
    if (!currentNoveltyId) { setNovelty(null); setNoveltyReady(true); return; }
    const controller = new AbortController();
    setNoveltyReady(false);
    apiJson<Artifact<Novelty>[]>(`/api/research/artifacts?kind=novelty_analysis&artifact_id=${currentNoveltyId}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then((items) => {
        if (controller.signal.aborted) return;
        const candidate = items.find((item) => item.id === currentNoveltyId)?.payload;
        if (candidate?.query?.trim() !== savedIdea.trim()) throw new Error("找不到对应的新颖性结果");
        setNovelty(candidate);
      })
      .catch(() => { if (!controller.signal.aborted) setNoveltyError("暂时无法读取上次新颖性结果"); })
      .finally(() => { if (!controller.signal.aborted) setNoveltyReady(true); });
    return () => controller.abort();
  }, [currentNoveltyId, savedIdea, restoreAttempt]);
  useEffect(() => {
    setDesignError("");
    if (!currentDesignId || !savedIdea) { setLoadedVersion(null); return; }
    if (activeVersion) return;
    const controller = new AbortController();
    apiJson<DesignVersion[]>(`/api/research/design/versions?artifact_id=${encodeURIComponent(currentDesignId)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store",
    }).then(([version]) => {
      if (controller.signal.aborted) return;
      if (version?.payload.goal.trim() !== savedIdea.trim()) throw new Error("找不到对应的设计版本");
      setLoadedVersion(version);
    }).catch(() => { if (!controller.signal.aborted) setDesignError("暂时无法读取已保存的设计版本"); });
    return () => controller.abort();
  }, [currentDesignId, savedIdea, restoreAttempt]);
  useEffect(() => {
    setVersionListError(false);
    if (!currentDesignId || !savedIdea) { setVersionList(null); return; }
    const controller = new AbortController();
    apiJson<VersionEntry[]>(`/api/research/design/versions?summary=true&goal=${encodeURIComponent(savedIdea)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store",
    }).then((entries) => {
      if (!controller.signal.aborted) setVersionList({ goal: savedIdea, entries });
    }).catch(() => { if (!controller.signal.aborted) setVersionListError(true); });
    return () => controller.abort();
  }, [currentDesignId, savedIdea, versionListAttempt]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const submittedDraft = job?.draft;
  useEffect(() => {
    // Restore pre-existing job tickets from versions that had no form autosave.
    if (!draftKey || typeof submittedDraft?.idea !== "string" || submittedDraft.key
        || (urlIdea !== null && urlIdea !== submittedDraft.idea) || readTabDraft(draftKey)) return;
    const { idea, constraints } = submittedDraft;
    setFormDraft({ idea, constraints });
  }, [submittedDraft, draftKey, urlIdea, setFormDraft]);
  useEffect(() => {
    if (!job || job.status === "running") return;
    if (job.status === "canceled") setTaskCanceled(true);
    if (job.status !== "done") {
      dismiss(job);
      if (job.status === "failed") setError(job.error || "任务未完成，请重试");
      return;
    }
    const result = job.result as Artifact<Novelty | Design> & { version?: DesignVersion } | null;
    if (!result?.payload) { dismiss(job); setError("任务没有返回可用结果"); return; }
    let disposed = false;
    void refresh(true).then((current) => {
      if (disposed) return;
      const pointer = job.kind === "novelty" ? current.novelty_id : current.design_version_id;
      if (pointer !== result.id) { setError("后台任务已完成，当前研究想法或方案已变化。"); return; }
      const params = new URLSearchParams(window.location.search);
      const submitted = job.draft;
      if (submitted?.key) {
        const previous = readTabDraft<DesignDraft>(submitted.key);
        const unchanged = previous && (previous.idea === undefined || previous.idea === submitted.idea)
          && (previous.constraints === undefined || previous.constraints === submitted.constraints);
        if (unchanged) {
          const followSavedIdea = urlIdea !== null && submitted.key === draftKey && submitted.idea.trim() !== urlIdea.trim();
          const savedKey = designDraftKey(current, followSavedIdea ? null : urlIdea);
          if (job.kind === "novelty" && previous.constraints !== undefined) {
            if (savedKey !== submitted.key && !readTabDraft(savedKey)) {
              writeTabDraft(savedKey, { constraints: previous.constraints });
              writeTabDraft(submitted.key, null);
            }
          } else {
            writeTabDraft(submitted.key, null);
          }
          if (followSavedIdea) params.delete("idea");
        }
      }
      if (job.kind === "novelty") {
        setNovelty(result.payload as Novelty);
      } else {
        if (result.version) setLoadedVersion(result.version);
      }
      if (!designView(params.get("view"))) params.set("view", job.kind === "novelty" ? "novelty" : "canvas");
      updateDesignUrl(params);
    }).catch(() => {
      if (!disposed) setError("结果已保存，请重新打开本页读取。");
    }).finally(() => { if (!disposed) dismiss(job); });
    return () => { disposed = true; };
  }, [job, dismiss, refresh, urlIdea, draftKey]);

  function scan(force = false) {
    if (busy || !draftKey) return;
    if (!force && shownNovelty) { setTab("novelty"); return; }
    setTab("novelty"); setError("");
    setTaskCanceled(false);
    void start("novelty", { query: idea.trim() }, { draft: { idea, constraints, key: draftKey } });
  }

  function generate(action = "generate", nodeId?: string, instruction = "", force = false) {
    if (busy || !draftKey) return;
    if (action === "generate" && sameDesignInput && !force) { setTab("canvas"); return; }
    setTab("canvas"); setError("");
    setTaskCanceled(false);
    void start("design", { goal: idea.trim(), constraints, action,
      current_design: action === "generate" ? null : design,
      node_id: nodeId, instruction, regenerate: force,
    }, { draft: { idea, constraints, key: draftKey } });
  }
  async function restoreVersion(version: VersionEntry) {
    setTab("canvas");
    setBusy(true); setError("");
    try {
      const current = workspace ?? await refresh(true);
      const restored = await restoreSavedVersion(version, current.updated_at, refresh);
      if (restored) {
        if (active.current) setLoadedVersion(restored);
        await refresh(true);
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : "版本恢复失败"); }
    finally { setBusy(false); }
  }
  const scopedVersions = Array.from(new Map([
    ...(versionList?.goal === savedIdea ? versionList.entries : []),
    ...(activeVersion ? [activeVersion] : []),
  ].map((item) => [item.version_id, item])).values())
    .sort((a, b) => a.number - b.number);
  const currentVersion = activeVersion?.version_id;
  const activeIndex = scopedVersions.findIndex((item) => item.version_id === currentVersion);
  const displayVersion = activeVersion?.number ?? 1;
  const priorVersion = activeIndex > 0 ? scopedVersions[activeIndex - 1] : null;
  const nodeDetail = design?.nodes.find((item) => item.id === selectedNode);
  function openChange(label: string, kind: string) {
    const node = design?.nodes.find((item) => item.label === label || item.id === label);
    if (node) { setSelectedNode(node.id); setSelectedChange(null); }
    else setSelectedChange({label, kind});
  }
  async function importWork(paper: SimilarPaper) {
    return postJson<{id: string}>("/api/research/import", {openalex_id: paper.openalex_id});
  }
  async function viewWork(paper: SimilarPaper) {
    setBusy(true); setError("");
    try {
      const saved = await importWork(paper);
      if (active.current) router.push(`/read?paper=${encodeURIComponent(saved.id)}`);
    } catch (e) { setError(e instanceof Error ? e.message : "无法打开论文"); }
    finally { setBusy(false); }
  }
  async function addWork(paper: SimilarPaper) {
    setBusy(true); setError("");
    try {
      const current = await refresh(true);
      if (workspace && workspace.query !== current.query) throw new Error("研究主题已变化，请核对当前主题后再加入");
      const ids = current.selected_paper_ids;
      // 先判上限再 import。原来的顺序是先入库再判上限，超限时论文已经写进论文库，
      // 用户看到报错、回论文库却多了一条自己不想要的记录。
      if (ids.length >= 5) throw new Error("对比篮最多 5 篇论文，请先在文献综合页移除一篇");
      const saved = await importWork(paper);
      await setPaperInSynthesis(saved.id, true, current.query);
    } catch (e) { setError(e instanceof Error ? e.message : "加入对比失败"); }
    finally { setBusy(false); }
  }
  async function saveStageSteps(id: string, steps: Step[]) {
    if (!activeVersion || !shownDesign) throw new Error("当前版本尚未加载");
    const draft = { ...shownDesign, nodes: shownDesign.nodes.map(node => node.id === id ? { ...node, steps } : node) };
    const input = JSON.stringify([activeVersion.artifact_id, draft]);
    const requestId = pendingStageSave.current?.input === input ? pendingStageSave.current.requestId : crypto.randomUUID();
    pendingStageSave.current = { input, requestId };
    const result = await saveManualDesign<{ version: DesignVersion }>(activeVersion.artifact_id, draft, requestId);
    if (pendingStageSave.current?.requestId === requestId) pendingStageSave.current = null;
    setLoadedVersion(result.version);
    await refresh().catch(() => {});
  }
  return <PageMain route="/design" className="researchPage">
    <div className="pageIntro"><div className="eyebrow">04 / DESIGN</div><h1>让研究想法成为可检验的方案。</h1><p>结合文献线索和研究条件，设计可展开的实验路线，并逐步检查对照、指标与可能结果。</p></div>
    <SavedHistory<SavedDesign> title="设计历史" endpoint="/api/research/design/history" currentId={currentDesignId} viewingId={currentDesignId}
      href={(entry) => `/design?version=${encodeURIComponent(entry.id)}`}
      label={(entry) => entry.goal || "已保存的研究设计"}
      metadata={(entry) => `V${entry.number} · ${actionLabels[entry.action] || entry.action}`} />
    {workspace?.design_idea && workspace.design_idea.trim() === idea.trim() && (workspace.research_gap || typeof pinnedSource === "string") && (!workspace.gap_context.question || workspace.gap_context.question === workspace.design_idea) && <details className="di-origin" open><summary>研究起点 · 来自文献综合</summary>{workspace.research_gap && <p><b>研究空白：</b>{workspace.research_gap}</p>}<p><b>当前问题：</b>{workspace.design_idea}</p><p>这是第三部分的综合线索，请结合对应论文原文核对；不是已独立证实的实验事实。</p><Link className="quietButton" href={typeof pinnedSource === "string" ? sourceHref(pinnedSource) : "/synthesis?view=gaps"}>返回研究空白查看依据 ↗</Link></details>}
    <section className="sectionBox"><label className="fieldLabel" htmlFor="idea">我的研究想法</label><textarea id="idea" className="largeTextarea" disabled={formDisabled} value={idea} onChange={(e) => { setIdea(e.target.value); setError(""); setTab("novelty"); }} placeholder="例如：用更低成本的单细胞方法识别治疗前肿瘤耐药亚群" /><label className="fieldLabel" htmlFor="constraints">约束条件（可选）</label><input id="constraints" className="largeInput" disabled={formDisabled} value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="经费、样本量、数据来源、周期等" /><div className="actionRow"><button className="primaryButton" disabled={busy || formDisabled || idea.trim().length < 5} aria-busy={busy} onClick={() => scan()}>{busy ? "分析中…" : "检索相似研究"}</button><button disabled={busy || formDisabled || idea.trim().length < 5} aria-busy={busy} onClick={() => generate()}>生成研究设计 →</button></div>{formDraft && <div className="tabDraftNote"><span>设计草稿 · 当前标签页</span><button className="quietButton" type="button" disabled={formDisabled || localBusy} onClick={() => setFormDraft(null)}>还原已保存内容</button></div>}</section>
    {!workspace && !workspaceError && <p className="workspaceLoading" role="status">正在读取研究问题…</p>}
    {(restoringDesign || restoringNovelty) && <p className="workspaceLoading" role="status">正在恢复上次研究结果…</p>}
    {(designError || noveltyError) && <div className="researchError" role="alert">{[noveltyError, designError].filter(Boolean).join("；")} <button className="quietButton" onClick={() => setRestoreAttempt((count) => count + 1)}>重试</button></div>}
    {tab === "canvas" && shownDesign && versionListError && <p className="researchError" role="alert">暂时无法读取版本列表。 <button className="quietButton" onClick={() => setVersionListAttempt((count) => count + 1)}>重试版本列表</button></p>}
    {!!workspace && !idea.trim() && !shownNovelty && !shownDesign && !busy && <section className="startGuide" aria-label="科研设计使用引导"><div className="startGuideIntro"><span>START HERE</span><h2>把一个想法，推进为可核验的研究路径。</h2><p>先填入自己的研究问题。你可以检索相似研究，也可以直接生成设计草稿；两项结果会清楚标注证据范围。</p><div className="sampleIdeas"><b>试一个示例</b>{["如何降低肿瘤单细胞测序的样本与计算成本？", "如何验证候选基因对肿瘤细胞迁移的影响？", "如何研究代谢通路与肿瘤免疫微环境的关系？"].map((sample) => <button key={sample} disabled={running} onClick={() => { setIdea(sample); document.getElementById("idea")?.focus(); }}>{sample} ↗</button>)}</div></div><div className="startGuideSteps"><div><b>01</b><strong>提出问题</strong><small>明确对象、变量与目标</small></div><div><b>02</b><strong>核对相似研究</strong><small>基于摘要做定性扫描</small></div><div><b>03</b><strong>搭建设计草稿</strong><small>检查对照、读数与假设</small></div></div></section>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {taskCanceled && <p className="workspaceLoading" role="status">任务已取消。</p>}
    {/* 阶段文案以服务端为准；可取消，也可以离开本页——任务在服务端继续。 */}
    <JobProgress variant="fixed" title="正在处理研究设计" stageLabel={job?.stage} progress={job?.progress} startedAt={running ? job.startedAt : null} onCancel={cancel} cancelPending={job?.cancelPending} cancelError={job?.cancelError} reconnecting={job?.reconnecting} />
    {(shownNovelty || shownDesign || !!idea.trim()) && <div className="resultBar"><strong>工作区</strong><div className="tabBar" {...workspaceTabs.list} aria-label="工作区视图"><button {...workspaceTabs.item("novelty")}>新颖性扫描</button><button {...workspaceTabs.item("canvas")}>设计沙盘</button></div></div>}
    {/* D10：某个 tab 无数据时给出空态，不留白。 */}
    {tab === "novelty" && !shownNovelty && !!idea.trim() && !busy && !restoringNovelty && !restoringDesign && !noveltyError && <div className="miniNotice">当前想法「{idea.trim()}」尚无检索结果。请点击「检索相似研究」；若检索失败，请稍后重试。</div>}
    {tab === "canvas" && !shownDesign && !!idea.trim() && !busy && !restoringDesign && !designError && <div className="miniNotice">当前想法「{idea.trim()}」尚无设计草稿。点击上方「生成研究设计」即可创建。</div>}
    {tab === "novelty" && shownNovelty && <section className="sectionBox"><h2>{shownNovelty.search_only ? "相关文献星系" : "新颖性扫描"} {!shownNovelty.search_only && <small>整体相似：{shownNovelty.similarity_level}</small>}</h2>{shownNovelty.search_only && <p className="miniNotice">{shownNovelty.search_message} 单一轨道仅表示检索结果，不代表已完成相似程度判断。{!shownNovelty.similar_papers.length && "请调整关键词后重试。"}</p>}<NoveltySpace novelty={shownNovelty} busy={busy} onView={viewWork} onAdd={addWork} />{shownNovelty.search_only && <button type="button" disabled={busy} onClick={() => scan(true)}>重试模型分析</button>}<button className="primaryButton stepForward" disabled={busy} aria-busy={busy} onClick={() => generate()}>{sameDesignInput ? "打开已有方案 →" : "基于这个想法生成方案 →"}</button></section>}
    {tab === "canvas" && shownDesign && <><div className="versionBar"><strong>方案版本 <span>V{displayVersion}</span></strong><div>{scopedVersions.length > 1 && scopedVersions.map((item) => <button className={item.version_id === currentVersion ? "active" : ""} key={item.version_id} disabled={busy} aria-busy={busy} onClick={() => restoreVersion(item)}>V{item.number} · {actionLabels[item.action] || item.action}</button>)}</div>{priorVersion && <button onClick={() => restoreVersion(priorVersion)} disabled={busy} aria-busy={busy}>撤回上一版本</button>}<button onClick={() => generate("generate", undefined, "", true)} disabled={busy} aria-busy={busy}>重新生成方案</button></div><div className="designGrid"><section className="sectionBox designSidebar"><div className="designSideHeader"><span>方案概览</span><h2>设计调整</h2><p title={shownDesign.goal}>{shownDesign.goal}</p></div><div className="designSummary"><b>本版思路</b><p>{shownDesign.change_summary || "当前为方案草稿。"}</p><details><summary>阅读完整说明</summary><p>{shownDesign.change_summary || "当前为方案草稿。"}</p></details></div><div className="designActions"><b>调整方向</b><div className="actionRow">{actions.map(([action, label]) => <button key={action} disabled={busy} aria-busy={busy} onClick={() => generate(action)}>{label}</button>)}</div></div><details className="designDetails"><summary>本次修改 <small>{activeVersion ? activeVersion.changes.added.length + activeVersion.changes.removed.length + activeVersion.changes.modified.length : 0} 项</small></summary><div className="versionChanges">{activeVersion ? <>{activeVersion.changes.added.map((item) => <button key={`a${item}`} onClick={() => openChange(item, "新增")}>＋ {item} ↗</button>)}{activeVersion.changes.removed.map((item) => <button key={`r${item}`} onClick={() => openChange(item, "移除")}>－ {item} ↗</button>)}{activeVersion.changes.modified.map((item) => <button key={`m${item}`} onClick={() => openChange(item, "修改")}>◌ {item} ↗</button>)}</> : "初始方案"}</div></details><details className="designDetails"><summary>对照与评价 <small>{shownDesign.controls.length + shownDesign.readouts.length} 项</small></summary><h4>对照</h4><ul>{shownDesign.controls.map((item, i) => <li key={i}>{item}</li>)}</ul><h4>评价指标</h4><ul>{shownDesign.readouts.map((item, i) => <li key={i}>{item}</li>)}</ul></details><details className="designDetails"><summary>关键假设 <small>{shownDesign.assumptions.length} 项</small></summary><ul>{shownDesign.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details></section><section><DesignFlow design={shownDesign} artifactId={activeVersion?.artifact_id || ""} onSelectNode={setSelectedNode} busy={busy} onExpandNode={(id) => generate("node", id, "为此阶段补充具体实验或分析步骤，逐项说明目的、方法、对照和检测指标；未知信息明确待确定，并保留其他阶段。" )} onAddStep={async (id, step) => { const node = shownDesign.nodes.find(item => item.id === id); if (!node) throw new Error("当前步骤已变化"); await saveStageSteps(id, [...(node.steps || []), step]); }} onRemoveStep={async (id, index) => { const node = shownDesign.nodes.find(item => item.id === id); if (!node) throw new Error("当前步骤已变化"); await saveStageSteps(id, (node.steps || []).filter((_, i) => i !== index)); }} /><p className="miniNotice">具体参数需预实验、功效分析或领域专家核对。</p></section></div>{nodeDetail && <EvidenceDrawer title={nodeDetail.label} eyebrow="研究设计节点" onClose={() => setSelectedNode(null)}><p>{nodeDetail.detail}</p><div className="nodeRelations"><strong>连接逻辑</strong>{shownDesign.edges.filter((edge) => edge.source === nodeDetail.id || edge.target === nodeDetail.id).map((edge, index) => <p key={index}>{edge.label || `${shownDesign.nodes.find((item) => item.id === edge.source)?.label || edge.source} → ${shownDesign.nodes.find((item) => item.id === edge.target)?.label || edge.target}`}</p>)}</div><dl><dt>节点类型</dt><dd>{nodeDetail.type}</dd><dt>版本</dt><dd>V{displayVersion}</dd></dl><label className="fieldLabel">希望怎样修改这个节点？</label><textarea className="largeTextarea" value={nodeInstruction} onChange={(e) => setNodeInstruction(e.target.value)} placeholder="例如：改用成本更低的数据来源，并保持评估目标不变" /><button className="drawerAction" disabled={busy || !nodeInstruction.trim()} aria-busy={busy} onClick={() => generate("node", nodeDetail.id, nodeInstruction)}>AI 优化此节点 →</button></EvidenceDrawer>}{selectedChange && <EvidenceDrawer title={selectedChange.label} eyebrow={`版本差异 · ${selectedChange.kind}`} onClose={() => setSelectedChange(null)}><p>这条记录属于 V{displayVersion} 的版本变化。当前方案中没有同名节点；可切换历史版本查看当时的完整结构。</p></EvidenceDrawer>}</>}
    {tab === "canvas" && shownDesign && activeVersion && <>
      <details className="di-origin">
        <summary>本版本的研究起点与依据</summary>
        {origin?.research_gap && <p><b>研究空白：</b>{origin.research_gap}</p>}
        {!!origin?.selected_papers?.length && <ul>{origin.selected_papers.map((paper) => <li key={paper.paper_id}>{paper.title}</li>)}</ul>}
        {hasOriginNotes && <p>以上为生成方案时带入的综合线索，可据此核对原文。</p>}
        {origin?.synthesis_id
          ? <Link className="quietButton" href={sourceHref(origin.synthesis_id)}>打开本版本的文献综合 ↗</Link>
          : !hasOriginNotes && <p>本版本未记录可用的文献综合依据，请补充并核对依据。</p>}
      </details>
      <DesignStepEditor key={activeVersion.artifact_id} artifactId={activeVersion.artifact_id} design={shownDesign}
        onSaved={() => { void refresh(true).catch(() => setError("新版本已保存，请重新打开页面读取。")); }} />
    </>}
  </PageMain>;
}
