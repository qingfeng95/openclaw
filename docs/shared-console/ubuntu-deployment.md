# Shared Console Ubuntu 部署约定

本文档约束的是目标运行环境，不是本地开发环境。

## 环境边界

- Windows 11：本地开发、调试、提交 GitHub
- Ubuntu：部署 `shared-console-api`、运行 Docker、管理实例、验证真实行为
- Shared / Dedicated 实例的创建、启动、停止、健康检查，都以 Ubuntu 上的宿主机和容器为准

## 宿主机目录约定

建议在 Ubuntu 宿主机准备这些目录：

- `/www/openclaw/repo`
- `/www/openclaw/logs`
- `/www/openclaw/data`
- `/www/openclaw/shared-instances`
- `/www/openclaw/dedicated-instances`

建议含义：

- `/www/openclaw/repo`
  当前 OpenClaw 仓库工作副本，`shared-console-api` 和前端静态资源都从这里运行
- `/www/openclaw/shared-instances`
  shared 实例目录根
- `/www/openclaw/dedicated-instances`
  dedicated 实例目录根

## 容器内目录约定

当前代码默认假设容器内目录如下：

- 仓库根：`/www/openclaw/repo`
- shared 实例根：`/www/openclaw/shared-instances`
- dedicated 实例根：`/www/openclaw/dedicated-instances`

这些默认值来自 `ops/shared-instance-common.sh`，可以被环境变量覆盖：

- `OPENCLAW_CONTAINER_REPO_ROOT`
- `OPENCLAW_CONTAINER_INSTANCES_ROOT`
- `OPENCLAW_CONTAINER_SHARED_INSTANCES_ROOT`
- `OPENCLAW_CONTAINER_DEDICATED_INSTANCES_ROOT`

如果你的容器布局不是这套路径，部署时必须显式设置，不要依赖默认值。

## 挂载要求

container-managed 实例要正常工作，宿主机实例目录和容器内实例目录必须可对应访问。

最小要求：

- 宿主机 `/www/openclaw/shared-instances` 挂载到目标容器内约定的实例目录
- 宿主机 `/www/openclaw/dedicated-instances` 挂载到目标容器内约定的实例目录
- 宿主机仓库 `/www/openclaw/repo` 在目标容器内也可访问，或通过 `OPENCLAW_CONTAINER_REPO_ROOT` 显式声明容器内路径

原因：

- `create-instance.sh` 在宿主机创建目录并写 `instance.env`
- `start-instance.sh` / `stop-instance.sh` 通过 `docker exec` 在容器内启动和停止实例
- pid、log、state、config 路径需要宿主机 API 和容器内进程同时看得到

如果没有这层挂载，常见症状是：

- 实例启动后宿主机看不到 pid 文件
- API 无法判断实例运行态
- 日志和 state 无法回传到控制台

## shared-console-api 运行环境变量

Ubuntu 上建议至少设置：

```bash
export SHARED_CONSOLE_API_HOST=127.0.0.1
export SHARED_CONSOLE_API_PORT=43100
export SHARED_CONSOLE_API_INSTANCES_ROOT=/www/openclaw/shared-instances
export SHARED_CONSOLE_API_DEDICATED_INSTANCES_ROOT=/www/openclaw/dedicated-instances
```

按需补充：

```bash
export SHARED_CONSOLE_API_BASH=/bin/bash
export SHARED_CONSOLE_API_PROBE_TIMEOUT_MS=1500
export OPENCLAW_CONTAINER_REPO_ROOT=/www/openclaw/repo
export OPENCLAW_CONTAINER_SHARED_INSTANCES_ROOT=/www/openclaw/shared-instances
export OPENCLAW_CONTAINER_DEDICATED_INSTANCES_ROOT=/www/openclaw/dedicated-instances
export SHARED_CONSOLE_HOST=127.0.0.1
export SHARED_CONSOLE_PORT=43101
export SHARED_CONSOLE_API_BASE=http://<public-host>:43102/api
```

如使用 systemd，可以直接基于仓库内模板安装：

```bash
sudo bash ops/install-systemd-services.sh --start
```

模板文件：
- `ops/systemd/shared-console-api.service`
- `ops/systemd/shared-console-web.service`
- `ops/shared-console.env.example`

运行方式：

```bash
pnpm shared-console-api:dev
```

或由你自己的进程管理器托管。

## 目标容器前置条件

被实例绑定的目标容器至少要满足：

- 容器内可执行 `node`
- 容器内存在仓库入口 `openclaw.mjs`
- 容器内能访问实例目录挂载路径
- 当前 Ubuntu 宿主机上的 `shared-console-api` 运行账号有权限执行 `docker exec`

如果不满足这些条件，container-managed 实例不会稳定工作。

## 反向代理与访问控制

生产或长期联调时，推荐把 `shared-console-api` 和 `shared-console-web` 都只绑定到 `127.0.0.1`，再由单独的反向代理对外暴露。

仓库内提供了一个 Nginx 示例：

- `ops/nginx/shared-console-proxy.conf.example`

这个示例默认：

- 公网入口监听 `43102`
- `/api/` 代理到 `127.0.0.1:43100`
- `/` 代理到 `127.0.0.1:43101`
- 全站启用 Basic Auth

典型步骤：

1. 安装 Nginx
2. 把 systemd 环境文件中的：
   - `SHARED_CONSOLE_API_HOST`
   - `SHARED_CONSOLE_HOST`
   改为 `127.0.0.1`
3. 把 `SHARED_CONSOLE_API_BASE` 改成对外可访问的代理地址，例如 `http://223.254.144.141:43102/api`
4. 把示例配置复制到 `/etc/nginx/conf.d/shared-console.conf`
5. 创建 `auth_basic_user_file` 指向的密码文件
6. `nginx -t && systemctl reload nginx`

如果宿主机上 80/443 已被其他项目占用，不要抢占旧端口；直接让 Shared Console 代理监听单独端口即可。

## 实例行为约定

### Host 实例

- 由宿主机直接运行 `node openclaw.mjs gateway`
- `ops/start-instance.sh` / `ops/stop-instance.sh` 直接管理宿主机进程

### Container 实例

- 实例元数据仍由宿主机创建
- 启停由宿主机通过 `docker exec` 进入目标容器执行
- probe 优先在容器内访问 `127.0.0.1:<port>`
- 不再要求把实例端口额外映射回 API 宿主机

## 推荐部署顺序

1. 在 Ubuntu 上拉取仓库到 `/www/openclaw/repo`
2. 建好 `/www/openclaw/shared-instances` 和 `/www/openclaw/dedicated-instances`
3. 让目标容器按约定挂载这些目录
4. 启动 `shared-console-api`
5. 启动 `shared-console` 前端或发布其静态产物
6. 先创建一个 host 实例做通路验证
7. 再创建一个 container 实例验证 `docker exec`、pid、probe、日志是否闭环

## 当前不建议的做法

- 在 Windows 上直接模拟 Ubuntu 的真实容器运维结果
- 让 container 实例偷偷走宿主机启动
- 不挂载实例目录，只在容器内临时生成 pid/log/state
- 假设容器实例一定会把端口映射回宿主机

## 验收检查

至少确认这些点：

- `GET /api/instances` 能看到 shared 实例
- `GET /api/dedicated-instances` 能看到 dedicated 实例
- host 实例可正常 start/stop/restart
- container 实例可正常 start/stop/restart
- container 实例 `includeProbe=1` 时能返回健康信息
- 控制台能读取目标容器日志
