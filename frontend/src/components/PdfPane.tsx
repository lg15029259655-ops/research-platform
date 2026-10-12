"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { API } from "@/lib/api";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export default function PdfPane({ paperId, page, totalPages, onPageChange }: { paperId: string; page: number; totalPages?: number; onPageChange: (page: number) => void }) {
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [availableWidth, setAvailableWidth] = useState(500);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ page: number; snippet: string }[]>([]);
  const [error, setError] = useState("");
  const options = useMemo(() => ({ withCredentials: true }), []);
  useEffect(() => { setPages(0); setHits([]); setError(""); setZoom(1); setFitWidth(true); }, [paperId]);
  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.max(240, Math.floor(entry.contentRect.width) - 36)));
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);
  async function search() {
    if (!query.trim()) return;
    const res = await fetch(`${API}/api/papers/${paperId}/search?q=${encodeURIComponent(query.trim())}`, { credentials: "include" });
    if (!res.ok) { setError("PDF 搜索失败"); return; }
    const data = await res.json(); setHits(data);
    if (data[0]?.page) onPageChange(data[0].page);
  }
  const count = pages || totalPages || 0;
  return <div className="pdfPane"><div className="pdfToolbar"><div className="pageTools"><button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>‹</button><span>{page} / {count || "…"}</span><button onClick={() => onPageChange(Math.min(count, page + 1))} disabled={page >= count}>›</button><button onClick={() => setZoom(Math.max(.65, zoom - .15))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(Math.min(2.5, zoom + .15))}>＋</button><button className={fitWidth ? "fitActive" : ""} onClick={() => { setFitWidth(!fitWidth); setZoom(1); }} title="切换适应宽度与原始宽度">适宽</button></div><form onSubmit={(e) => { e.preventDefault(); search(); }}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索 PDF 文字" /><button>搜索</button></form></div>{hits.length > 0 && <div className="searchHits">{hits.map((hit, i) => <button key={i} onClick={() => onPageChange(hit.page)}>第 {hit.page} 页 · {hit.snippet.slice(0, 80)}</button>)}</div>}{error && <div className="pdfError">{error}</div>}<div className="pdfCanvas" ref={canvasRef}><Document file={`${API}/api/papers/${paperId}/file`} options={options} onLoadSuccess={({ numPages }) => setPages(numPages)} onLoadError={() => setError("PDF 无法显示，请检查本地后端") } loading="正在打开 PDF…"><Page pageNumber={Math.max(1, Math.min(count || page, page))} width={fitWidth ? Math.min(availableWidth, 850) : 650} scale={zoom} loading="正在渲染页面…" /></Document></div></div>;
}
