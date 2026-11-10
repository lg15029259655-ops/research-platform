"""异步 AI 任务层。

设计要点见 docs/architecture-jobs.md：
- 提交与执行分离：HTTP 只提交任务并订阅进度，worker 在进程内执行模型调用。
- 任务落库（ai_jobs），进程重启后可恢复；结果仍写 research_artifacts。
- 订阅走内存事件总线 + SSE，并定期心跳，避免"看起来卡死"。
"""
