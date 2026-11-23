export default function Loading() {
  return <main id="main" className="researchPage routeLoading" tabIndex={-1} aria-busy="true">
    <p className="workspaceLoading" role="status">正在打开页面…</p>
  </main>;
}
