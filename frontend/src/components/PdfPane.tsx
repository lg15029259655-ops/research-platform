"use client";

import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { API, ApiError, apiJson } from "@/lib/api";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

class PdfErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type SearchHit = { page: number; snippet: string };
type SearchState = { status: "idle" | "pending" } | { status: "ready"; hits: SearchHit[] } | { status: "error"; message: string };

export default function PdfPane({ paperId, fileVersion, page, totalPages, onPageChange }: {
  paperId: string; fileVersion?: string | null; page: number; totalPages?: number; onPageChange: (page: number) => void;
}) {
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [availableWidth, setAvailableWidth] = useState(500);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [documentAttempt, setDocumentAttempt] = useState(0);
  const searchRequest = useRef<AbortController | null>(null);
  const options = useMemo(() => ({ withCredentials: true }), []);
  useEffect(() => {
    setPages(0); setQuery(""); setSearchState({ status: "idle" }); setZoom(1); setFitWidth(true);
    return () => { searchRequest.current?.abort(); searchRequest.current = null; };
  }, [paperId, fileVersion]);
  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setAvailableWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (canvasRef.current) canvasRef.current.scrollTop = 0; }, [page]);

  function editQuery(value: string) {
    searchRequest.current?.abort();
    searchRequest.current = null;
    setQuery(value);
    setSearchState({ status: "idle" });
  }

  async function search() {
    const term = query.trim();
    if (!term || searchRequest.current) return;
    if (term.length < 2) {
      setSearchState({ status: "error", message: "请输入至少两个字符。" });
      return;
    }
    const controller = new AbortController();
    searchRequest.current = controller;
    const timeout = AbortSignal.timeout(10000);
    setSearchState({ status: "pending" });
    try {
      const hits = await apiJson<SearchHit[]>(`/api/papers/${encodeURIComponent(paperId)}/search?q=${encodeURIComponent(term)}`, {
        signal: AbortSignal.any([controller.signal, timeout]),
      });
      if (controller.signal.aborted) return;
      setSearchState({ status: "ready", hits });
      if (hits[0]?.page) onPageChange(hits[0].page);
    } catch (error) {
      if (!controller.signal.aborted) setSearchState({
        status: "error", message: timeout.aborted ? "PDF 搜索超时，可以重试。"
          : error instanceof ApiError ? error.message : "连接中断，可以重试搜索。",
      });
    } finally {
      if (searchRequest.current === controller) searchRequest.current = null;
    }
  }
  const count = pages || totalPages || 0;
  const fileUrl = `${API}/api/papers/${encodeURIComponent(paperId)}/file${fileVersion ? `?v=${encodeURIComponent(fileVersion)}` : ""}`;
  const searching = searchState.status === "pending";
  const documentError = <div className="pdfError" role="alert">PDF 暂时无法显示。 <button type="button" className="quietButton"
    onClick={() => setDocumentAttempt((attempt) => attempt + 1)}>重试打开 PDF</button></div>;
  return <div className="pdfPane">
    <div className="pdfToolbar">
      <div className="pageTools">
        <button type="button" aria-label="上一页" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>‹</button>
        <span>{page} / {count || "…"}</span>
        <button type="button" aria-label="下一页" onClick={() => onPageChange(Math.min(count, page + 1))} disabled={page >= count}>›</button>
        <button type="button" aria-label="缩小 PDF" onClick={() => setZoom(Math.max(.65, zoom - .15))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="放大 PDF" onClick={() => setZoom(Math.min(2.5, zoom + .15))}>＋</button>
        <button type="button" aria-pressed={fitWidth} className={fitWidth ? "fitActive" : ""} onClick={() => { setFitWidth(!fitWidth); setZoom(1); }} title="切换适应宽度与原始宽度">适宽</button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <input value={query} onChange={(event) => editQuery(event.target.value)} placeholder="搜索 PDF 文字" aria-label="在 PDF 内搜索文字" />
        <button type="submit" disabled={searching || !query.trim()} aria-busy={searching}>{searchState.status === "error" && query.trim().length >= 2 ? "重试搜索" : "搜索"}</button>
      </form>
    </div>
    {searching && <p className="pdfSearchStatus" role="status">正在搜索 PDF…</p>}
    {searchState.status === "ready" && <>
      <p className="pdfSearchStatus" role="status">{searchState.hits.length === 30 ? "显示前 30 个匹配页面" : searchState.hits.length ? `找到 ${searchState.hits.length} 个匹配页面` : "没有找到匹配文字。"}</p>
      {!!searchState.hits.length && <div className="searchHits">{searchState.hits.map((hit) =>
        <button type="button" key={hit.page} onClick={() => onPageChange(hit.page)}>第 {hit.page} 页 · {hit.snippet.slice(0, 80)}</button>)}</div>}
    </>}
    {searchState.status === "error" && <div className="pdfError" role="alert">{searchState.message}</div>}
    <div className="pdfCanvas" ref={canvasRef}>
      <PdfErrorBoundary key={`${fileUrl}:${documentAttempt}`} fallback={documentError}>
        <Document file={fileUrl} options={options}
          onLoadSuccess={({ numPages }) => setPages(numPages)} error={documentError} loading="正在打开 PDF…">
          <Page pageNumber={Math.max(1, Math.min(count || page, page))} width={fitWidth ? Math.min(availableWidth, 850) : 650} scale={zoom} loading="正在渲染页面…" />
        </Document>
      </PdfErrorBoundary>
    </div>
  </div>;
}
