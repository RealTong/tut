# tut

`tut` 是一个部署在 Cloudflare Workers 上的 token usage 追踪 API，适配多种 agent（如 Claude Code、Codex、OpenCode、Droid、Pi、Kimi CLI）。

核心字段统一为：
- `model`
- `provider`
- `source`
- `input`
- `output`
- `cacheRead`
- `cacheWrite`

并统一入库到 D1，提供多维查询 API。

## 1. 安装与启动

```bash
npm install
npm run dev
```

## 2. 配置 D1

1. 创建数据库：

```bash
npx wrangler d1 create tut
```

2. 将返回的 `database_id` 写入 [wrangler.jsonc](/Users/realtong/Developer/tut/wrangler.jsonc) 的 `d1_databases[0].database_id`。

3. 执行迁移：

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

迁移文件：
- [migrations/0001_init_usage_events.sql](/Users/realtong/Developer/tut/migrations/0001_init_usage_events.sql)

## 3. API

### POST `/api/v1/usage`

写入 usage 事件，支持：
- 单对象
- 数组
- `{ "events": [...] }`
- `{ "data": [...] }`

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/v1/usage \
  -H 'Content-Type: application/json' \
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

### GET `/api/v1/usage`

分页明细查询。

常用参数：
- `model`, `provider`, `source`（支持逗号分隔）
- `from`, `to`（ISO 时间或 `YYYY-MM-DD`）
- `limit`, `offset`
- `sortBy=occurredAt|total|input|output|cacheRead|cacheWrite|createdAt`
- `order=asc|desc`

### GET `/api/v1/usage/summary`

总体统计（事件数、token 总量、时间范围），支持同样过滤参数。

### GET `/api/v1/usage/breakdown`

分组聚合，参数：
- `by=source,provider,model,date`（任意组合）
- `sortBy=tokens|events|input|output|cacheRead|cacheWrite|source|provider|model|date`
- `order=asc|desc`
- `limit`, `offset`

### GET `/api/v1/usage/dimensions`

返回 source/provider/model 维度排名（事件数、token 数），支持同样过滤参数。

## 4. 部署

```bash
npm run deploy
```

## 5. 本地 Agent 数据同步脚本

新增脚本：
- [scripts/sync-local.mjs](/Users/realtong/Developer/tut/scripts/sync-local.mjs)

支持来源：
- `claude`（`~/.claude/projects/**/*.jsonl`）
- `codex`（`~/.codex/sessions/**/*.jsonl` + `~/.codex/archived_sessions/**/*.jsonl`）
- `opencode`（优先 `~/.local/share/opencode/opencode.db`，并补充 legacy JSON）

先 dry-run 看解析结果：

```bash
npm run sync:local -- --dry-run
```

正式上报：

```bash
npm run sync:local -- --endpoint https://<your-worker-domain>/api/v1/usage
```

常用参数：
- `--sources claude,codex,opencode`
- `--since 2026-03-01`
- `--full`（忽略 checkpoint 全量扫描）
- `--batch-size 200`
- `--state-file <path>`
- `--token <token>`（或环境变量 `TUT_API_TOKEN`）

Checkpoint 默认写入：`~/.config/tut/sync-state.json`

## 6. 构建检查

```bash
npm run build
```
