# Shared Console Frontend

日期：2026-04-01

当前目录包含一版可直接对接 `shared-console-api` 的最小前端，不再只是占位。

当前能力：
- Dashboard 摘要卡片
- shared / dedicated 实例列表
- 实例详情
- 实例创建
- 实例改名
- 实例启动 / 停止 / 重启
- Probe 信息查看
- Usage summary 快速查看
- Docker 容器列表、日志、启停

开发运行：

```bash
node apps/shared-console/server.mjs
```

默认地址：
- Frontend: `http://127.0.0.1:43101`
- API: `http://127.0.0.1:43100`

可选环境变量：
- `SHARED_CONSOLE_HOST`
- `SHARED_CONSOLE_PORT`
- `SHARED_CONSOLE_API_BASE`

构建静态产物：

```bash
node apps/shared-console/build.mjs
```

输出目录：
- `dist/shared-console/`

说明：
- Windows 11 主要用于本地开发和提交
- Ubuntu 服务器才是实例、容器、目录挂载和真实运维的目标环境
- 当前推荐部署根目录：`/www/openclaw`
- 部署约定见 [`docs/shared-console/ubuntu-deployment.md`](/E:/claudecode/openclaw-main_326_private/docs/shared-console/ubuntu-deployment.md)
