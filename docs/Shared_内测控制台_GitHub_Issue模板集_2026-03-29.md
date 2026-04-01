# Shared 内测控制台 GitHub Issue 模板集（2026-03-29）

用途：把《Shared 内测控制台研发任务表 v0.1》里的任务，直接复制为 GitHub Issue。  
适用仓库：`openclaw-main_326`  
关联文档：
- `../Shared_内测控制台研发任务表_v0.1_2026-03-29.md`
- `../Shared_内测控制台MVP_需求说明与实施清单_2026-03-29.md`

---

## 使用说明

建议每条 issue 使用统一结构：
- 标题
- 背景
- 范围
- 交付物
- 验收标准
- 前置依赖
- 建议标签

建议优先创建：
- Shared 本体补强 P0
- P0 部署底座
- P0 API / 前端骨架

---

## ISSUE 模板 01
### 标题
`[P0][shared][observability] 标准化实例健康检查接口`

### 背景
Shared 内测控制台后续的健康检查页、升级校验、自动回滚和 smoke 验证都依赖统一的实例接口口径。当前需要把 Shared 实例层的健康与状态相关接口标准化。

### 范围
统一或补齐以下接口：
- `/health`
- `/version`
- `/shared/usage/summary`
- `/shared/config/effective`（可选，仅内部）

### 交付物
- 统一接口规范
- 接口实现
- 接口说明文档

### 验收标准
- 所有内测实例返回统一结构
- healthcheck 脚本可直接复用
- 升级后 smoke 脚本可直接调用

### 前置依赖
- 无

### 建议标签
- `P0`
- `shared`
- `observability`
- `internal-test`

---

## ISSUE 模板 02
### 标题
`[P0][shared][data] 稳定 usage 输出格式`

### 背景
控制台的 Usage 汇总页、Dashboard 聚合和 ruleId / deniedReason 观察依赖固定 usage 字段。如果字段不稳定，聚合器会反复返工。

### 范围
固定 usage event 输出字段：
- `instanceId`
- `timestamp`
- `toolName`
- `action`
- `outcome`
- `routeType`
- `ruleId`
- `deniedReason`

可选：
- `version`
- `requestId`

### 交付物
- usage 字段规范
- 输出实现
- 示例数据
- 文档说明

### 验收标准
- 控制台聚合器可按固定字段长期工作
- 现有 summary 不被打坏
- 新旧消费方口径清晰

### 前置依赖
- 无

### 建议标签
- `P0`
- `shared`
- `data`
- `observability`

---

## ISSUE 模板 03
### 标题
`[P0][shared][ops] 实例配置模板化`

### 背景
控制台创建实例不能长期依赖手拼配置。需要把 Shared 实例配置模板化，供脚本和控制台复用。

### 范围
建立模板文件：
- `config/templates/shared-instance.base.yaml`
- `config/templates/shared-instance.internal-test.yaml`
- `config/templates/shared-instance.override.example.yaml`

### 交付物
- 配置模板文件
- 模板变量说明
- create-instance 脚本使用模板生成配置

### 验收标准
- 创建实例脚本不再手拼原始配置
- 新实例配置生成结果一致可预期
- 模板可复用

### 前置依赖
- 无

### 建议标签
- `P0`
- `shared`
- `ops`
- `internal-test`

---

## ISSUE 模板 04
### 标题
`[P1][shared][upgrade] 标准化 smoke 检查脚本`

### 背景
升级后不能依赖人工点击验证，需要把 Shared 的升级后验证固定成标准脚本。

### 范围
实现：
- `ops/smoke-shared-instance.sh`

检查项：
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
- 升级脚本和回滚脚本可直接调用
- 失败输出可直接进入任务日志
- 升级后验证不依赖人工点击

### 前置依赖
- ISSUE 01
- ISSUE 02

### 建议标签
- `P1`
- `shared`
- `upgrade`
- `observability`

---

## ISSUE 模板 05
### 标题
`[P0][ops] 初始化 Ubuntu 内测服务器运行环境`

### 背景
需要把 Ubuntu 服务器准备成规范的 Shared 内测部署环境。

### 范围
安装并配置：
- Git
- Docker
- Docker Compose plugin
- Nginx / Caddy
- 基础防火墙
- 日志目录与数据目录

### 交付物
- 初始化文档
- 初始化脚本或命令记录

### 验收标准
- 可执行 `docker compose`
- 可拉 GitHub 仓库
- 容器可启动

### 前置依赖
- 无

### 建议标签
- `P0`
- `ops`
- `internal-test`

---

## ISSUE 模板 06
### 标题
`[P0][ops] 建立服务器目录规范与部署约定`

### 背景
部署目录和数据目录需要统一，否则后续运维会很乱。

### 范围
建立：
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
- 后续部署统一使用此结构

### 前置依赖
- ISSUE 05

### 建议标签
- `P0`
- `ops`

---

## ISSUE 模板 07
### 标题
`[P0][backend] 搭建控制台后端 API 项目骨架`

### 背景
Shared 内测控制台需要独立 API 服务承接实例管理、容器管理、usage、health、升级任务等能力。

### 范围
初始化：
- API 项目
- 路由系统
- requestId 中间件
- 错误处理中间件
- 日志
- 环境变量加载

### 交付物
- `apps/shared-console-api/`

### 验收标准
- 本地可启动
- 服务器可启动
- `/health` 可访问

### 前置依赖
- 无

### 建议标签
- `P0`
- `backend`

---

## ISSUE 模板 08
### 标题
`[P0][backend][data] 建立控制台数据库 schema v1`

### 背景
控制台后续的实例、容器、版本、usage、health、审计都依赖统一数据库表结构。

### 范围
建立：
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
- 表结构可被 API 正常读写

### 前置依赖
- ISSUE 07

### 建议标签
- `P0`
- `backend`
- `data`

---

## ISSUE 模板 09
### 标题
`[P0][ops] 实现实例创建脚本`

### 背景
控制台要能创建 Shared 实例，先要把实例创建流程脚本化。

### 范围
实现：
- `ops/create-instance.sh`

能力包括：
- 创建实例目录
- 生成配置
- 分配端口
- 创建日志目录
- 创建 state dir

### 交付物
- 创建实例脚本
- 示例配置模板

### 验收标准
- 脚本可成功创建实例
- 端口不冲突
- 配置文件生成正确

### 前置依赖
- ISSUE 03
- ISSUE 05
- ISSUE 06

### 建议标签
- `P0`
- `ops`
- `internal-test`

---

## ISSUE 模板 10
### 标题
`[P0][frontend] 搭建控制台前端项目骨架`

### 背景
需要建立 Shared 内测控制台前端骨架，用于承载 Dashboard、实例页、容器页、升级页等。

### 范围
初始化：
- 前端项目
- 路由
- 页面布局
- API client
- 全局状态
- 基础组件库

### 交付物
- `apps/shared-console/`

### 验收标准
- 页面可启动
- 可切换页面
- 可请求测试 API

### 前置依赖
- 无

### 建议标签
- `P0`
- `frontend`

---

## ISSUE 模板 11
### 标题
`[P0][backend] 实现实例管理 API`

### 背景
控制台第一批最核心的就是实例管理能力。

### 范围
实现接口：
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

### 前置依赖
- ISSUE 07
- ISSUE 08
- ISSUE 09

### 建议标签
- `P0`
- `backend`

---

## ISSUE 模板 12
### 标题
`[P0][frontend] 实现实例列表页`

### 背景
实例列表页是第一批可见价值最大的控制台页面。

### 范围
实现：
- 实例列表
- 搜索
- 筛选
- 状态展示
- 跳转实例详情
- 创建实例按钮

### 交付物
- 实例列表页

### 验收标准
- 可加载实例列表
- 可筛选
- 可跳转详情

### 前置依赖
- ISSUE 10
- ISSUE 11

### 建议标签
- `P0`
- `frontend`

---

## 建议第一批就建的 12 条 issue

1. 标准化实例健康检查接口
2. 稳定 usage 输出格式
3. 实例配置模板化
4. 初始化 Ubuntu 内测服务器运行环境
5. 建立服务器目录规范与部署约定
6. 搭建控制台后端 API 项目骨架
7. 建立控制台数据库 schema v1
8. 实现实例创建脚本
9. 搭建控制台前端项目骨架
10. 实现实例管理 API
11. 实现实例列表页
12. 标准化 smoke 检查脚本
