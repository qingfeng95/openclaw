# Shared 内测控制台 GitHub Issues 模板（2026-03-29）

用途：把《Shared 内测控制台研发任务表 v0.1》里的任务，快速复制到 GitHub Issues / Jira / 飞书任务系统。  
关联文档：
- `../Shared_内测控制台研发任务表_v0.1_2026-03-29.md`
- `../Shared_内测控制台MVP_需求说明与实施清单_2026-03-29.md`

---

## 1. 建议标签

- `P0`
- `P1`
- `P2`
- `P3`
- `frontend`
- `backend`
- `ops`
- `data`
- `observability`
- `upgrade`
- `security`
- `internal-test`
- `shared-core`
- `blocked`

---

## 2. 通用 Issue 模板

```md
## 背景

## 目标

## 内容
- 
- 
- 

## 前置依赖
- 

## 交付物
- 

## 验收标准
- [ ] 
- [ ] 
- [ ] 

## 标签

## 备注
```

---

## 3. 第一批建议直接创建的 Issue

以下 14 个最适合第一时间建进 GitHub。

---

# ISSUE 1
## 标题
TASK-SHARED-001 标准化实例健康检查接口

## 背景
当前内测控制台、健康检查脚本、升级验证与回滚验证，都需要依赖统一的 Shared 实例健康检查口径。

## 目标
统一或补齐 Shared 实例层的标准接口，避免后续控制台与脚本层反复适配。

## 内容
- 统一或补齐 `/health`
- 统一或补齐 `/version`
- 统一或补齐 `/shared/usage/summary`
- 评估并可选实现 `/shared/config/effective`（仅内部可见）
- 定义统一响应结构与错误口径
- 补最小文档说明

## 前置依赖
- 无

## 交付物
- Shared 实例健康检查接口规范
- 对应实现代码
- 接口说明文档

## 验收标准
- [ ] 所有内测实例返回统一结构
- [ ] healthcheck 脚本可直接调用
- [ ] 升级 smoke 脚本可直接复用这些接口

## 标签
`P0` `shared-core` `backend` `observability` `internal-test`

---

# ISSUE 2
## 标题
TASK-SHARED-002 稳定 usage 输出格式

## 背景
控制台的 usage 聚合、Dashboard 与规则统计依赖 Shared usage 事件字段稳定。

## 目标
固定 usage event 输出字段，减少聚合器与页面逻辑返工。

## 内容
- 固定 `instanceId`
- 固定 `timestamp`
- 固定 `toolName`
- 固定 `action`
- 固定 `outcome`
- 固定 `routeType`
- 固定 `ruleId`
- 固定 `deniedReason`
- 评估补充 `version`、`requestId`
- 输出字段文档与示例数据

## 前置依赖
- 无

## 交付物
- usage 字段规范
- 输出实现
- 示例数据
- 文档说明

## 验收标准
- [ ] 控制台聚合器可按固定字段长期工作
- [ ] 现有 summary 不被打坏
- [ ] 新旧消费方口径清晰

## 标签
`P0` `shared-core` `data` `observability` `internal-test`

---

# ISSUE 3
## 标题
TASK-SHARED-003 实例配置模板化

## 背景
控制台和脚本后续都需要创建 Shared 实例，不能依赖手拼配置。

## 目标
建立统一配置模板体系，保证实例生成结果稳定可复用。

## 内容
- 建立 `config/templates/shared-instance.base.yaml`
- 建立 `config/templates/shared-instance.internal-test.yaml`
- 建立 `config/templates/shared-instance.override.example.yaml`
- 定义模板变量说明
- 让 create-instance 脚本基于模板生成实例配置

## 前置依赖
- 无

## 交付物
- 配置模板文件
- 模板变量说明
- create-instance 脚本的模板使用逻辑

## 验收标准
- [ ] 创建实例脚本不再手拼配置
- [ ] 新实例生成结果一致可预期
- [ ] 模板体系可复用

## 标签
`P0` `shared-core` `ops` `internal-test`

---

# ISSUE 4
## 标题
TASK-P0-001 初始化 Ubuntu 内测服务器运行环境

## 背景
需要将 16c32g Ubuntu 服务器作为 Shared 内测部署环境。

## 目标
完成服务器基础运行环境初始化。

## 内容
- 安装 Git
- 安装 Docker
- 安装 Docker Compose plugin
- 安装 Nginx 或 Caddy
- 准备日志目录与数据目录
- 准备基础防火墙配置

## 前置依赖
- 无

## 交付物
- 服务器初始化文档
- 初始化命令或脚本

## 验收标准
- [ ] 可执行 `docker compose`
- [ ] 可从 GitHub 拉代码
- [ ] 容器可正常启动

## 标签
`P0` `ops` `internal-test`

---

# ISSUE 5
## 标题
TASK-P0-002 建立服务器目录规范与部署约定

## 背景
后续部署、日志、数据与实例管理需要固定目录结构。

## 目标
建立统一服务器目录规范。

## 内容
- 建立 `/opt/shared-console/repo`
- 建立 `/opt/shared-console/deploy`
- 建立 `/opt/shared-console/logs`
- 建立 `/opt/shared-console/data`
- 建立 `/opt/shared-instances/`
- 记录目录用途与约定

## 前置依赖
- TASK-P0-001

## 交付物
- 目录初始化脚本
- README 文档

## 验收标准
- [ ] 目录结构已创建
- [ ] 权限正确
- [ ] 后续部署统一使用该目录规范

## 标签
`P0` `ops` `internal-test`

---

# ISSUE 6
## 标题
TASK-P0-003 搭建控制台后端 API 项目骨架

## 背景
控制台后端是实例管理、容器管理、任务管理与观测查询的基础。

## 目标
初始化可运行的控制台 API 服务。

## 内容
- 初始化 API 项目
- 配置路由系统
- 配置日志
- 配置 requestId 中间件
- 配置错误处理中间件
- 配置环境变量读取

## 前置依赖
- 无

## 交付物
- `apps/shared-console-api/`
- 可运行的 API 服务

## 验收标准
- [ ] 本地可启动
- [ ] 服务器可启动
- [ ] `/health` 可访问
- [ ] 错误返回格式统一

## 标签
`P0` `backend` `internal-test`

---

# ISSUE 7
## 标题
TASK-P0-004 建立控制台数据库 schema v1

## 背景
控制台需要统一承载实例、容器、版本、usage、health、audit 等数据。

## 目标
建立第一版数据库表结构。

## 内容
- 建立 `containers`
- 建立 `instances`
- 建立 `versions`
- 建立 `usage_summaries`
- 建立 `usage_rule_stats`
- 建立 `usage_denied_reason_stats`
- 建立 `health_check_records`
- 建立 `audit_logs`

## 前置依赖
- TASK-P0-003

## 交付物
- migration 文件
- schema 文档

## 验收标准
- [ ] 本地迁移成功
- [ ] 服务器迁移成功
- [ ] API 可正常读写

## 标签
`P0` `backend` `data` `internal-test`

---

# ISSUE 8
## 标题
TASK-P0-005 实现实例创建脚本

## 背景
控制台真正落地之前，必须先有脚本化实例创建能力。

## 目标
实现 Shared 实例创建脚本。

## 内容
- 编写 `ops/create-instance.sh`
- 创建实例目录
- 生成配置文件
- 分配端口
- 创建日志目录
- 创建 state dir
- 输出实例元信息

## 前置依赖
- TASK-P0-001
- TASK-P0-002
- TASK-SHARED-003

## 交付物
- 创建实例脚本
- 示例配置模板

## 验收标准
- [ ] 可通过命令创建实例
- [ ] 端口不冲突
- [ ] 配置文件生成正确

## 标签
`P0` `ops` `internal-test`

---

# ISSUE 9
## 标题
TASK-P0-006 实现实例启停与重启脚本

## 背景
实例管理的最小闭环需要脚本化启停。

## 目标
实现实例启动、停止、重启脚本。

## 内容
- 编写 `ops/start-instance.sh`
- 编写 `ops/stop-instance.sh`
- 编写 `ops/restart-instance.sh`
- 统一返回码与日志输出

## 前置依赖
- TASK-P0-005

## 交付物
- 启停脚本
- 简单使用文档

## 验收标准
- [ ] 实例可启动
- [ ] 实例可停止
- [ ] 实例可重启
- [ ] 错误有日志

## 标签
`P0` `ops` `internal-test`

---

# ISSUE 10
## 标题
TASK-P0-007 实现实例健康检查脚本

## 背景
控制台健康页、升级验证与回滚验证都需要统一健康检查脚本。

## 目标
实现可独立调用的实例健康检查脚本。

## 内容
- 编写 `ops/healthcheck-instance.sh`
- 检查 `/health`
- 检查 `/version`
- 检查端口可达
- 检查 `/shared/usage/summary` 可读
- 输出明确 exit code 与错误摘要

## 前置依赖
- TASK-SHARED-001
- TASK-P0-006

## 交付物
- 健康检查脚本

## 验收标准
- [ ] 成功/失败 exit code 明确
- [ ] 可独立调用
- [ ] 输出错误摘要

## 标签
`P0` `ops` `observability` `internal-test`

---

# ISSUE 11
## 标题
TASK-P0-008 实现实例管理 API

## 背景
前端实例列表、详情和控制操作依赖实例管理 API。

## 目标
实现实例 CRUD 与启停控制接口。

## 内容
- `GET /api/instances`
- `POST /api/instances`
- `GET /api/instances/:id`
- `PATCH /api/instances/:id`
- `POST /api/instances/:id/start`
- `POST /api/instances/:id/stop`
- `POST /api/instances/:id/restart`

## 前置依赖
- TASK-P0-003
- TASK-P0-004
- TASK-P0-005
- TASK-P0-006

## 交付物
- 实例管理 API
- 接口文档

## 验收标准
- [ ] 可通过 API 创建实例
- [ ] 可通过 API 启停实例
- [ ] 可查询实例详情

## 标签
`P0` `backend` `internal-test`

---

# ISSUE 12
## 标题
TASK-P0-009 实现实例状态同步任务

## 背景
控制台展示不能只依赖数据库初值，需要和真实实例状态持续同步。

## 目标
实现实例状态同步 worker。

## 内容
- 定时读取实例真实状态
- 同步 `status`
- 同步 `health_status`
- 同步最后检查时间
- 识别 stale 状态

## 前置依赖
- TASK-P0-008
- TASK-P0-007

## 交付物
- sync worker
- 调度配置

## 验收标准
- [ ] 页面状态与真实状态大体一致
- [ ] 同步失败有日志
- [ ] stale 状态可识别

## 标签
`P0` `backend` `data` `internal-test`

---

# ISSUE 13
## 标题
TASK-P0-010 搭建控制台前端项目骨架

## 背景
需要尽快形成控制台前端可运行骨架，以便并行推进页面开发。

## 目标
初始化控制台前端项目。

## 内容
- 初始化前端项目
- 配置路由
- 配置布局
- 配置 API client
- 配置全局状态
- 接入基础 UI 组件库

## 前置依赖
- 无

## 交付物
- `apps/shared-console/`

## 验收标准
- [ ] 页面可启动
- [ ] 可切页面
- [ ] 可请求测试 API

## 标签
`P0` `frontend` `internal-test`

---

# ISSUE 14
## 标题
TASK-P0-011 实现实例列表页

## 背景
实例列表页是控制台第一批最有价值的页面。

## 目标
实现实例列表与基础筛选能力。

## 内容
- 实例列表表格
- 搜索
- 状态筛选
- 版本展示
- 跳转实例详情
- 创建实例按钮占位

## 前置依赖
- TASK-P0-008
- TASK-P0-010

## 交付物
- 实例列表页

## 验收标准
- [ ] 可加载实例列表
- [ ] 可按状态筛选
- [ ] 可跳转详情页

## 标签
`P0` `frontend` `internal-test`

---

## 4. 使用建议

建议创建顺序：
1. 先创建 Shared 本体补强 3 个 P0 issue
2. 再创建部署与后端骨架 issue
3. 再创建前端骨架与实例页 issue

这样能保证先稳地基，再上控制台。