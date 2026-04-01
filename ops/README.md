# Shared Console Ops Skeleton

日期：2026-03-29

这个目录用于放 Shared 内测控制台与 Shared 实例的部署、健康检查、升级、回滚脚本。

当前建议脚本：
- `create-container.sh`
- `create-instance.sh`
- `start-instance.sh`
- `stop-instance.sh`
- `restart-instance.sh`
- `healthcheck-instance.sh`
- `smoke-shared-instance.sh`
- `upgrade-instance.sh`
- `rollback-instance.sh`
- `backup-instance-config.sh`

建议原则：
- 所有脚本都输出明确 exit code
- 所有脚本都要有基本日志
- 脚本尽量幂等
- 控制台后端优先调用这些脚本，而不是拼装复杂命令
