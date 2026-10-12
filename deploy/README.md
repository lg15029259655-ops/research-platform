# lunyu-lab.site 测试部署准备

> **历史准备方案（2026-10-09）**：论文平台后来实际部署到了阿里云香港 ECS，`https://lunyu-lab.site` 已上线。下文关于与校园雷达共用中国内地服务器、备案前不得启用站点及“尚未上线”的描述只记录当时的设想，不能作为当前服务器操作指南。改动线上环境前请在阿里云 Workbench 核对实际配置。

此目录只包含部署模板，不包含服务器凭据或正式密钥。2026-10-09 用户截图显示域名命名状态已为“正常”；该状态不等于实名认证或 ICP 备案完成。新网站 ICP 备案完成前，不要把新域名公开解析到中国内地服务器，也不要启用 Nginx 站点。

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

当前项目还没有 Git 仓库或 Linux 发布流水线。模板本身不代表已上线，正式部署前需建立发布通道并完成服务器验收。
