# 前端协作交接

## 当前状态

- 前端是 Next.js，源码在 `frontend/src/app` 和 `frontend/src/components`；后端是 FastAPI。
- 前端访问 `/api`，线上由 Nginx 转发到后端。生产构建使用 `NEXT_PUBLIC_API_URL=''`。
- 论文平台已在**阿里云香港 ECS**上线，域名是 `https://lunyu-lab.site`；校园雷达使用的是另一台腾讯云服务器，两者不要混淆。
- 本地项目已关联私有 GitHub 仓库 `lg15029259655-ops/research-platform`，`main` 已推送；目前没有自动发布流水线。现有 `deploy/` 文件主要是早期准备时写的模板，不能当作线上实际部署状态。线上前端由 `research-platform-frontend.service` 从 `/opt/research-platform/current/frontend` 启动；`current` 指向一个带时间戳的发布目录。

## 推荐分工

同学负责页面布局、视觉、交互与响应式适配；尽量只修改 `frontend/`。确需改变接口时，先列出接口需求，由项目负责人同步后端。不要修改 `backend/data/`、生产环境文件、部署服务或线上数据库。

日常协作建议使用项目负责人名下的**私有 GitHub 仓库**：同学在自己的分支开发，提交 Pull Request；项目负责人检查页面、构建结果和改动范围后合并，再发布到 `lunyu-lab.site`。当前线上仍采用阿里云 Workbench 手动发布，GitHub 推送或合并**不会自动更新网站**。首次自动发布流程须另行配置和验证。

如果私有仓库建在个人 GitHub 账号下，受邀协作者通常具有写入权限，可能直接推送主分支；“先 Pull Request 再合并”需要双方遵守。GitHub Free 私有仓库不能依赖分支保护来强制审核。线上发布入口仍由项目负责人掌握，同学无需阿里云主账号。

一次改动的顺序：同学创建分支 → 修改 `frontend/` → 本地检查并提交 Pull Request（附桌面、手机截图）→ 项目负责人审查并运行 `pnpm build` → 合并 → 按现有带回退的发布流程更新 ECS → 打开线上四个入口核对。

## 本地运行与检查

在项目根目录运行 `./setup.ps1`（首次安装），然后分别运行 `./start-backend.ps1` 和 `./start-frontend.ps1`。网页地址是 `http://127.0.0.1:3000`。仅修改视觉时可使用现有后端，调接口前核对 `frontend/src/lib/api.ts`。提交前在 `frontend/` 运行 `pnpm build`，并至少检查桌面和手机宽度下的四个功能入口。

## API Key 与比赛材料

- 前端开发**不需要**生产 API Key：浏览器调用后端，后端从环境文件读取 Key。
- 线上 Key 应只放在 ECS 后端环境配置中。`/etc/research-platform/backend.env` 是本地部署模板规定的路径，交接前应在 ECS 上确认实际路径；不要把 Key 写入前端代码或 Git 仓库。
- 如果组委会要求在提交材料中提供 Key 做二次验证，单独创建一个**比赛复核用 Key**；平台支持时再设置额度、有效期或使用范围，通过组委会指定的非公开提交渠道交付。赛后停用或轮换这个 Key。不要直接提交线上正在使用的 Key。
- `.env.example` 和 `deploy/backend.env.example` 只填写变量名和示例模型，不填写真实 Key。

## 让同学自行发布需要先完成

1. 在阿里云 Workbench 中核对这台香港 ECS 上的前端发布目录、服务名、维护账号和现有发布方式；不要依据本地 `deploy/README.md` 猜测线上状态。
2. 私有仓库已建立并推送代码，同学邀请已由项目负责人发出；`.env`、`backend/data/`、上传 PDF、`node_modules/`、`.next/` 已排除在版本控制外。同学接受邀请后即可克隆仓库。
3. 配置只构建和替换前端的发布流程，服务器连接凭据由项目负责人保管在发布系统中。发布流程不读取或修改后端 Key、数据库和上传目录。
4. 先在预览环境或本机验证，再用一版小改动试发布；确认域名、四个页面和 `/api/health` 正常，保留上一版以便回退。

在发布入口配置完成前，同学可以独立开发并提交前端代码，但**不能仅凭网页链接上传改动**。如果赶时间，可先为同学创建独立、限定权限的 ECS 账号，通过 Workbench 发布前端；长期更适合用固定发布流程，由同学提交并触发构建、部署。Next.js 需要在 Linux 环境构建并重启前端服务，并非把页面文件直接上传到域名。
