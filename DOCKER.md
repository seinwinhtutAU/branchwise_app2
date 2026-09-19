# BranchWise Docker 使用指南 / Docker Guide

BranchWise 提供了完整的 Docker 支持，包含 FastAPI 后端（Python 3.11 + uv）、React Web 前端（Nginx 静态托管与 API 反向代理），以及可选的本地 PostgreSQL 数据库。

---

## 目录结构 / Docker Files

- `docker-compose.yml`: 一键启动后端、前端与可选数据库容器配置。
- `backend/Dockerfile`: FastAPI 后端镜像，基于 `python:3.11-slim`，使用 `uv` 快速构建。
- `backend/entrypoint.sh`: 容器启动脚本，自动根据配置执行数据库迁移 (`alembic upgrade head`)。
- `frontend/Dockerfile`: 多阶段构建镜像，第一阶段编译 Web SPA，第二阶段使用 `nginx:alpine` 部署。
- `frontend/nginx.conf`: Nginx 反向代理配置，内置 SPA 路由支持与 `/api/` 路由转发。
- `.env.docker.example`: Docker 环境变量模版。

---

## 快速上手 / Quick Start

### 1. 准备环境变量（已配置 backend/.env 时可跳过）

> [!TIP]
> `docker-compose.yml` 已经配置为**直接自动读取 `backend/.env`**！
> 如果你的 `backend/.env` 里已经配好了 Neon 的 `DATABASE_URL` 和 `NEON_AUTH_BASE_URL`，**不需要再复制或重复配置到根目录**，直接进入第 2 步启动即可。

如果你需要在根目录统一管理环境变量，或在全新机器上部署：
```bash
cp .env.docker.example .env
```
根目录 `.env` 中的变量可用于覆盖默认值。

### 2. 启动服务

```bash
# 构建并后台启动后端和前端服务
docker compose up -d --build
```

启动完成后，即可访问：
- **前端 Web 界面**：[http://localhost:3000](http://localhost:3000)
- **后端 API 接口**：[http://localhost:8000](http://localhost:8000)
- **API Swagger 文档**：[http://localhost:8000/docs](http://localhost:8000/docs) 或 [http://localhost:3000/docs](http://localhost:3000/docs)

---

## 高级用法 / Advanced Usage

### 模式 A：使用本地 Docker PostgreSQL 数据库

如果你想在本地完全使用 Docker 运行 PostgreSQL 而不使用 SQLite 或云端 Neon，可以使用内置的 `local-db` profile：

1. 修改 `.env`：
   ```env
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/branchwise
   ```
2. 启动命令加上 `--profile local-db`：
   ```bash
   docker compose --profile local-db up -d --build
   ```

### 模式 B：仅构建和运行单个容器

#### 仅运行后端：
```bash
docker build -t branchwise-backend ./backend
docker run -d -p 8000:8000 --name branchwise-backend branchwise-backend
```

#### 仅运行前端：
```bash
docker build -t branchwise-frontend -f frontend/Dockerfile .
docker run -d -p 3000:80 --name branchwise-frontend branchwise-frontend
```

---

## 常用运维命令 / Common Commands

```bash
# 查看容器运行状态
docker compose ps

# 查看日志
docker compose logs -f

# 查看后端日志
docker compose logs -f backend

# 停止容器
docker compose down

# 停止并删除持久化数据卷（清空本地 SQLite 或 Postgres 数据）
docker compose down -v
```
