# PostgreSQL for OpenClaw

This directory contains the Docker-based PostgreSQL setup for the OpenClaw control plane.

## Files

- `docker-compose.yml` - container definition
- `init.sql` - initial schema
- `deploy.sh` - start and verify the database
- `backup.sh` - export a SQL backup
- `tunnel.sh` - open an SSH tunnel for local access
- `DEPLOY.md` - deployment steps
- `INTEGRATION.md` - app integration notes

## Quick start

```bash
cd /www/openclaw/postgres
bash deploy.sh
```

If you need to access it locally through SSH tunnel:

```bash
bash tunnel.sh
```
