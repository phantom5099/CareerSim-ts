# CareerSim TS

CareerSim 的 TypeScript 实现，目标运行时是 Qoder Sites：

- 前端：Vue 3 + Vite + TypeScript，构建为静态文件。
- 后端：单个 Deno Edge Function，部署到 Qoder Sites。
- 数据：Qoder Sites 托管数据库与 Storage。
- 需求基线：[CareerSim issue #8](https://github.com/phantom5099/CareerSim/issues/8)。

Rust 版本保留在 [phantom5099/CareerSim](https://github.com/phantom5099/CareerSim)，本仓库用于 Qoder Sites 部署与竞赛交付。

## 目录

```text
web/          Vue 前端
functions/    Deno Edge Function
migrations/   托管数据库 SQL
shared/       前后端共享类型与 API 契约
```

## 本地开发

```bash
cd web
bun install
bun run dev
```

前端固定端口 `5175`，`/functions/v1/app` 代理到本地 `http://127.0.0.1:8000`。

Edge Function 可用 Deno 本地运行：

```bash
deno run --allow-net functions/index.ts
```

## 构建

```bash
cd web
bun run typecheck
bun run build
```

构建产物在 `web/dist`，部署时作为 Qoder Sites 的静态目录。

## 分支

- `main`：脚手架与依赖，不放业务逻辑。
- `feat/ts-migration`：从 Rust 版本迁移现有逻辑。

## 约束

- 不提交 `.env`、API Key、数据库连接串或任何密钥。
- Qoder Sites 只支持静态前端 + 单个 Edge Function，不支持 Rust 进程、Docker 或常驻后台任务。
- AgentLoop 的工具模块不迁移；当前每个 Turn 只执行一轮模型调用。
- 托管数据库访问通过 Function 侧 SDK，不使用 `sqlx` 或直连连接串。
