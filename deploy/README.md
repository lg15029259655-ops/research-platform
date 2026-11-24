# lunyu-lab.site 测试部署准备

> **现行正式站（2026-11-23，美国丹佛时间）**：`https://lunyu-lab.site` 指向腾讯云成都轻量云主机 `1.14.126.145`。当前前端发布版本为 `5c4c38f`，运行中的后端沿用 `338e977`。用包含五篇记录及旧阅读位置的会话验证，桌面和手机宽度下论文库默认显示指定三篇。切论文保留当前导图，等目标结果就绪再换。数据库备份位于 `/var/backups/research-platform/before-338e977-20261124T020048Z`，直接回滚版本为 `releases/338e977`。清理两个暂存构建目录及五份已核对本地哈希的重复上传包，释放 1,487 MiB。

> **本轮基础发布（2026-11-23）**：`338e977` 恢复原工作区、两个发现图谱和专题示例，调整按钮和精读导航，补充实验导图并保留切换中的阅读内容。服务器隔离环境验证三份 PDF 哈希、保存的导图和综合与设计指针。更早的 `b06f28a` 发布为独立的预存内容前端。

> **上次正式站（2026-11-23）**：`f8c9b62` 通过独立 `/demo` 路由和 `/var/lib/research-platform/demo-seed-f8c9b62` 提供预生成内容。切换前的备份位于 `/var/backups/research-platform/before-f8c9b62-20261124T002923Z`。

> **上次正式站（2026-11-17）**：通过 OrcaTerm 发布了 `80a9fdf`，当时保留 `runtime-default-v2`。切换前数据备份位于 `/var/backups/research-platform/before-80a9fdf-20261118T044016Z`。以下阿里云内容是较早的部署记录。

> **杭州 ECS 临时 IP 预览（2026-10-18）**：用户明确要求把当天最新版本部署到阿里云杭州免费试用 ECS。已部署 Git 提交 `0edfe1b` 到实例 `i-bp1iot27mz2araj1pct6`（公网 IP `114.55.113.45`）的 `/opt/research-platform/releases/0edfe1b`，`current` 指向该版本。后端、前端、Nginx 的 systemd 服务分别为 `research-platform-backend`、`research-platform-frontend`、`nginx`；SQLite 和上传目录位于 `/var/lib/research-platform`。临时访问地址为 `http://114.55.113.45/`；本机和公网的页面、`/api/health`、`/api/session`、`/api/ai/status` 已验证，服务器端 28 项测试通过，百炼 probe 返回成功。阿里云接入备案与正式域名 HTTPS 尚未办理，本次未改 `lunyu-lab.site` DNS。IP 预览使用 [nginx-ecs-ip-preview.conf](./nginx-ecs-ip-preview.conf)；需要停止预览时运行 `systemctl stop nginx research-platform-frontend research-platform-backend`。

> **备案状态更新（2026-10-15）**：用户提供的控制台截图显示 `lunyu-lab.site` 的 ICP 备案号为 `陕ICP备2026026714号-2`，状态“正常”。另一个域名 `campusradar.site` 的编号为 `陕ICP备2026026714号-1`。详见 [域名备案记录](../docs/domain-filings.md)。用户本次要求暂不部署。

> **历史准备方案（2026-10-09）**：论文平台后来实际部署到了阿里云香港 ECS，`https://lunyu-lab.site` 已上线。下文关于与校园雷达共用中国内地服务器、备案前不得启用站点及“尚未上线”的描述只记录当时的设想，不能作为当前服务器操作指南。改动线上环境前请在阿里云 Workbench 核对实际配置。

此目录只包含部署模板，不包含服务器凭据或正式密钥。2026-10-09 用户截图显示域名命名状态已为“正常”；该状态不等于实名认证或 ICP 备案完成。新网站 ICP 备案完成前，不要把新域名公开解析到中国内地服务器，也不要启用 Nginx 站点。

本地待验收版使用四个原有工作区。默认检索、谱系图和星座视图随前端发布。通过 `DEMO_SEED_DIR` 给新会话加载三篇精读示例、综合、扫描和设计，使用独立数据库和上传目录即可本地预览。运行 `scripts/navigation-smoke.py --prepared-demo` 可验证原有操作入口可用，且默认浏览无需提交任务。

上次校园雷达部署故障及本次防错关口见 [部署复盘](../docs/deployment-retrospective.md)。本机运行 `python deploy/preflight.py`；发布包传到目标 Linux 主机并完成目录、env、venv 准备后，以具备读取生产 env 权限的账号运行 `python3 deploy/preflight.py --server`。检查只读取状态，不修改旧站点；有 `FAIL` 就停止启用新站点。Windows 若 `python` 指向 Microsoft Store，请使用 `backend/.venv/Scripts/python.exe`。

## 部署结构

- 与校园雷达共用主机，但使用独立的系统用户、服务、端口和数据目录。
- Nginx 按域名转发：`/api/` 到 FastAPI `127.0.0.1:8100`，其余到 Next.js `127.0.0.1:3100`。这让匿名会话 Cookie 与前端同源。
- SQLite 和 PDF 位于 `/var/lib/research-platform`，不能放进每次替换的代码发布目录。
- 前端在 Linux CI 构建：`NEXT_PUBLIC_API_URL='' DEPLOY_STANDALONE=1 pnpm build`。复制 `.next/standalone` 到发布目录的 `frontend/`，并将 `.next/static` 复制到 `frontend/.next/static`。Windows 本地普通构建不启用 standalone。
- 后端单进程运行；生产配置从 `/etc/research-platform/backend.env` 读取，不提交真实 Key。

## 服务器启用前检查

1. 域名已备案，DNS 指向当前服务器，且 Nginx 现有校园雷达配置保持独立。
2. 建立 `researchplatform` 运行用户、`/opt/research-platform` 发布目录、`/var/lib/research-platform/uploads` 数据目录和 Python 虚拟环境。配置文件只有管理员可读。
3. 安装两个 systemd 服务，先在服务器本机访问 `127.0.0.1:8100/api/health` 与 `127.0.0.1:3100`；记录服务内存峰值。新站点启用前和启用后都要确认校园雷达健康。
4. 安装独立 Nginx 站点，运行 `nginx -t` 后重载；签发 HTTPS 证书并确认 HTTP 自动跳转 HTTPS。
5. 验证登录态、PDF 上传与解析、OpenAlex 检索、百炼流式讲解；随后进行 2–3 人同时使用的测试。检查两个新服务与校园雷达服务均无 OOM 或重启。
6. 对 SQLite 使用在线备份 API，连同上传目录定期备份；测试一次恢复。限制访问范围和 AI 调用频率，避免测试链接被滥用。

## 数据备份和恢复

为数据库和 PDF 取得同一时点的数据，先停止写入该数据目录的后端进程，并等待上传、解析和后台任务交接完成。确认 `DATABASE_URL` 和 `UPLOAD_DIR` 对应实际存储路径。在 Linux 上使用项目虚拟环境的 Python，Windows 上使用 `backend/.venv/Scripts/python.exe`。

```text
python backend/scripts/backup_data.py backup <实际数据库> <实际上传目录> <新备份目录>
python backend/scripts/backup_data.py restore <备份目录> <新恢复目录>
```

目标父目录须已存在。脚本检查 SQLite 完整性和数据库引用的文件，并将快照发布为新目录。备份内的 PDF 和图片路径是相对路径；恢复时脚本把它们转换为恢复目录下的绝对路径。数据库内已丢失的文件会使备份失败，应先核对报告中的记录并处理。备份含会话、论文和对话记录，请保存在访问受限的目录。

演练时为独立后端设置 `DATABASE_URL` 指向恢复目录的 `app.db`，`UPLOAD_DIR` 指向恢复目录的 `uploads`。使用原会话在隔离实例打开原 PDF，核对对话、阅读进度、综合结果与设计历史，再用其他会话验证访问隔离。部署切换还需要确认配置和运行用户权限。代码、运行配置和示例素材目录需要单独备份。
