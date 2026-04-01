# Shared 内测控制台 GitHub Issue 可复制版

版本：v0.1  
日期：2026-03-29  
用途：直接复制到 GitHub Issues / Jira / 飞书任务卡片中使用  
关联文档：
- `../Shared_内测控制台MVP_需求说明与实施清单_2026-03-29.md`
- `../Shared_内测控制台研发任务表_v0.1_2026-03-29.md`

---

## 使用说明

建议每条任务卡统一使用以下字段：

- 标题
- 优先级
- 模块
- 前置依赖
- 背景
- 工作内容
- 交付物
- 验收标准
- 标签

下面内容可以直接复制成 issue。

---

## ISSUE 01
### 标题
[P0][shared][observability] 标准化实例健康检查接口

### 优先级
P0

### 模块
shared / backend / observability

### 前置依赖
无

### 背景
内测控制台后续的健康检查页、升级校验、smoke 检查都依赖 Shared 实例层存在统一健康检查口径。如果接口不统一，后面控制台和脚本都容易返工。

### 工作内容
统一或补齐 Shared 实例层接口：
- `/health`
- `/version`
- `/shared/usage/summary`
- `/shared/config/effective`（可选，仅内部）

定义统一返回结构，并补最小文档说明。

### 交付物
- 统一接口规范
- 接口实现代码
- 返回样例
- 文档说明

### 验收标准
- 所有内测实例都能返回统一结构
- healthcheck 脚本可稳定调用
- 实例详情页和升级 smoke 可直接复用

### 标签
`P0` `shared` `observability` `internal-test`

---

## ISSUE 02
### 标题
[P0][shared][data] 稳定 usage 输出格式

### 优先级
P0

### 模块
shared / data / observability

### 前置依赖
无

### 背景
控制台的 usage 聚合、Dashboard、ruleId / deniedReason 统计都依赖 usage event 字段稳定。如果字段持续变化，观测链路会频繁返工。

### 工作内容
固定 usage event 字段：
- `instanceId`
- `timestamp`
- `toolName`
- `action`
- `outcome`
- `routeType`
- `ruleId`
- `deniedReason`

可选补充：
- `version`
- `requestId`

补输出实现、样例与说明。

### 交付物
- usage 字段规范
- 输出实现
- 示例数据
- 文档说明

### 验收标准
- 控制台聚合器可按固定字段长期工作
- 现有 summary 逻辑不被打坏
- 字段变更有明确兼容策略

### 标签
`P0` `shared` `data` `observability`

---

## ISSUE 03
### 标题
[P0][shared][ops] 实例配置模板化

### 优先级
P0

### 模块
shared / ops

### 前置依赖
无

### 背景
控制台和脚本创建实例不能长期依赖手拼配置，否则环境差异和漏项风险会越来越高。

### 工作内容
建立模板文件：
- `config/templates/shared-instance.base.yaml`
- `config/templates/shared-instance.internal-test.yaml`
- `config/templates/shared-instance.override.example.yaml`

模板覆盖端口、profile、state dir、日志目录、Shared 开关、usage / audit 开关、路径白名单等基础项。

### 交付物
- 配置模板文件
- 模板变量说明
- create-instance 脚本对模板的使用

### 验收标准
- 新实例创建不再手拼原始配置
- 模板可复用
- 新实例生成结果一致可预期

### 标签
`P0` `shared` `ops` `internal-test`

---

## ISSUE 04
### 标题
[P0][ops] 初始化 Ubuntu 内测服务器运行环境

### 优先级
P0

### 模块
ops

### 前置依赖
无

### 背景
需要把 Ubuntu 服务器变成规范的内测部署环境，为控制台和 Shared 实例部署打底。

### 工作内容
安装并配置：
- Git
- Docker
- Docker Compose plugin
- Nginx / Caddy
- 基础日志目录
- 基础数据目录
- 基础防火墙

### 交付物
- 服务器初始化文档
- 初始化命令或脚本

### 验收标准
- 服务器可执行 `docker compose`
- 可从 GitHub 拉代码
- 容器可启动

### 标签
`P0` `ops` `internal-test`

---

## ISSUE 05
### 标题
[P0][ops] 建立服务器目录规范与部署约定

### 优先级
P0

### 模块
ops

### 前置依赖
ISSUE 04

### 背景
部署目录不统一，后续脚本、日志、回滚都容易混乱。

### 工作内容
建立目录：
- `/opt/shared-console/repo`
- `/opt/shared-console/deploy`
- `/opt/shared-console/logs`
- `/opt/shared-console/data`
- `/opt/shared-instances/`

### 交付物
- 目录初始化脚本
- README

### 验收标准
- 目录结构固定
- 权限正确
- 部署统一使用该结构

### 标签
`P0` `ops`

---

## ISSUE 06
### 标题
[P0][backend] 搭建控制台后端 API 项目骨架

### 优先级
P0

### 模块
backend

### 前置依赖
无

### 背景
控制台所有实例管理、版本管理、任务调度都依赖 API 服务骨架。

### 工作内容
初始化 `apps/shared-console-api/`：
- 路由系统
- 日志
- requestId 中间件
- 错误处理中间件
- 环境变量加载

### 交付物
- API 项目骨架
- `/health` 健康接口

### 验收标准
- 本地可启动
- 服务器可启动
- `/health` 可访问

### 标签
`P0` `backend`

---

## ISSUE 07
### 标题
[P0][backend][data] 建立控制台数据库 schema v1

### 优先级
P0

### 模块
backend / data

### 前置依赖
ISSUE 06

### 背景
控制台需要先有容器、实例、usage、health、audit 的数据结构。

### 工作内容
建立数据表：
- `containers`
- `instances`
- `versions`
- `usage_summaries`
- `usage_rule_stats`
- `usage_denied_reason_stats`
- `health_check_records`
- `audit_logs`

### 交付物
- migration 文件
- schema 文档

### 验收标准
- 本地迁移成功
- 服务器迁移成功
- 表结构可被后端读写

### 标签
`P0` `backend` `data`

---

## ISSUE 08
### 标题
[P0][ops] 实现实例创建脚本

### 优先级
P0

### 模块
ops

### 前置依赖
ISSUE 03
ISSUE 04
ISSUE 05

### 背景
没有实例创建脚本，控制台后续的“创建实例”只是空按钮。

### 工作内容
编写 `ops/create-instance.sh`，支持：
- 创建实例目录
- 使用模板生成配置
- 分配端口
- 创建日志目录
- 创建 state dir

### 交付物
- 创建实例脚本
- 示例配置模板联动说明

### 验收标准
- 能创建实例
- 端口不冲突
- 配置生成正确

### 标签
`P0` `ops`

---

## ISSUE 09
### 标题
[P0][ops] 实现实例启停与重启脚本

### 优先级
P0

### 模块
ops

### 前置依赖
ISSUE 08

### 背景
内测平台必须能通过脚本控制实例启停与重启。

### 工作内容
实现：
- `ops/start-instance.sh`
- `ops/stop-instance.sh`
- `ops/restart-instance.sh`

### 交付物
- 启停脚本
- 使用说明

### 验收标准
- 实例可启停重启
- 返回码清晰
- 失败有日志

### 标签
`P0` `ops`

---

## ISSUE 10
### 标题
[P0][ops][observability] 实现实例健康检查脚本

### 优先级
P0

### 模块
ops / observability

### 前置依赖
ISSUE 01
ISSUE 09

### 背景
控制台 health page、实例详情、升级验证都依赖标准化健康检查脚本。

### 工作内容
实现 `ops/healthcheck-instance.sh`，检查：
- health
- version
- 端口可达
- usage summary 可读

### 交付物
- 健康检查脚本

### 验收标准
- exit code 明确
- 错误摘要清晰
- 可独立调用

### 标签
`P0` `ops` `observability`

---

## ISSUE 11
### 标题
[P0][backend] 实现实例管理 API

### 优先级
P0

### 模块
backend

### 前置依赖
ISSUE 06
ISSUE 07
ISSUE 08
ISSUE 09

### 背景
实例创建、编辑、启停、详情查询都需要先有 API。

### 工作内容
实现：
- `GET /api/instances`
- `POST /api/instances`
- `GET /api/instances/:id`
- `PATCH /api/instances/:id`
- `POST /api/instances/:id/start`
- `POST /api/instances/:id/stop`
- `POST /api/instances/:id/restart`

### 交付物
- 实例管理 API
- 接口文档

### 验收标准
- 可通过 API 创建实例
- 可启停实例
- 可查询实例详情

### 标签
`P0` `backend`

---

## ISSUE 12
### 标题
[P0][data] 实现实例状态同步任务

### 优先级
P0

### 模块
data / backend

### 前置依赖
ISSUE 10
ISSUE 11

### 背景
控制台页面需要看到实例真实状态，而不是静态表数据。

### 工作内容
实现实例状态同步任务：
- 同步 status
- 同步 health
- 同步最后检查时间
- 标记 stale 状态

### 交付物
- sync worker
- 调度配置

### 验收标准
- 页面状态与真实状态基本一致
- 同步失败有日志

### 标签
`P0` `data` `backend`

---

## ISSUE 13
### 标题
[P0][frontend] 搭建控制台前端项目骨架

### 优先级
P0

### 模块
frontend

### 前置依赖
无

### 背景
控制台页面开发需要先有统一骨架、布局和 API 请求层。

### 工作内容
初始化 `apps/shared-console/`：
- 路由
- 布局
- API client
- 全局状态
- 基础 UI 组件库

### 交付物
- 前端项目骨架

### 验收标准
- 页面可启动
- 路由可切换
- 能请求测试 API

### 标签
`P0` `frontend`

---

## ISSUE 14
### 标题
[P0][frontend] 实现实例列表页

### 优先级
P0

### 模块
frontend

### 前置依赖
ISSUE 11
ISSUE 13

### 背景
实例列表页是控制台最先体现价值的页面。

### 工作内容
实现：
- 实例列表
- 搜索
- 筛选
- 状态展示
- 跳转详情
- 创建实例按钮

### 交付物
- 实例列表页

### 验收标准
- 能展示实例列表
- 能筛选
- 能跳转详情

### 标签
`P0` `frontend`

---

## ISSUE 15
### 标题
[P0][frontend] 实现实例详情页基础版

### 优先级
P0

### 模块
frontend

### 前置依赖
ISSUE 11
ISSUE 12
ISSUE 13

### 背景
实例详情页是后续配置、health、upgrade 的承载页。

### 工作内容
展示：
- 基本信息
- 当前状态
- 当前版本
- 健康状态
- 最近检查时间
- 启动 / 停止 / 重启按钮

### 交付物
- 实例详情页基础版

### 验收标准
- 页面展示完整
- 按钮可联通 API
- 状态变化可刷新

### 标签
`P0` `frontend`

---

## ISSUE 16
### 标题
[P1][shared][upgrade] 标准化 smoke 检查脚本

### 优先级
P1

### 模块
shared / ops / upgrade / observability

### 前置依赖
ISSUE 01
ISSUE 02

### 背景
升级后验证不能靠人工点击，需要脚本统一校验 Shared 核心能力。

### 工作内容
实现 `ops/smoke-shared-instance.sh`，检查：
- health OK
- version 匹配
- browser status 正常
- browser profiles 正常
- browser tabs 正常
- usage summary 可读

### 交付物
- smoke 脚本
- 返回码说明
- 日志规范

### 验收标准
- 升级脚本与回滚脚本可直接调用
- 失败输出可直接进入任务日志

### 标签
`P1` `shared` `upgrade` `observability`
