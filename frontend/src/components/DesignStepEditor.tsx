"use client";

import { useEffect, useState } from "react";
import { postJson } from "@/lib/api";
import "./design-insights.css";

type Node = { id: string; label: string; type: string; detail: string };
type Design = { goal: string; change_summary: string; constraints: string[]; nodes: Node[]; edges: { source: string; target: string; label: string }[]; controls: string[]; readouts: string[]; assumptions: string[]; input_constraints?: string };
type Version = { version_id: string; number: number; action: string; artifact_id: string; payload: Design; changes: { added: string[]; removed: string[]; modified: string[] } };

export default function DesignStepEditor({ artifactId, design, onSaved }: { artifactId: string; design: Design; onSaved: (design: Design, version: Version) => void }) {
  const [draft, setDraft] = useState(design);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [parent, setParent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(design); setOpen(false); setLabel(""); setDetail(""); setParent(""); setError(""); }, [artifactId, design]);
  function add() {
    if (!label.trim()) return;
    const id = `manual-${crypto.randomUUID()}`;
    setDraft(d => ({ ...d, nodes: [...d.nodes, { id, label: label.trim(), type: "method", detail: detail.trim() }],
      edges: parent ? [...d.edges, { source: parent, target: id, label: "用户添加的连接" }] : d.edges }));
    setLabel(""); setDetail(""); setParent("");
  }
  function remove(id: string) {
    setDraft(d => ({ ...d, nodes: d.nodes.filter(n => n.id !== id), edges: d.edges.filter(e => e.source !== id && e.target !== id) }));
    if (parent === id) setParent("");
  }
  async function save() {
    setSaving(true); setError("");
    try {
      const result = await postJson<{payload: Design; version: Version}>("/api/research/design/manual", { artifact_id: artifactId, design: draft });
      onSaved(result.payload, result.version); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  return <section className="design-step-editor"><button className="dse-toggle" type="button" onClick={() => setOpen(!open)}>{open ? "收起手动编辑" : "＋ 手动添加或删除实验步骤"}</button>{open && <div className="dse-body"><p>修改只保存在草稿中；点击保存后创建新版本。删除步骤会同时移除它的连接。</p>{error && <p role="alert" className="di-error">{error}</p>}<div className="dse-list">{draft.nodes.map(n => <div key={n.id}><label className="dse-node-label">步骤名称<input aria-label={`步骤名称：${n.label}`} value={n.label} maxLength={200} onChange={e => setDraft(d => ({ ...d, nodes: d.nodes.map(item => item.id === n.id ? { ...item, label: e.target.value } : item) }))} /></label><button type="button" disabled={saving || draft.nodes.length <= 1} onClick={() => remove(n.id)} aria-label={`删除 ${n.label}`}>删除</button></div>)}</div><label htmlFor="new-step">新步骤名称</label><input id="new-step" value={label} onChange={e => setLabel(e.target.value)} placeholder="例如：公共数据库差异分析" maxLength={200} /><label htmlFor="new-detail">目的或操作说明（可选）</label><textarea id="new-detail" value={detail} onChange={e => setDetail(e.target.value)} rows={2} maxLength={2000} /><label htmlFor="new-parent">连接在已有步骤之后（可选）</label><select id="new-parent" value={parent} onChange={e => setParent(e.target.value)}><option value="">不自动连接</option>{draft.nodes.map(n => <option value={n.id} key={n.id}>{n.label}</option>)}</select><div className="dse-actions"><button type="button" disabled={!label.trim() || saving || draft.nodes.length >= 50} onClick={add}>加入草稿</button><button type="button" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存为新版本"}</button></div><p>新增步骤需要由研究者核对；保存后可使用“方案检查”重新评估。</p></div>}</section>;
}
