"use client";

import { useEffect, useState } from "react";
import { readManualDesignReceipt, saveManualDesign } from "@/lib/manual-design";
import { readTabDraft, useTabDraft } from "@/lib/tab-draft";
import "./design-insights.css";

type Node = { id: string; label: string; type: string; detail: string };
type Design = { goal: string; change_summary: string; constraints: string[]; nodes: Node[]; edges: { source: string; target: string; label: string }[]; controls: string[]; readouts: string[]; assumptions: string[]; input_constraints?: string };
type EditDraft = { design?: Design; label?: string; detail?: string; parent?: string; requestId?: string };

export default function DesignStepEditor({ artifactId, design, onSaved }: { artifactId: string; design: Design; onSaved: () => void }) {
  const key = `design-steps:${artifactId}`;
  const [stored, setStored] = useTabDraft<EditDraft>(key);
  const [openState, setOpen] = useState<boolean | null>(null);
  const open = openState ?? !!stored;
  const draft = stored?.design ?? design;
  const { label = "", detail = "", parent = "" } = stored ?? {};
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const hasPendingStep = Boolean(label.trim() || detail.trim() || parent);
  const invalidNames = draft.nodes.some((node) => !node.label.trim());
  const canSave = !!stored?.design && !hasPendingStep && !invalidNames;

  useEffect(() => {
    const resumed = readTabDraft<EditDraft>(key)?.requestId;
    if (!resumed) return;
    void readManualDesignReceipt(resumed).then(() => {
      if (readTabDraft<EditDraft>(key)?.requestId === resumed) setStored(null);
    }).catch(() => {});
  }, [key, setStored]);

  function edit(change: EditDraft) {
    const next = { ...readTabDraft<EditDraft>(key), ...change, requestId: undefined };
    setStored(next.design || next.label || next.detail || next.parent ? next : null);
  }
  function add() {
    if (!label.trim() || saving) return;
    const id = `manual-${crypto.randomUUID()}`;
    edit({ design: { ...draft, nodes: [...draft.nodes, { id, label: label.trim(), type: "method", detail: detail.trim() }],
      edges: parent ? [...draft.edges, { source: parent, target: id, label: "用户添加的连接" }] : draft.edges },
      label: "", detail: "", parent: "" });
  }
  function remove(id: string) {
    edit({ design: { ...draft, nodes: draft.nodes.filter((node) => node.id !== id),
      edges: draft.edges.filter((edge) => edge.source !== id && edge.target !== id) },
      parent: parent === id ? "" : parent });
  }
  async function save() {
    if (!canSave || saving) return;
    const requestId = stored?.requestId ?? crypto.randomUUID();
    setStored({ ...stored, requestId });
    setSaving(true); setError("");
    try {
      await saveManualDesign(artifactId, draft, requestId);
      if (readTabDraft<EditDraft>(key)?.requestId === requestId) setStored(null);
      onSaved(); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  return <section className="design-step-editor">
    <button className="dse-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? "收起手动编辑" : stored ? "继续编辑步骤草稿" : "＋ 手动添加或删除实验步骤"}
    </button>
    {open && <div className="dse-body">
      <p>草稿保留在当前标签页。保存后会创建新版本。删除步骤也会移除它的连接。</p>
      {error && <p role="alert" className="di-error">{error}</p>}
      <div className="dse-list">{draft.nodes.map((node) => <div key={node.id}>
        <label className="dse-node-label">步骤名称
          <input aria-label={`步骤名称：${node.label}`} value={node.label} maxLength={200} disabled={saving}
            onChange={(event) => edit({ design: { ...draft, nodes: draft.nodes.map((item) =>
              item.id === node.id ? { ...item, label: event.target.value } : item) } })} />
        </label>
        <button type="button" disabled={saving || draft.nodes.length <= 1} onClick={() => remove(node.id)} aria-label={`删除 ${node.label}`}>删除</button>
      </div>)}</div>
      <label htmlFor="new-step">新步骤名称</label>
      <input id="new-step" value={label} onChange={(event) => edit({ label: event.target.value })} disabled={saving}
        placeholder="例如：公共数据库差异分析" maxLength={200} />
      <label htmlFor="new-detail">目的或操作说明（可选）</label>
      <textarea id="new-detail" value={detail} onChange={(event) => edit({ detail: event.target.value })} disabled={saving} rows={2} maxLength={2000} />
      <label htmlFor="new-parent">连接在已有步骤之后（可选）</label>
      <select id="new-parent" value={parent} onChange={(event) => edit({ parent: event.target.value })} disabled={saving}>
        <option value="">不自动连接</option>
        {draft.nodes.map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}
      </select>
      {(hasPendingStep || invalidNames) && <p>{invalidNames ? "请补全草稿中的步骤名称。" : "请先把填写的新步骤加入草稿。"}</p>}
      <div className="dse-actions">
        <button type="button" disabled={!label.trim() || saving || draft.nodes.length >= 50} onClick={add}>加入草稿</button>
        {hasPendingStep && <button type="button" disabled={saving} onClick={() => edit({ label: "", detail: "", parent: "" })}>清空新步骤</button>}
        <button className="dse-save" type="button" disabled={!canSave || saving} onClick={save}>{saving ? "保存中…" : "保存为新版本"}</button>
        {stored && <button type="button" disabled={saving} onClick={() => { setStored(null); setError(""); }}>还原本版本</button>}
      </div>
    </div>}
  </section>;
}
