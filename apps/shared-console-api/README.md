# Shared Console API

最小可用后端已经接通，当前以“实例目录 + `instance.env` + `ops/*.sh`”作为事实来源。

当前接口：
- `GET /healthz`
- `GET /api/instances`
- `POST /api/instances`
- `GET /api/instances/:id`
- `PATCH /api/instances/:id`
- `POST /api/instances/:id/start`
- `POST /api/instances/:id/stop`
- `POST /api/instances/:id/restart`
- `GET /api/dedicated-instances`
- `POST /api/dedicated-instances`
- `GET /api/containers`
- `GET /api/containers/:id/logs`
- `POST /api/containers/:id/start`
- `POST /api/containers/:id/stop`
- `POST /api/containers/:id/restart`

开发运行：

```bash
pnpm shared-console-api:dev
```

关键环境变量：
- `SHARED_CONSOLE_API_HOST`：监听地址，默认 `127.0.0.1`
- `SHARED_CONSOLE_API_PORT`：监听端口，默认 `43100`
- `SHARED_CONSOLE_API_INSTANCES_ROOT`：shared 实例根目录
- `SHARED_CONSOLE_API_DEDICATED_INSTANCES_ROOT`：dedicated 实例根目录
- `SHARED_CONSOLE_API_BASH`：显式指定 `bash` 路径；Windows 开发机通常指向 Git Bash，Ubuntu 部署机通常直接用系统 `bash`
- `SHARED_CONSOLE_API_PROBE_TIMEOUT_MS`：实例 HTTP 探测超时，默认 `1500`

容器实例相关环境变量：
- `OPENCLAW_CONTAINER_REPO_ROOT`：目标容器内仓库根目录，建议在 Ubuntu 部署时显式设置为容器内实际挂载路径，例如 `/www/openclaw/repo`
- `OPENCLAW_CONTAINER_INSTANCES_ROOT`：统一覆盖容器内实例根目录
- `OPENCLAW_CONTAINER_SHARED_INSTANCES_ROOT`：容器内 shared 实例根目录，建议显式设置，例如 `/www/openclaw/shared-instances`
- `OPENCLAW_CONTAINER_DEDICATED_INSTANCES_ROOT`：容器内 dedicated 实例根目录，建议显式设置，例如 `/www/openclaw/dedicated-instances`

当前约束：
- `PATCH /api/instances/:id` 目前只支持修改 `name`
- host 实例由宿主机 `ops/*.sh` 管理
- container 实例由宿主机 API 通过 `docker exec` 进入目标容器管理
- container 实例 probe 会优先在容器内探测，不再要求把实例端口映射回 API 宿主机

部署约定见：
- [`docs/shared-console/ubuntu-deployment.md`](/E:/claudecode/openclaw-main_326_private/docs/shared-console/ubuntu-deployment.md)
