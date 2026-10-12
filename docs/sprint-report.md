# 本轮实施与验收记录

## Sprint 1：科研发现

- 文件：`backend/app/services/openalex_service.py`、`backend/app/services/remote_pdf.py`、`backend/app/research.py`、`frontend/src/app/discover/page.tsx`、`frontend/src/components/CitationGraph.tsx`、首页及共享样式。
- API：`GET /api/research/route`、`GET /api/research/discover`、`GET /api/research/graph/{work_id}`、`POST /api/research/import`、`POST /api/research/import-pdf`、`POST /api/papers/{paper_id}/attach`。
- 验证：真实 OpenAlex 检索得到 10 篇结果；中心论文关系接口得到 13 个节点和 12 条关系；浏览器完成检索、切换图谱与一键打开开放 PDF；`arxiv.org` 的开放 PDF 下载与 15 页解析成功。出版方返回 HTML 时正确拒绝并提示手动上传。后来接入 `search.semantic` 与关键词切换；当日匿名免费额度已用完，语义请求返回 429，已用自动化测试验证参数及友好提示，待额度刷新后做实时复验。

## Sprint 2：文献综合

- 文件：`backend/app/services/research_ai.py`、`backend/app/models.py`、`frontend/src/app/synthesis/page.tsx`。
- API：`POST /api/research/compare`、`GET /api/research/artifacts`。
- 验证：真实百炼完成两篇已上传 PDF 的结构化对比，包含矩阵、共识、差异、争议、空白和下一步；元数据论文和越权论文被拒绝。结果按匿名用户保存在 SQLite。

## Sprint 3：精读视觉层

- 文件：`frontend/src/app/read/page.tsx`、`frontend/src/app/read/enhancements.css`、`backend/app/prompts/reading_rules.md`、`backend/app/services/pdf_service.py`。
- API：`POST /api/research/xray/{paper_id}`。
- 验证：真实百炼返回 Paper X-Ray 的五段结构；阶段引用只保留当前论文真实阅读单元 ID；Figure Storyboard 显示受 owner 校验的原始 PDF 页面缩略图、实际页码和单条视觉讲解的 `visual_verified` 状态。原有精读、Cookie 和视觉降级测试继续通过。

## Sprint 4：科研设计

- 文件：`frontend/src/app/design/page.tsx`、`frontend/src/components/DesignFlow.tsx`、结构化 AI 服务。
- API：`POST /api/research/novelty`、`POST /api/research/design`。
- 验证：真实百炼完成新颖性扫描与设计 JSON 生成；浏览器显示可拖动 React Flow 流程图，“降低成本”按钮触发新结果并更新图。结构化结果持久保存。

## 联调

- 后端测试：见 `backend/tests/test_pdf_flow.py` 与 `backend/tests/test_research.py`，共 11 项通过，涵盖 A/B 匿名用户隔离、元数据/全文边界、生医/计算机/材料/工程/社科模板、结构化输出、远程 PDF 网络限制、语义检索请求、版权说明不误识别为标题、参考文献后的附录 Figure 不进入主文、Figure/Table/Results 正文同时保留。
- 前端：`pnpm build` 类型检查与生产构建通过。浏览器核对四入口首页、OpenAlex 搜索/图谱、文献综合入口、设计沙盘。
- 待继续验证的范围：更多真实多学科 PDF 的章节与 Figure 页码映射；OpenAlex 外部下载随出版方策略可能失效；Router 规则对交叉领域可能误判；AI 输出需要研究者核对。浏览器实测曾发现旧标题讲解越过输入证据补入外部知识，已收紧后续标题提示词，并把后续 AI 历史限制在当前单元；保留用户已有历史，旧消息不会被自动改写。新增的 Results 单元只作用于之后解析的 PDF，已有阅读进度保持原样。

## 下一轮产品化（2026-10-07）

### Phase 1–2：Research Workspace 与流程串联

- SQLite 新增 `research_workspaces`，每个匿名 owner 一条。保存主题、领域、研究类型、核心论文、2–5 篇对比篮、综合结果、研究空白、设计想法、新颖性结果和设计版本引用。
- 四模块顶部显示同一研究主题和进度；发现页选论文进入对比篮，综合页自动带入可用全文；Research Gap 问题可直接送入设计页。Workspace 所有论文和 artifact 引用都做 owner 校验。
- 局部测试：持久恢复、跨用户引用 404、删除论文后清理 Workspace 引用，通过。

### Phase 3–5：视觉层与证据路径

- Paper X-Ray 用 React Flow 呈现研究主线及 Figure/Table/Results 证据支线；Figure Storyboard 改为横向时间线，保留真实 PDF 页缩略图和逐条 `visual_verified`。
- 对比矩阵首行与首列固定，单元格默认收起。Evidence Map 使用支持／不一致／证据不足三列，Research Gap 用逐层路径，并提供证据详情侧栏和原文跳转。可定位的来源保存 paper、unit、section、page、snippet；不能定位则明确提示。
- Novelty Explorer 是高／中／低定性概念空间，不表示精确向量距离。论文详情标记摘要与全文的区别，可加入对比篮。
- 前端构建通过。

### Phase 6–8：沙盘版本、图谱与统一视觉

- 沙盘节点点击后可局部 AI 修改，后端锁定非目标及非下游节点；五种整体修改保留。新增版本表、修改节点差异、历史查看和恢复。回退后再编辑会记录正确父版本。
- 图谱悬停显示标题、年份、期刊、被引次数；右侧详情说明来自 OpenAlex 的“相关”或“参考文献”关系，可重新聚焦。首页四卡增加轻量视觉预览，发现／综合／设计增加步骤式加载提示。
- 路由规则新增临床观察、数值模拟、理论证明和综述／Meta-analysis；仍为启发式识别。

### Phase 9：真实 OpenAlex Demo Cache

- SQLite `discovery_cache` 保存真实查询、模式、页码、结果／关系图谱和抓取时间。相同请求命中缓存；用户明确刷新时重查；上游失败且已有缓存时标记过期回退。新颖性扫描也复用同一查询缓存。
- 自动化测试使用 fake OpenAlex，验证命中、主动刷新和失败回退；没有在单元测试中请求真实 OpenAlex。

### Phase 10：验收结果

- 后端：最终 `15 passed`，仅有当前 Starlette TestClient 对 httpx 的弃用提示。
- 前端：`pnpm build` 生产构建通过。
- 浏览器：实际检查首页、状态栏、发现页搜索、20 篇分页结果、关系图谱及侧栏。真实 OpenAlex 本轮只执行一条完整链路：主题检索第一页、第二页、中心论文关系图；结果与图谱已缓存。浏览器用户同时在操作页面，未在其会话注入测试论文。
- 独立匿名用户真实 AI 联调：两篇公开的肩袖损伤 PDF 上传解析、流式精读、Paper X-Ray、双论文综合、新颖性扫描（OpenAlex 缓存命中）、设计 V1、整体修改 V2、节点局部修改 V3、版本恢复，全部返回成功。测试用户及上传文件已清理；缓存保留。
- 仍需人工核对：本轮没有在同一个浏览器会话逐点完成全部视觉节点点击与 Figure 视觉理解；自动化真实链路验证了对应后端和数据。开放 PDF 下载可能因出版方策略返回 HTML；本轮测试的两篇 PDF 来自 Scientific Reports 公开全文，第二篇需浏览器式 User-Agent 才返回 PDF。跨领域模板和证据推断仍需学科专家核验。
- 补充只读浏览器验收：现有论文的 PDF 分屏、17 页翻页/缩放/搜索工具、Figure Storyboard 原页缩略图，已有全文综合矩阵、Evidence Map、Research Gap Path 和 Novelty Space 均可加载。发现旧综合结果 `controversies=[]` 时三列全空，已改为明确的“证据不足”占位，后续模型提示也要求至少讨论一个可核验命题或说明无法比较。
- 同次验收发现切换 Research Gap 后仍显示旧主题 Novelty 图。现已按 Workspace 的 artifact ID 和研究想法匹配恢复结果；新问题会清除旧设计/新颖性引用，新检索主题会重置当前工作区上下文。对比篮变更会清除过期的综合引用，保留仍待上传 PDF 的选中论文。
- 设计页只读验收还发现旧 AI 沙盘可能给特定疾病问题推荐其他癌种模型。现在生成请求会携带 Workspace 中已保存的 gap、共识、争议及选中论文的全文状态，提示词禁止擅换疾病/人群或编造具体模型。此修正只约束后续生成，旧版本原文不会静默改写，用户仍须核对方案。
