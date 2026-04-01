# Shared 内测控制台 GitHub Issues 模板 v0.1

日期：2026-03-29  
用途：把《Shared_内测控制台研发任务表_v0.1_2026-03-29.md》直接转成可复制到 GitHub Issues 的模板文本。

---

## 使用说明

建议每条 issue 至少包含：
- 标题
- Labels
- Priority
- Module
- Depends on
- Description
- Deliverables
- Acceptance Criteria

建议标签：
- `P0` / `P1` / `P2` / `P3`
- `frontend`
- `backend`
- `ops`
- `data`
- `observability`
- `upgrade`
- `security`
- `internal-test`

---

## 通用模板

```md
## Summary
一句话说明任务目标。

## Labels
- P0
- backend
- internal-test

## Priority
P0

## Module
backend

## Depends on
- 无

## Description
- 要做什么
- 关键实现点
- 是否涉及脚本 / API / 页面 / worker

## Deliverables
- 代码
- 文档
- 脚本
- 页面

## Acceptance Criteria
- [ ] 条件 1
- [ ] 条件 2
- [ ] 条件 3
```

---

## 第一批建议直接创建的 14 个 Issue

### 1. TASK-SHARED-001 标准化实例健康检查接口

```md
## Summary
统一 Shared 实例层健康检查与状态读取接口，为控制台 health page、healthcheck 脚本和升级验证提供稳定口径。

## Labels
- P0
- backend
- observability
- internal-test

## Priority
P0

## Module
shared / backend / observability

## Depends on
- 无

## Description
- 统一或补齐 Shared 实例层接口：`/health`、`/version`、`/shared/usage/summary`
- 视情况补充 `/shared/config/effective`（仅内部使用）
- 统一返回结构和错误语义
- 为后续 healthcheck 脚本、smoke 脚本和控制台 API 提供标准依赖

## Deliverables
- Shared 实例层接口实现
- 接口结构说明文档
- 示例响应

## Acceptance Criteria
- [ ] 所有内测实例都能返回统一结构
- [ ] healthcheck 脚本可直接调用这些接口
- [ ] 控制台实例详情页与健康检查页可复用这些接口
```

### 2. TASK-SHARED-002 稳定 usage 输出格式

```md
## Summary
固定 Shared usage event 输出字段，保证控制台聚合逻辑长期稳定。

## Labels
- P0
- data
- observability
- internal-test

## Priority
P0

## Module
shared / data / observability

## Depends on
- 无

## Description
- 固定 usage event 输出字段：`instanceId`、`timestamp`、`toolName`、`action`、`outcome`、`routeType`、`ruleId`、`deniedReason`
- 可按需要补充 `version`、`requestId`
- 保证 summary 与控制台聚合口径一致

## Deliverables
- usage 字段规范
- 输出实现
- 示例数据与文档说明

## Acceptance Criteria
- [ ] 控制台聚合器可按固定字段工作
- [ ] 现有 summary 逻辑不被打坏
- [ ] 新旧 usage 消费方口径清晰
```

### 3. TASK-SHARED-003 实例配置模板化

```md
## Summary
建立 Shared 实例配置模板，避免控制台与脚本手拼配置。

## Labels
- P0
- ops
- internal-test

## Priority
P0

## Module
shared / ops

## Depends on
- 无

## Description
- 建立配置模板：`config/templates/shared-instance.base.yaml`
- 建立配置模板：`config/templates/shared-instance.internal-test.yaml`
- 建立示例 override 模板：`config/templates/shared-instance.override.example.yaml`
- 让 create-instance 脚本基于模板生成配置

## Deliverables
- 模板文件
- 模板变量说明
- create-instance 脚本的模板使用逻辑

## Acceptance Criteria
- [ ] 创建实例不再手拼原始配置
- [ ] 新实例配置生成结果一致可预期
- [ ] 模板可复用到控制台创建实例流程
```

### 4. TASK-P0-001 初始化 Ubuntu 内测服务器运行环境

```md
## Summary
准备 Shared 内测控制台与实例运行所需的 Ubuntu 服务器基础环境。

## Labels
- P0
- ops
- internal-test

## Priority
P0

## Module
ops

## Depends on
- 无

## Description
- 安装 Git、Docker、Docker Compose plugin
- 安装 Nginx 或 Caddy
- 配置基础日志目录、数据目录与防火墙
- 验证服务器可拉代码与启动容器

## Deliverables
- 服务器初始化文档
- 初始化命令或脚本

## Acceptance Criteria
- [ ] 服务器可执行 `docker compose`
- [ ] 可从 GitHub 拉代码
- [ ] 容器可正常启动
```

### 5. TASK-P0-002 建立服务器目录规范与部署约定

```md
## Summary
统一 Ubuntu 内测服务器上的目录结构与部署路径。

## Labels
- P0
- ops
- internal-test

## Priority
P0

## Module
ops

## Depends on
- TASK-P0-001

## Description
- 建立 `/opt/shared-console/repo`
- 建立 `/opt/shared-console/deploy`
- 建立 `/opt/shared-console/logs`
- 建立 `/opt/shared-console/data`
- 建立 `/opt/shared-instances/`
- 固化目录使用约定

## Deliverables
- 目录初始化脚本
- README 文档

## Acceptance Criteria
- [ ] 目录结构固定
- [ ] 权限正确
- [ ] 后续部署统一使用该规范
```

### 6. TASK-P0-003 搭建控制台后端 API 项目骨架

```md
## Summary
初始化 Shared 内测控制台后端 API 工程骨架。

## Labels
- P0
- backend
- internal-test

## Priority
P0

## Module
backend

## Depends on
- 无

## Description
- 初始化 API 项目
- 配置路由系统
- 配置日志
- 配置 requestId 中间件
- 配置错误处理中间件
- 配置环境变量加载

## Deliverables
- `apps/shared-console-api/`
- 可运行的 API 服务

## Acceptance Criteria
- [ ] 本地可启动
- [ ] 服务器可启动
- [ ] `/health` 可访问
- [ ] 有统一错误返回格式
```

### 7. TASK-P0-004 建立控制台数据库 schema v1

```md
## Summary
建立 Shared 内测控制台的第一版数据库表结构。

## Labels
- P0
- backend
- data
- internal-test

## Priority
P0

## Module
backend / data

## Depends on
- TASK-P0-003

## Description
- 创建 `containers`
- 创建 `instances`
- 创建 `versions`
- 创建 `usage_summaries`
- 创建 `usage_rule_stats`
- 创建 `usage_denied_reason_stats`
- 创建 `health_check_records`
- 创建 `audit_logs`

## Deliverables
- migration 文件
- schema 文档

## Acceptance Criteria
- [ ] 本地迁移成功
- [ ] 服务器迁移成功
- [ ] API 能正常读写这些表
```

### 8. TASK-P0-005 实现实例创建脚本

```md
## Summary
实现 Shared 实例创建脚本，为控制台和手动部署共用。

## Labels
- P0
- ops
- internal-test

## Priority
P0

## Module
ops

## Depends on
- TASK-SHARED-003
- TASK-P0-001
- TASK-P0-002

## Description
- 编写 `ops/create-instance.sh`
- 基于配置模板生成实例配置
- 创建实例目录、日志目录、state dir
- 分配端口
- 输出实例元信息

## Deliverables
- `ops/create-instance.sh`
- 示例调用说明

## Acceptance Criteria
- [ ] 脚本可成功创建实例
- [ ] 端口不冲突
- [ ] 配置文件生成正确
- [ ] 目录结构符合约定
```

### 9. TASK-P0-006 实现实例启停与重启脚本

```md
## Summary
实现 Shared 实例启停与重启脚本。

## Labels
- P0
- ops
- internal-test

## Priority
P0

## Module
ops

## Depends on
- TASK-P0-005

## Description
- 编写 `ops/start-instance.sh`
- 编写 `ops/stop-instance.sh`
- 编写 `ops/restart-instance.sh`
- 明确返回码与失败日志

## Deliverables
- 启停脚本
- 使用说明

## Acceptance Criteria
- [ ] 实例可启动
- [ ] 实例可停止
- [ ] 实例可重启
- [ ] 失败时有日志
```

### 10. TASK-P0-007 实现实例健康检查脚本

```md
## Summary
实现统一的 Shared 实例健康检查脚本。

## Labels
- P0
- ops
- observability
- internal-test

## Priority
P0

## Module
ops / observability

## Depends on
- TASK-SHARED-001
- TASK-P0-006

## Description
- 编写 `ops/healthcheck-instance.sh`
- 调用 `/health`、`/version`、`/shared/usage/summary`
- 检查端口可达
- 输出统一错误摘要

## Deliverables
- `ops/healthcheck-instance.sh`

## Acceptance Criteria
- [ ] 成功/失败 exit code 明确
- [ ] 错误摘要清晰
- [ ] 可独立调用
```

### 11. TASK-P0-008 实现实例管理 API

```md
## Summary
实现控制台实例管理 API，支持实例 CRUD 与启停控制。

## Labels
- P0
- backend
- internal-test

## Priority
P0

## Module
backend

## Depends on
- TASK-P0-003
- TASK-P0-004
- TASK-P0-005
- TASK-P0-006

## Description
- 实现 `GET /api/instances`
- 实现 `POST /api/instances`
- 实现 `GET /api/instances/:id`
- 实现 `PATCH /api/instances/:id`
- 实现 `POST /api/instances/:id/start|stop|restart`

## Deliverables
- 实例管理 API
- 接口文档

## Acceptance Criteria
- [ ] 可通过 API 创建实例
- [ ] 可通过 API 启停实例
- [ ] 可查询实例详情
```

### 12. TASK-P0-009 实现实例状态同步任务

```md
## Summary
实现实例状态同步任务，让控制台状态与真实实例状态一致。

## Labels
- P0
- backend
- data
- internal-test

## Priority
P0

## Module
backend / data

## Depends on
- TASK-P0-008
- TASK-P0-007

## Description
- 定时读取实例真实状态
- 同步 `status`、`health_status`、`last_health_check_at`
- 标记 stale 状态
- 失败时输出日志

## Deliverables
- sync worker
- 调度配置

## Acceptance Criteria
- [ ] 页面状态与真实状态基本一致
- [ ] 同步失败有日志
- [ ] stale 状态可识别
```

### 13. TASK-P0-010 搭建控制台前端项目骨架

```md
## Summary
初始化 Shared 内测控制台前端骨架。

## Labels
- P0
- frontend
- internal-test

## Priority
P0

## Module
frontend

## Depends on
- 无

## Description
- 初始化前端项目
- 配置路由、布局、API client、基础状态管理
- 接入基础 UI 组件库

## Deliverables
- `apps/shared-console/`

## Acceptance Criteria
- [ ] 页面可启动
- [ ] 可切换路由
- [ ] 可请求测试 API
```

### 14. TASK-P0-011 实现实例列表页

```md
## Summary
实现控制台第一版实例列表页。

## Labels
- P0
- frontend
- internal-test

## Priority
P0

## Module
frontend

## Depends on
- TASK-P0-008
- TASK-P0-010

## Description
- 展示实例列表
- 支持搜索和筛选
- 展示状态、健康状态、版本等关键字段
- 支持跳转实例详情

## Deliverables
- 实例列表页

## Acceptance Criteria
- [ ] 可加载实例列表
- [ ] 可筛选
- [ ] 可跳转详情页
```

---

## 下一批建议

第二批优先创建：
- TASK-P0-012 实现实例详情页基础版
- TASK-P1-001 实现 Dashboard 汇总 API
- TASK-P1-002 实现 Dashboard 总览页
- TASK-P1-003 实现 usage 汇总采集任务
- TASK-P1-004 实现 usage 查询 API
- TASK-P1-005 实现 Usage 汇总页
- TASK-P1-006 实现健康检查记录采集任务
- TASK-P1-007 实现健康检查 API
- TASK-P1-008 实现健康检查页
- TASK-SHARED-004 标准化 smoke 检查脚本

---

## 一句话结论

建议先创建 Shared 本体补强 + P0 任务，把内测平台的底座、实例层口径和第一版控制台一起拉起来，再进入 Dashboard / Usage / 升级闭环。
