# Shared Console API

最小可用后台已接通，当前以“实例目录 + `instance.env` + `ops/*.sh`”作为事实来源。

当前可用接口：

- `GET /healthz`
- `GET /api/instances`
- `POST /api/instances`
- `GET /api/instances/:id`
- `PATCH /api/instances/:id`
- `POST /api/instances/:id/start`
- `POST /api/instances/:id/stop`
- `POST /api/instances/:id/restart`

运行方式：

```bash
pnpm shared-console-api:dev
```

关键环境变量：

- `SHARED_CONSOLE_API_HOST`：监听地址，默认 `127.0.0.1`
- `SHARED_CONSOLE_API_PORT`：监听端口，默认 `43100`
- `SHARED_CONSOLE_API_INSTANCES_ROOT`：实例根目录；未设置时回退到 `OPENCLAW_SHARED_INSTANCES_ROOT`，再回退到仓库内 `.shared-instances`
- `SHARED_CONSOLE_API_BASH`：显式指定 `bash` / Git Bash 路径
- `SHARED_CONSOLE_API_PROBE_TIMEOUT_MS`：Shared 实例 HTTP 探测超时，默认 `1500`

当前约束：

- `PATCH /api/instances/:id` 仅支持更新 `name`
- 还没有数据库；后续按开发计划再补聚合、审计、升级任务与容器管理
