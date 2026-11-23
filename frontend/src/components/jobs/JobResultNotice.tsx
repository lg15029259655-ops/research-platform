export default function JobResultNotice({ failed, onRetry, onDismiss }: {
  failed: boolean; onRetry: () => void; onDismiss: () => void;
}) {
  if (!failed) return <p className="workspaceLoading" role="status">正在读取已保存的结果…</p>;
  return <div className="researchError" role="alert">
    <p>结果已保存，暂时无法读取。</p>
    <div className="actionRow">
      <button type="button" className="quietButton" onClick={onRetry}>重试打开结果</button>
      <button type="button" className="quietButton" onClick={onDismiss}>稍后查看</button>
    </div>
  </div>;
}
