# Shared Console Ops

日期：2026-04-01

这个目录用于承载 Shared 控制台与 Shared/Dedicated 实例的部署、启停、健康检查、升级和回滚脚本。

## 当前已可用

实例生命周期：
- `create-instance.sh`
- `start-instance.sh`
- `stop-instance.sh`
- `restart-instance.sh`
- `healthcheck-instance.sh`
- `backup-instance-config.sh`
- `smoke-shared-instance.sh`

第一批部署自动化：
- `deploy-pull.sh`
- `deploy-build.sh`
- `deploy-rollout.sh`
- `install-systemd-services.sh`
- `shared-console-deploy-common.sh`

说明：
- `deploy-pull.sh`：在 Ubuntu 部署目录拉取指定 remote/ref，并输出当前 commit
- `deploy-build.sh`：执行 `pnpm install`、`pnpm build`、`pnpm shared-console:build`
- `deploy-rollout.sh`：重启 `shared-console-api` / 前端服务，优先走 systemd，也支持自定义命令
- `deploy-server.sh`：一键串联 pull、build、rollout，适合 Ubuntu 服务器直接执行
- `install-systemd-services.sh`：安装 `/etc/systemd/system/shared-console-api.service` 和 `shared-console-web.service`

## 仍待实现

- `create-container.sh`
- `upgrade-instance.sh`
- `rollback-instance.sh`

## 推荐部署顺序

```bash
ops/deploy-server.sh --remote origin --ref main --target all
```

如需分步执行：

```bash
ops/deploy-pull.sh --remote origin --ref main
ops/deploy-build.sh
ops/deploy-rollout.sh --target all
```

如果 API 和前端由 systemd 管理，建议至少设置：

```bash
export SHARED_CONSOLE_API_SERVICE=shared-console-api
export SHARED_CONSOLE_WEB_SERVICE=shared-console-web
```

首次在服务器安装 systemd 服务：

```bash
sudo bash ops/install-systemd-services.sh --start
```

如果不是 systemd，也可以改成自定义命令：

```bash
export SHARED_CONSOLE_API_RESTART_CMD='supervisorctl restart shared-console-api'
export SHARED_CONSOLE_WEB_RESTART_CMD='supervisorctl restart shared-console-web'
```

## 设计原则

- 所有脚本都输出明确日志
- 尽量保持幂等
- 部署脚本优先失败得早、原因可读
- 控制台后端优先调用这些脚本，而不是把复杂运维逻辑散落在 TypeScript 里
