# PostgreSQL 接入说明

本文档说明 Shared Console / 控制面项目如何接入 PostgreSQL。

## 1. 连接方式

项目建议通过环境变量 `DATABASE_URL` 连接数据库。

### 本地开发
如果你在本地通过 SSH 隧道访问远程 PostgreSQL：

```env
DATABASE_URL=postgresql://openclaw:crewclaw@73557356@127.0.0.1:5433/openclaw_control
```

### 服务器上运行的应用
如果应用和 PostgreSQL 运行在同一台服务器上：

```env
DATABASE_URL=postgresql://openclaw:crewclaw@73557356@127.0.0.1:5432/openclaw_control
```

## 2. 推荐接入范围

优先把以下控制面状态放入 PostgreSQL：

- tenant 主数据
- tenant / instance 归属关系
- user / tenant 绑定关系
- role / permission
- audit 事件
- quota 规则
- usage ledger

## 3. 建议保留文件方式的内容

短期内可以继续保留文件或 JSON 的内容：

- 模型渠道草稿
- 实例运行时配置文件
- 轻量导出 JSON
- 临时缓存

## 4. 表结构建议

最小建议表：

- `tenants`
- `users`
- `user_tenants`
- `instance_tenants`
- `audit_events`
- `quotas`
- `usage_ledger`

## 5. 开发顺序建议

1. 先接入 `DATABASE_URL`
2. 再实现 tenant 读写
3. 再接 audit
4. 再接 quota
5. 最后接 usage ledger

## 6. 部署注意事项

- 本地调试优先使用 SSH 隧道，不要直接暴露数据库端口。
- 生产环境数据库账号不要使用超级用户。
- 数据库必须做定期备份。
- 后续如果引入迁移工具，建议统一管理 schema 版本。
