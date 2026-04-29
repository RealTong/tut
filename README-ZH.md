# tut

英文版: [README.md](./README.md)

`tut` 是一个面向本地 AI 编码 agent 的 token usage 追踪服务。它运行在 Cloudflare Workers 上，使用 D1 存储归一化后的事件数据，提供查询 API，并自带 dashboard。

## 功能

- 将 usage 事件统一为共享字段：`model`、`provider`、`source`、`input`、`output`、`cacheRead`、`cacheWrite`
- 支持写入单条事件、事件数组，或 `{ "events": [...] }` / `{ "data": [...] }`
- 提供明细查询、汇总统计、分组聚合和维度排行
- 内置 dashboard 用于查看 usage 趋势
- 提供本地同步脚本，用于读取本机 agent 日志并上报

## 内置来源支持

当前仓库自带的 `scripts/sync-local.mjs` 只支持以下来源：

- `claude`：`~/.claude/projects/**/*.jsonl`
- `codex`：`~/.codex/sessions/**/*.jsonl` 和 `~/.codex/archived_sessions/**/*.jsonl`
- `hermes`：`$HERMES_HOME/state.db`，回退到 `~/.hermes/state.db`（仅统计 token 字段）
- `opencode`：`~/.local/share/opencode/opencode.db` 以及 legacy JSON 存储

当前自带同步脚本还不支持：

- `droid`
- `pi`
- `kimi`

不过写入 API 本身是通用的。只要其他工具能向 `POST /api/v1/usage` 发送合法事件，`tut` 就可以存储和查询这些数据，即使仓库里还没有为该工具内置本地解析器。

## 环境要求

- Node.js 和 npm，用于运行 Worker 应用
- Bun，用于执行 `npm run sync:local`
- Cloudflare Wrangler
- 一个 Cloudflare D1 数据库

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 创建名为 `tut` 的 D1 数据库：

```bash
npx wrangler d1 create tut
```

3. 将返回的 `database_id` 写入 [wrangler.jsonc](./wrangler.jsonc) 中 `d1_databases[0].database_id`。

4. 执行迁移：

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

如果你只做本地开发，执行本地迁移即可。正式部署前再执行远端迁移。

5. 配置写入 API 密钥：

```bash
npx wrangler secret put INGEST_API_KEY
```

6. 启动本地开发服务：

```bash
npm run dev
```

如果你使用的 D1 数据库名称不是 `tut`，需要同步更新 [package.json](./package.json) 里的迁移脚本，或者手动运行 Wrangler 命令。

## Dashboard

dashboard 入口为 `/`。

- `?lang=en` 或 `?lang=zh`
- `?theme=light` 或 `?theme=dark`
- 主题和语言偏好会持久化到 `localStorage`

示例：

```text
/
/?lang=zh
/?theme=dark
/?lang=zh&theme=dark
```

## API

### `GET /health`

返回服务健康状态，以及是否已配置 `INGEST_API_KEY`。

### `POST /api/v1/usage`

写入 usage 事件。

- 支持单对象、数组、`{ "events": [...] }`、`{ "data": [...] }`
- 单次请求最多 `1000` 条事件
- 认证方式：
  - `Authorization: Bearer <INGEST_API_KEY>`
  - `x-api-key: <INGEST_API_KEY>`

事件字段：

- 必填：`model`、`provider`、`source`
- token 计数字段：`input`、`output`、`cacheRead`、`cacheWrite`
- 可选：`eventId`、`occurredAt`、`metadata`

metadata 说明：

- `metadata` 可以是 JSON 对象、数组，或 JSON 字符串
- `filePath`、`filepath`、`file_path` 这类敏感路径字段会在入库前被移除

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/v1/usage \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <INGEST_API_KEY>' \
  -d '{
    "events": [
      {
        "eventId": "evt_001",
        "model": "claude-sonnet-4",
        "provider": "anthropic",
        "source": "claude",
        "input": 1200,
        "output": 380,
        "cacheRead": 900,
        "cacheWrite": 120,
        "occurredAt": "2026-03-06T00:30:00Z",
        "metadata": { "project": "tut" }
      }
    ]
  }'
```

### `GET /api/v1/usage`

返回分页明细。

常用查询参数：

- `model`、`provider`、`source`，支持逗号分隔
- `from`、`to`
- `limit`、`offset`
- `order=asc|desc`
- `sortBy=occurredAt|total|input|output|cacheRead|cacheWrite|createdAt`

### `GET /api/v1/usage/summary`

返回当前过滤条件下的汇总统计和时间范围。

### `GET /api/v1/usage/breakdown`

返回分组聚合结果。

- `by=source,provider,model,date`，可任意组合
- `sortBy=tokens|events|input|output|cacheRead|cacheWrite|source|provider|model|date`
- `order=asc|desc`
- `limit`、`offset`

### `GET /api/v1/usage/dimensions`

返回 `source`、`provider`、`model` 三个维度的排行统计。

## 本地同步

先 dry-run 看解析结果：

```bash
npm run sync:local -- --dry-run
```

上报到已部署的 Worker：

```bash
export TUT_API_TOKEN=<INGEST_API_KEY>
npm run sync:local -- --endpoint https://<your-worker-domain>/api/v1/usage
```

常用参数：

- `--sources claude,codex,opencode,hermes`
- `--since 2026-03-01`
- `--full`
- `--batch-size 200`
- `--state-file <path>`
- `--token <token>`

默认 checkpoint 文件：

- `~/.config/tut/sync-state.json`

## 构建与部署

构建：

```bash
npm run build
```

部署：

```bash
npm run deploy
```

## 迁移文件

- [migrations/0001_init_usage_events.sql](./migrations/0001_init_usage_events.sql)
- [migrations/0002_redact_filepath_metadata.sql](./migrations/0002_redact_filepath_metadata.sql)
