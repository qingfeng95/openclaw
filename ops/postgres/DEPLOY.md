# PostgreSQL 部署说明

本文档用于在 `223.254.144.141:17238` 这台服务器上部署 Docker 版 PostgreSQL，并通过 SSH 隧道在本地访问。

## 目录

建议在服务器上使用：

```bash
/www/openclaw/postgres
```

需要放置以下文件：

- `docker-compose.yml`
- `init.sql`
- `.env`

## 1. 在服务器上创建目录

```bash
mkdir -p /www/openclaw/postgres/data /www/openclaw/postgres/backups
```

## 2. 上传项目里的文件

把本地仓库中的这些文件同步到服务器：

- `ops/postgres/docker-compose.yml`
- `ops/postgres/init.sql`

同步后，服务器上的目录应包含：

- `/www/openclaw/postgres/docker-compose.yml`
- `/www/openclaw/postgres/init.sql`

## 3. 创建 `.env`

在服务器上创建 `/www/openclaw/postgres/.env`：

```env
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=change_me_strong_password
POSTGRES_DB=openclaw_control
POSTGRES_PORT=5432
POSTGRES_HOST_BIND=127.0.0.1
OPENCLAW_TZ=Asia/Shanghai
POSTGRES_DATA_DIR=./data
```

## 4. 启动 PostgreSQL

```bash
cd /www/openclaw/postgres
docker compose up -d
```

如果你的环境还在用旧版命令，也可以：

```bash
cd /www/openclaw/postgres
docker-compose up -d
```

## 5. 检查健康状态

```bash
docker ps
docker logs --tail=50 openclaw-postgres
docker exec -it openclaw-postgres pg_isready -U openclaw -d openclaw_control
```

## 6. 本地通过 SSH 隧道访问

在本地运行：

```bash
ssh -p 17238 -L 5433:127.0.0.1:5432 root@223.254.144.141
```

然后本地连接：

```text
postgresql://openclaw:change_me_strong_password@127.0.0.1:5433/openclaw_control
```

## 7. 初始化表结构

首次启动时，`init.sql` 会在数据目录为空的时候自动执行。

如果你后续需要手动重建数据，请先确认：

- `./data` 是空的，或
- 你已经完成备份

## 8. 备份

手动备份：

```bash
docker exec openclaw-postgres pg_dump -U openclaw openclaw_control > /www/openclaw/postgres/backups/backup-$(date +%F).sql
```

## 9. 恢复

```bash
cat /www/openclaw/postgres/backups/backup-2026-04-21.sql | docker exec -i openclaw-postgres psql -U openclaw -d openclaw_control
```

## 10. 部署建议

- 不要把 `5432` 直接暴露到公网。
- 优先使用 SSH 隧道访问本地开发数据库。
- 正式应用如果和数据库在同一台服务器上，可以直接连 `127.0.0.1:5432`。
- 以后接入 tenant / audit / quota / usage ledger 时，优先把控制面状态落到这个 PostgreSQL。
