# Shared Internal Console

日期：2026-03-29
定位：Shared 内测控制台工程骨架（占位）

## 目录说明

### `apps/shared-console/`
控制台前端工程目录。

建议后续放置：
- 页面与路由
- Dashboard
- 实例列表 / 实例详情
- Usage / Health / Upgrade 页面

### `apps/shared-console-api/`
控制台后端 API 工程目录。

建议后续放置：
- 实例管理 API
- 容器管理 API
- 版本管理 API
- upgrade task API
- usage / health / audit API

### `ops/`
部署、实例控制、升级和回滚脚本目录。

建议后续放置：
- create-container.sh
- create-instance.sh
- start-instance.sh
- stop-instance.sh
- restart-instance.sh
- healthcheck-instance.sh
- smoke-shared-instance.sh
- upgrade-instance.sh
- rollback-instance.sh
- backup-instance-config.sh

### `config/templates/`
Shared 实例配置模板目录。

建议后续放置：
- shared-instance.base.yaml
- shared-instance.internal-test.yaml
- shared-instance.override.example.yaml

## 当前状态

当前仅完成目录骨架与文档占位，后续按：
1. Shared 本体补强
2. P0 部署底座
3. P1 观测与配置
4. P2 升级闭环

顺序推进。
