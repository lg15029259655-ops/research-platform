# 功能测试报告（2026-11-16）

> 被测对象：本机运行的新版 MedRead（`frontend` 生产构建 + `backend` uvicorn，端口 3000 / 8000）
> 环境：macOS，Python 3.12，Node 24；**未配置百炼 API Key**（`/api/ai/status` → 未配置）
> 结论：**67 项接口级检查全部通过；后端 83 个单测全绿；前端类型检查 0 error；构建成功；服务端日志无 500/Traceback。**
> 限制：本机没有可用的浏览器自动化（Chrome 未安装，Safari 远程自动化未开启），**客户端点击交互与 3D/导出效果未做自动化验证**，需要人工点一遍；AI 功能因无 Key 只能验证"失败路径可读"，真实模型输出未验证。

---

## 1. 测试范围与结果

### 1.1 基础与身份

| 功能 | 结果 | 备注 |
|---|---|---|
| `GET /api/health` | ✅ | DB ok |
| 匿名会话（Cookie 180 天） | ✅ | 两个独立 Client 隔离正确 |
| `GET /api/ai/status` | ✅ | 正确返回未配置项 |
| CORS 预检（3000 → 8000） | ✅ | 允许 credentials + 指定 origin |

### 1.2 论文库与 PDF 流程

| 功能 | 结果 | 备注 |
|---|---|---|
| 上传 + 同步解析 | ✅ | 合成 PDF 79 ms；真实 23–30 页论文此前实测 0.24–0.40 s |
| 论文列表 / 详情（units） | ✅ | 10 个阅读单元，Figure 识别正确 |
| `manifest` / `status` | ✅ | |
| PDF 文件下发 `/file` | ✅ | 返回 `%PDF-` |
| 页面缩略图 `/pages/1/thumbnail` | ✅ | 27 KB PNG |
| PDF 内文字搜索 | ✅ | 命中文 |
| 重新解析 `reparse` | ✅ | 完成后阅读记录仍可读 |
| 非 PDF 上传 | ✅ | 400「文件内容不是有效的 PDF」 |
| 元数据论文的 PDF/缩略图 | ✅ | 422，提示先上传全文 |

### 1.3 研究工作区

| 功能 | 结果 |
|---|---|
| 读取 / 写入（主题、对比篮、gap_context） | ✅ |
| 引用不存在的论文 | ✅ 404 |
| 上下文超长 | ✅ 422 |

### 1.4 异步任务层（本次改造的核心）

| 任务 | 结果 | 备注 |
|---|---|---|
| `mindmap` | ✅ | 无 AI Key 时返回确定性骨架，0 s（缓存命中）；二次提交复用同一 artifact |
| `experiment`（实验流程） | ✅ | 模板兜底：5 阶段 19 节点，分类全部合法；短 goal → `invalid_params`；超长 goal → `invalid_params`（本轮修复） |
| `xray` | ✅ | 无 Key → `ai_failed`「AI 模型尚未配置」；论文不存在 → `invalid_state`；缺参数 → `invalid_params`（本轮修复） |
| `compare` | ✅ | 无 Key → 可读失败；少于两篇 → `invalid_params`；不产生 504/500 |
| 未知任务类型 | ✅ 422 |
| 缺参数（xray/mindmap） | ✅ `invalid_params`「缺少论文参数」（本轮修复） |
| SSE `/events` | ✅ | 返回 `snapshot` + 终态 `result`，含 15s 心跳机制 |
| 跨用户读取/取消任务 | ✅ 404 |
| 任务快照字段 | ✅ | status/stage/stage_label/progress/result/error |

### 1.5 文献发现与谱系（OpenAlex）

| 功能 | 结果 | 备注 |
|---|---|---|
| 关键词检索 | ✅ | 10 条，1.9 s |
| 检索缓存命中 + 缓存回放 | ✅ | `cached=true`；未缓存查询 → 404 |
| 文献谱系 `/api/research/lineage/{id}` | ✅ | 57 节点 / 56 边，角色齐全（center/reference/related/cited_by），边方向合法，6.8 s（首次） |
| 旧关系图谱 `/graph/{id}`（星座视图） | ✅ | 2.6 s |
| 非法 work id | ✅ | 503 可读提示 |
| 导入 metadata_only + 删除 | ✅ | 导入后导图任务可读失败（`invalid_state`） |

### 1.6 产物与版本

| 功能 | 结果 |
|---|---|
| `artifacts?kind=paper_mindmap` / `experiment_workflow` | ✅ |
| 设计版本列表 / 恢复不存在版本 | ✅ 200 / 404 |

### 1.7 删除与级联

| 功能 | 结果 |
|---|---|
| 删除论文 → 再访问 404 | ✅ |
| 论文库清空 | ✅ |
| 相关 artifact / 工作区引用随删除清理 | ✅（跨用户隔离场景同时验证） |

### 1.8 前端

| 检查 | 结果 |
|---|---|
| 5 个页面 HTTP 200（/、/discover、/read、/synthesis、/design） | ✅ |
| 生产构建（`pnpm build`） | ✅ 通过；`/design` 14.6 kB |
| `tsc --noEmit` | ✅ 0 error |
| 构建产物包含新功能（`实验流程`、`思维导图`、`/icons/experiments`） | ✅ |
| 图标占位路径（图片未放时 404 走占位框） | ✅ 预期行为 |

### 1.9 后端单测

`pytest -q` → **83 passed**（原 71 + 实验流程 12），覆盖任务层、思维导图、谱系、流式事件与本次新增任务。

---

## 2. 发现的问题与处理

| # | 问题 | 严重度 | 处理 |
|---|---|---|---|
| 1 | **本地前端构建把 API 基址打成了空串**（之前按部署方式用 `NEXT_PUBLIC_API_URL=''` 构建），但本地是 3000 直连、没有 nginx 反代 → 浏览器里所有请求都打到 3000 自己，全部 404；页面能打开但功能全不可用 | **高** | 已修：新增 `frontend/.env.local`（gitignore）指定 `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000` 并重新构建。**部署仍按 `NEXT_PUBLIC_API_URL=''` + nginx 同源**，不受影响 |
| 2 | **macOS 系统代理（Clash 127.0.0.1:7890）被 httpx 自动读取** → OpenAlex 走代理共享出口 IP，免费额度耗尽 → 文献发现/谱系图 429，页面显示"额度暂时耗尽" | **高（仅本机环境）** | 已绕过：`backend/.env` 增加 `NO_PROXY=api.openalex.org`。Linux 服务器无系统代理，不受影响；若部署机也走代理，需在 `/etc/research-platform/backend.env` 加同样一行 |
| 3 | 任务缺参数（`xray`/`mindmap` 不带 `paper_id`）时返回 `internal/任务执行失败`，错误不可读 | 低 | 已修：改为 `invalid_params/缺少论文参数`；实验流程 goal/constraints 增加 1500 字上限 |
| 4 | 未配置百炼 Key → 精读、X-Ray、综合、新颖性、设计均不可用（返回可读 503/任务失败），仅思维导图骨架与实验流程模板可用 | 预期 | 在 `backend/.env` 填 `BAILIAN_API_KEY` / `BAILIAN_BASE_URL` 后重启即可；不影响非 AI 功能测试 |
| 5 | 浏览器端点击交互、3D 谱系渲染、导图/流程图导出未做自动化验证 | 待验证 | 本机无可自动化浏览器；需人工点一遍（建议重点看：发现页图谱 tab、精读页思维导图 tab、设计页实验流程 tab、导出按钮） |

> 除上表外，**未发现接口层 500、未发现跨用户越权、未发现删除级联残留、未出现 504**（任务层改造目标达成）。

---

## 3. 复现方式

```bash
# 后端单测
DATABASE_URL=sqlite:////tmp/t.db UPLOAD_DIR=/tmp/t_uploads \
  /tmp/rp_venv/bin/python -m pytest -q            # 83 passed

# 接口级检查（两个脚本共 67 项）
/tmp/rp_venv/bin/python /tmp/e2e_test.py          # 47/47
/tmp/rp_venv/bin/python /tmp/e2e_round2.py        # 20/20
```

服务地址：前端 `http://127.0.0.1:3000`，后端 `http://127.0.0.1:8000`。
