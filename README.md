# MedRead 生物科学科研工作台

Windows 本地运行的前后端分离项目：Next.js + TypeScript、FastAPI、SQLite、PyMuPDF、React-PDF 和 Three.js。

四个入口：**AI 科研发现、AI 深度精读、AI 文献综合、AI 科研设计**，聚焦生命科学与相关医学研究。后端签发 180 天持久匿名 HttpOnly Cookie，按用户隔离 PDF、聊天、阅读进度和结构化研究结果。仅有检索元数据的论文标记为 `metadata_only`，不会被当作全文。

## 安装和启动

在 PowerShell 中进入本目录，执行：

```powershell
.\setup.ps1
```

再打开两个 PowerShell 窗口，分别执行：

```powershell
.\start-backend.ps1
```

```powershell
.\start-frontend.ps1
```

访问 `http://127.0.0.1:3000`。后端健康检查：`http://127.0.0.1:8000/api/health`。启动后 SQLite 数据库在 `backend/data/app.db` 自动创建。

## 百炼配置

`setup.ps1` 从项目根目录的 `.env.example` 复制出 `backend/.env`。服务端从该文件读取：

- `BAILIAN_API_KEY`：百炼工作空间 API Key。
- `BAILIAN_BASE_URL`：该工作空间、地域对应的 OpenAI 兼容 Base URL，以 `/compatible-mode/v1` 结尾。
- `BAILIAN_TEXT_MODEL`：用于文字讲解的模型名称。
- `BAILIAN_VISION_MODEL`：用于 Figure 图像理解的视觉模型名称。
- 可选：`BAILIAN_THINKING_BUDGET`（思考预算，默认留空 = 模型默认，未经质量回归验证不要填）、`PRECOMPUTE_ON_PARSE=1`（解析后自动预生成 X-Ray 与思维导图）、`AI_JOB_DEADLINE_SECONDS` / `AI_MAX_CONCURRENCY` / `AI_MAX_PER_OWNER`（任务层兜底与并发）。
- `OPENALEX_API_KEY`：可选。OpenAlex 匿名共享额度用尽时，可填写自己的免费 OpenAlex Key；只由后端读取。

不要把 Key 放在前端、日志或 Git 中；`backend/.env` 已被 `.gitignore` 排除。改动配置后重启后端。`POST /api/ai/probe` 用 SSE 流式测试真实模型；`GET /api/ai/status` 只返回配置完整性，不返回配置值。若收到 HTTP 401 / `invalid_api_key`，请核对 Key 是否有效、是否与 Base URL 对应同一业务空间。

示例 Base URL 及可用模型名称请以百炼控制台当前工作空间为准；不同地域的地址不能混用。

## 四模块流程

- `/discover`：使用 OpenAlex 语义检索，先从最多 50 篇候选中筛选生命或健康科学主题，再分页展示；也可切换关键词检索。自动分类和候选数量均可能遗漏相关文献。支持加载更多和相似/参考文献图谱。可存入元数据；开放 PDF 可尝试自动获取，出版方返回网页或拒绝下载时改为手动上传。OpenAlex 匿名额度用尽时会显示明确提示。
- `/read`：PDF 上传、逐单元精读、流式问答、论文行文导图和实验导图。获得可解析的全文后，用户手动点击“开始精读”才调用 AI。
- `/synthesis`：选择 2–5 篇已解析全文，生成结构化对比矩阵、证据争议和研究空白。摘要记录不能进入全文综合。
- `/design`：根据 OpenAlex 检索元数据和可用摘要做高/中/低定性新颖性扫描；展示可展开的设计方案与实验流程图，可点击“降低成本”等按钮调整方案。

精读页包含「行文导图」和「实验导图」：前者按研究问题、方法与证据等维度组织内容；后者从论文片段提取候选实验并提供原文线索。两者均需与原文核对，页码可能指向阅读单元的起始页。发现页的关系图改为三向 3D 谱系（上游引用 / 下游被引 / 旁系相关，带方向与年份轴）。

结构化结果保存在 SQLite。Research Workspace 还会保存当前研究主题、领域、选中论文、核心论文、综合结果、研究空白、设计想法和版本引用。四个页面顶部的状态栏共用该上下文；发现页加入对比篮后，综合页自动带入已有全文的论文；研究空白可直接送入科研设计。

发现页的 OpenAlex 搜索页和关系图谱使用 SQLite 缓存。相同查询优先读真实历史结果，显示抓取时间；主动点击“刷新结果”才重新请求。上游暂时失败时，如有缓存会标注过期并回退。缓存仅含公开检索元数据，不把摘要当作全文。

视觉层包括论文行文与实验导图、可展开对比矩阵、Evidence Map、Research Gap Path、定性 Novelty Space 和可展开的设计路线。节点详情尽可能附原文阅读单元、页码和证据片段；未能定位的来源会明确提示。沙盘支持五种整体修改、节点级修改、版本历史、结构差异和回退。

主要 API：`GET/PATCH /api/workspace`、`GET /api/research/discover`、`GET /api/research/graph/{work_id}`、`GET /api/research/lineage/{work_id}`、`POST /api/research/import`、`POST /api/research/import-pdf`、`POST /api/papers/{paper_id}/attach`、`POST /api/research/xray/{paper_id}`、`POST /api/research/compare`、`POST /api/research/novelty`、`POST /api/research/design`、`GET /api/research/design/versions`、`POST /api/research/design/versions/{version_id}/restore`、`GET /api/research/artifacts`。

慢 AI 调用（精读例外，它本身就是流式）统一走异步任务：`POST /api/jobs`、`GET /api/jobs/{job_id}`、`GET /api/jobs/{job_id}/events`（SSE 阶段/进度/心跳）、`DELETE /api/jobs/{job_id}`（取消）。任务在进程内执行并落库，进程重启后可恢复；相同参数的进行中任务会复用，不重复计费。细节见 [docs/architecture-jobs.md](docs/architecture-jobs.md)。

## 阅读流程

进入 `/read`，上传 PDF。上传后显示后端真实解析阶段，完成前不调用 AI。点击“开始精读”或论文目录项后，服务端按当前单元提供原文；“下一部分”和目录跳转才推进阅读位置。提问和快捷追问不推进。Results 优先按主文 Figure，缺少 Figure 时按 Table，再按 Results 正文单元阅读。Figure 根据图注映射实际 PDF 页码并自动跳页；成功将页面图像交给视觉模型且完成回复时标记 `visual_verified=true`，失败则改用正文和图注并在界面提示未视觉核验。无法提取文字的扫描版 PDF 会显示警告，当前版本没有 OCR。

精读开始后即显示等待时间，可取消并保留输入草稿。同一账号对同一篇论文每次只能进行一个讲解请求。取消会断开当前模型流，未生成完整的答复不会写入历史。若取消时完整答复已经保存，重新打开论文即可查看。

第一次访问时后端生成匿名身份并设置约 180 天的 HttpOnly Cookie。正常关闭浏览器后仍可恢复论文、聊天、进度；清除 Cookie、无痕模式或换浏览器视为新用户。请始终使用 `http://127.0.0.1:3000`，不要与 `localhost` 混用。匿名模式不提供跨设备找回。旧测试数据已清理。

AI 讲解规则位于 `backend/app/prompts/reading_rules.md`，可替换为完整 V3 规则。研究类型路由依据标题、摘要和 OpenAlex 学科字段做初步判断；领域或证据不明确时仍需人工核对。当前章节识别采用标题规则，对复杂排版、双栏论文和扫描件可能不完整，使用时需核对原文。

## 测试

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -q
Push-Location frontend
pnpm test
pnpm typecheck
Pop-Location
```

前端生产构建：先停止前端开发服务，进入 `frontend` 后执行 `pnpm build`。本地测试覆盖双用户 Cookie 隔离、180 天有效期、跨浏览器会话恢复、PDF 上传、Figure/Table/Results 兜底、目录跳转、图像输入、视觉降级、安全错误提示、四领域模板、元数据/全文边界、结构化输出校验和远程 PDF 地址限制。运行中的后端可用 `backend\.venv\Scripts\python.exe backend\scripts\smoke_local.py` 做安全的真实连接检查；该脚本只输出状态，不打印 API Key 或模型回答。

当前解析仍依赖 PDF 文字层及规则。没有标准章节标题的长篇综述会尽量按页保留未分类正文，并标注需要核对；并非所有排版都能正确识别。重新识别会保留旧对话和综合结果，但重置当前阅读位置；旧对话与章节的关联会解除，旧综合引用会标记为需要重新核对。双栏、特殊 caption 排版、跨页 Figure、扫描版和正文表格可能识别不准；X-Ray 和论文关系图需核对原文。OpenAlex 的开放 PDF 线索不保证可下载。新颖性扫描只依据检索元数据与可用摘要，不能代替全文查新；概念空间只显示高/中/低分层，不是精确向量距离。研究设计中的成本、样本量和效果没有自动实测。比赛版没有正式账号和跨设备找回。阶段验证记录见 `docs/sprint-report.md`。
