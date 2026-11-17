# 异步 AI 任务层与延迟治理

## 为什么有这一层

实测（2026-11）：精读一次"开始精读"要 28 秒才出现第一个正文字，X-Ray / 综合在
35 秒墙钟超时处直接返回 504，新颖性 15 秒超时后静默降级成"只有文献列表"，设计
18 秒超时后返回通用草稿。

根因不是模型慢，而是**把长任务放在 HTTP 请求的关键路径上，并用固定墙钟杀它**。
因此引入任务层：提交与执行分离，进度可见，结果落库，超时只做兜底。

## 结构

```
backend/app/jobs/
├── router.py     # POST /api/jobs, GET /{id}, GET /{id}/events (SSE), DELETE /{id}
├── worker.py     # 进程内队列、并发上限、deadline、取消、JobContext
├── store.py      # ai_jobs 表读写：去重、阶段、进度、结果、错误
├── events.py     # 内存事件总线（SSE 订阅）
├── sse.py        # SSE 编码 + 心跳包装（15s 无输出补 `: ping`）
├── handlers.py   # 把 research.execute_* / mindmap 注册成任务
└── precompute.py # 解析后预生成（PRECOMPUTE_ON_PARSE=1 才启用）
```

## 接口契约

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/jobs` | body `{kind, params}`；进行中同参数任务会复用（不重复计费） |
| GET | `/api/jobs/{id}` | 快照：`status/stage/stage_label/progress/result/error` |
| GET | `/api/jobs/{id}/events` | SSE：`snapshot` → `stage`/`progress` → `result`/`error`，附 15s 心跳 |
| DELETE | `/api/jobs/{id}` | 取消（前端离开页面/切论文时调用） |

任务类型：`xray`（paper_id）、`compare`（paper_ids）、`novelty`（query）、
`design`（goal/constraints/action/...）、`mindmap`（paper_id）。

## 质量约束（不允许用降低分析质量换速度）

1. 模型与思考模式不变：`enable_thinking` 只在既有 `fast_structured` 任务上关闭，
   `thinking_budget` 默认 `None`（= 模型默认）。若要用它提速，必须先过质量回归集。
2. 证据校验只增不减：结构化任务仍走同一套 `unit_id` / 逐字引用校验；思维导图新增
   节点校验（无效 `unit_id` 丢弃）。
3. 旧同步端点保留（`/api/research/xray` 等），行为与超时策略不变；新前端走任务层。

## 配置

当前任务队列与并发限制是**进程内**的，部署时只能启动一个后端工作进程；不要让两个后端实例同时连接同一任务数据库。多进程部署需要持久租约和防重复提交机制，目前尚未实现。服务正常重启时，未完成的 AI 任务会重新排队；重新执行可能再次调用模型，已有结果仍需核对。PDF 解析仍使用独立的后台处理，不具备同样的重启恢复保证。

启动时按原提交时间恢复排队中的任务，清除上次执行的进度，并直接结束已收到取消请求的任务。SSE 按客户端读取速度发送，每条连接最多等待一条后续消息。任务事件缓冲仍有容量上限，断线后可通过状态接口读取已保存的结果。

| env | 默认 | 作用 |
|---|---|---|
| `AI_JOB_DEADLINE_SECONDS` | 600 | 任务级兜底 deadline（不再是 15/35s） |
| `AI_MAX_CONCURRENCY` | 2 | 全局同时执行的 AI 任务数 |
| `AI_MAX_PER_OWNER` | 1 | 单用户并发（避免一人占满配额） |
| `BAILIAN_THINKING_BUDGET` | 空（不限制） | 思考预算；仅在回归集验证后启用 |
| `PRECOMPUTE_ON_PARSE` | 空 | 设为 1 后，解析完成自动预生成 X-Ray + 思维导图 |

## 前端

`frontend/src/lib/jobs.ts` 封装 SSE + 轮询降级；`components/jobs/JobProgress.tsx`
统一显示阶段、已等待秒数、取消；精读页新增"思考轨迹"（`type: "thinking"` 帧）。

## 测试

- `backend/tests/test_jobs.py`：提交/去重/取消/失败/跨用户隔离/SSE 终态
- `backend/tests/test_mindmap.py`：骨架确定性、标注校验、缓存、AI 失败回退
- `backend/tests/test_lineage.py`：三向关系、边方向、被引缺失时的降级
- `backend/tests/test_ai_streaming.py`：reasoning/content 分流、请求体开关、进度节流
