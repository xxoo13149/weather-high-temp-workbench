# PolyWeather 对标结论：工程与稳定性视角

## 范围与边界

- 参考对象：`https://github.com/yangyuan-zhen/PolyWeather`
- 我们项目主仓库：`D:\weather`
- 本文只看工程与稳定性，不讨论概率层产品路线。
- 结论边界保持不变：
  - 我们项目为主，PolyWeather 为辅。
  - 不做概率层。
  - 不把 `edge%` / 错价扫描做主叙事。
  - 不引入用户看不懂的功能。

## 一句话结论

PolyWeather 在“后端之外的工程副线”明显更成熟，尤其是运行态持久化、预热 worker、Prometheus 告警、运营后台、Telegram/Bot 多端复用这几个方向；我们已经在入口稳定性、Cloudflare 边缘兜底、Windows 源站服务化、健康接口和基础指标上补到了可上线水平，但仍缺少“跨重启保留状态 + 主动预热 + 外部告警 + 全链路巡检”的闭环。

## 证据链

### PolyWeather 已做到的成熟工程项

1. 部署拓扑更完整
   - `docker-compose.yml` 同时声明了 `polyweather_web`、`polyweather_prewarm`、`polyweather_prometheus`、`polyweather_alertmanager`、`polyweather_alert_relay`、`polyweather_grafana`。
   - README 明确写了前端 Vercel、后端 FastAPI、Bot、Prewarm、监控栈的参考架构。

2. 运行态存储是持久化的
   - `src/database/runtime_state.py` 把 daily record、truth record、telegram alert state、Open-Meteo cache、official intraday observation 等运行态落到 SQLite。
   - `src/database/db_manager.py` 通过 `POLYWEATHER_DB_PATH` 指向外部运行目录。
   - `scripts/migrate_runtime_state_to_sqlite.py`、`scripts/export_runtime_state_from_sqlite.py`、`scripts/verify_runtime_state_storage.py` 说明它已经把“迁移 / 导出 / 校验”当成正式运维链路。

3. 预热不是页面顺手缓存，而是独立 worker
   - `src/utils/prewarm_dashboard.py` 维护 `cycle_count / success_count / failure_count / heartbeat` 等运行态，并持久化共享状态。
   - `scripts/prewarm_dashboard_worker.py` 支持独立进程循环预热。
   - `web/core.py` 的 `build_system_status_payload()` 把 `prewarm` 状态公开到系统状态接口。

4. 外部可观测性已经成套
   - `web/routes.py` 暴露 `/healthz`、`/api/system/status`、`/metrics`。
   - `src/utils/metrics.py` 提供 HTTP/source metrics 聚合。
   - `monitoring/prometheus/alerts.yml` 已有 `WebDown`、`5xxBurst`、`HighSourceErrorRate`、`SlowHttpAverage` 等规则。
   - `docs/MONITORING_ZH.md` 明确了 Prometheus + Alertmanager + Relay + Grafana + 巡检脚本的闭环。

5. 运维后台和 Bot 共用同一分析核心
   - README 的架构图写明 Web 和 Telegram Bot 共用同一个 FastAPI 分析核心。
   - `src/bot/runtime_coordinator.py` 统一启动 trade alert、dashboard prewarm、payment loop 等后台循环。
   - `src/bot/observability.py`、`src/utils/telegram_push.py` 说明它不仅有 Bot，而且把 Bot 当成运维和分发的一部分。
   - `docs/OPS_ADMIN_ZH.md` 与 `web/routes.py` 的 `/api/ops/*` 说明它已有最小运营后台。

### 我们已经做到的工程项

1. 公网入口稳定性已经比普通单机服务更强
   - `src/cloudflare/worker.ts` 里有 Worker 本地执行 + 源站代理的双路径。
   - `fetchKellyOriginGet()`、`fetchKellyOriginStream()` 已实现超时、5xx、握手失败回退。
   - `KELLY_PROXY_FAILURE_THRESHOLD / WINDOW / OPEN_DURATION` 说明熔断器已上线。

2. 源站已经服务化，不再是手工拉起
   - `scripts/windows/kelly-origin-service.ps1` 用 NSSM 固化 `AppStdout`、`AppStderr`、`AppExit Default Restart`、开机自启式的 Windows Service 配置。
   - `scripts/windows/watch-kelly-origin.ps1` 已实现 1 分钟健康检查、2 次失败自动重启、5 分钟烟雾请求。

3. 我们也有健康接口和 Prometheus 文本指标
   - `src/app.ts` 暴露 `/healthz`、`/api/system/status`、`/metrics`。
   - `src/cloudflare/worker.ts` 也暴露 `/healthz`、`/api/system/status`、`/metrics`，并把 `kellyProxy` 运行态带出来。
   - `src/operational-metadata.ts` 已输出 location coverage、source contract coverage、runtime cache、Kelly stream hub 等指标。

4. Kelly 运行态观测已经比很多同类项目更贴业务
   - `src/providers/meteoblue/service.ts` 有 `weekCaches`、`multiModelImageCaches`、`multiModelDistributionCaches`、`kellyStreamHubs`、`getKellyRuntimeHealth()`、`getSystemStatus()`。
   - 同文件还能看到 `activeHubCount`、`fallbackMode`、`lastOrderbookFailureAt` 等运行态字段。

5. 边缘缓存和本地缓存已经形成两层
   - `src/cloudflare/worker.ts` 的 `withEdgeJsonCache()` 已经在 Cloudflare Edge 做短 TTL 缓存。
   - `src/lib/cache.ts` 的 `RefreshableCache` 已经支持 `staleWhileRevalidate`、`allowStaleOnError`。

## 关键差异

### 1. 后端架构

- PolyWeather：`FastAPI + SQLite + 独立 worker + 监控栈 + Bot`
- 我们：`Fastify/Node + Cloudflare Worker + Windows Kelly 源站 + 内存缓存`

判断：
- 我们在“公网入口抗抖动”上更有针对性，尤其是 Worker 本地 fallback。
- PolyWeather 在“服务内生态完整度”上更成熟，后台 worker、运维面板、外部告警更完整。

### 2. 部署方式

- PolyWeather：`docker-compose.yml` 把 web / prewarm / prometheus / alertmanager / grafana 一起声明，偏标准化 Linux/VPS 部署。
- 我们：`wrangler.toml` + Windows NSSM + watchdog，能跑且已上线，但更偏定制化，迁移和复制环境成本更高。

### 3. 运行态存储

- PolyWeather：SQLite 是主路径，重启后状态、缓存索引、alert state 还能保留。
- 我们：核心缓存仍是进程内 `Map + RefreshableCache`，Worker 熔断状态也是 isolate 内存；真正持久化的主要是收藏 KV 和 watchdog JSON。

### 4. 预热

- PolyWeather：已有独立 `prewarm worker`、heartbeat、运行态摘要。
- 我们：目前更像“请求驱动缓存”，没有明确的后端热城市预热 worker。

### 5. 可观测性与告警

- PolyWeather：`/healthz + /api/system/status + /metrics + Prometheus + Alertmanager + Relay + Grafana + check_ops_health.py`
- 我们：`/healthz + /api/system/status + /metrics + Windows watchdog`，但缺外部告警与趋势面板。

### 6. 运维闭环

- PolyWeather：有 `/api/ops/*` 和运营后台文档，能做系统状态、支付事故、会员、积分等日常运维。
- 我们：当前只有服务脚本、watchdog、runbook，属于“工程运维闭环已起步，但还没有运维操作面”。

### 7. Bot / 多端复用

- PolyWeather：Web 与 Telegram Bot 复用同一分析核心，后台循环也统一编排。
- 我们：当前以网站和 Worker 为主，没有正式的 Bot / 多端协同层。

## 可搬运项分类

### 直接适合搬

1. 独立预热 worker + heartbeat
   - 我们最缺的是“主动把热门城市打热”，不是再堆更多页面缓存。
   - 适合做成 Node 后台任务，优先预热首页摘要、分析详情、Kelly snapshot。

2. 全链路巡检脚本
   - PolyWeather 的 `scripts/check_ops_health.py` 思路很适合我们。
   - 我们应补一条跨 Worker -> 源站 -> Kelly API 的巡检，而不只检查本机 `127.0.0.1:8081`。

3. 外部告警最小版
   - 先不必一口气上完整 Grafana 平台，但至少应把 `/metrics` 接到可告警系统。
   - 重点告警：源站不可达、Worker fallback 连续触发、热城市数据陈旧、预热失败率高。

4. 统一系统状态模型
   - 我们已有 `/api/system/status`，适合继续补 `prewarm`、`source freshness`、`city detail completeness`、`origin chain status`。

### 降级后再搬

1. SQLite 运行态存储
   - 值得做，但不建议照 PolyWeather 全量表设计直接搬。
   - 我们先做“运维态 SQLite”，只存 prewarm heartbeat、source freshness、smoke 结果、fallback 事件、cache 摘要，就足够高价值。

2. Prometheus + Grafana + Alertmanager 全家桶
   - 思路成熟，但我们的现网是 Worker + Windows 源站，不适合原样照搬 docker-compose。
   - 建议先降级成：
     - 远端定时巡检
     - Prometheus 文本抓取
     - 一个轻量告警通道
   - 等后面基础稳定后，再看是否补图表面板。

3. 统一后台循环协调器
   - PolyWeather 的 `src/bot/runtime_coordinator.py` 很适合有多个 worker/loop 的系统。
   - 我们可以先把 prewarm、smoke、城市补齐、源站检查做成统一 task coordinator，而不必连 Bot 一起上。

### 只参考不实施

1. `/ops` 里的支付、会员、积分、事故后台
   - 与我们当前主线无关，会明显分散精力。

2. Telegram 市场推送体系
   - 工程上很完整，但目前不是我们最值钱的缺口。

3. 概率训练 / 回测 / calibration 工具链
   - 明确不进入本项目主线。

## 最值得优先做的 3 件事

### P1. 先做“后端预热 worker”

原因：
- 这是我们当前工程短板里最直接影响用户体感的一项。
- 它能同时改善首页、分析页、Kelly 页首屏稳定性。

建议范围：
- 热城市白名单
- 首页 dashboard 预热
- 分析详情预热
- Kelly snapshot 预热
- heartbeat / success / failure / last run 暴露到 `/api/system/status`

### P2. 再做“全链路巡检 + 告警”

原因：
- 我们已经有 `/healthz` 和 `/metrics`，最缺的是“谁来盯”。
- 只靠 Windows watchdog 还看不到 Worker fallback 风暴、数据陈旧、跨链路异常。

建议范围：
- Worker `/healthz`
- 源站 `/healthz`
- `GET /api/weather/kelly`
- canary `stream` 握手
- 连续失败写入运维态存储并触发告警

### P3. 最后补“轻量运行态持久化”

原因：
- 没有持久化，重启后很多工程状态全丢。
- 这会限制预热、告警、趋势判断和运维复盘。

建议范围：
- 不碰业务主数据
- 只存：
  - prewarm runtime
  - smoke 历史
  - source freshness
  - fallback / circuit 事件摘要
  - 热城市最近一次成功时间

## 结论

如果只看工程成熟度，PolyWeather 领先我们的不是“天气核心算法”，而是“围绕核心服务的一整圈工程基础设施”。  
我们已经把最关键的公网可用性和 Kelly 服务化补起来了，但现在最该补的不是更多前台功能，而是：

1. 后端主动预热  
2. 全链路巡检与告警  
3. 轻量运行态持久化

这三件补上后，我们的稳定性会从“能用、能兜底”升级到“可持续运营、可观测、可复盘”。

## 来源

- PolyWeather README  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/README.md
- PolyWeather 部署拓扑  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/docker-compose.yml
- PolyWeather 监控文档  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/MONITORING_ZH.md
- PolyWeather 运维后台文档  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/OPS_ADMIN_ZH.md
- PolyWeather 健康与系统状态路由  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/web/routes.py
- PolyWeather 系统状态聚合  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/web/core.py
- PolyWeather 运行态存储  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/src/database/runtime_state.py
- PolyWeather 预热 worker  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/src/utils/prewarm_dashboard.py
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/scripts/prewarm_dashboard_worker.py
- PolyWeather 告警规则  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/monitoring/prometheus/alerts.yml
- PolyWeather Bot 编排与观测  
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/src/bot/runtime_coordinator.py
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/src/bot/observability.py
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/src/utils/telegram_push.py

- 我们的 Worker 部署与入口  
  - `D:\weather\wrangler.toml`
- 我们的 Worker 熔断 / fallback / 健康输出  
  - `D:\weather\src\cloudflare\worker.ts`
- 我们的服务健康与系统状态  
  - `D:\weather\src\app.ts`
  - `D:\weather\src\operational-metadata.ts`
- 我们的缓存与 Kelly 运行态  
  - `D:\weather\src\lib\cache.ts`
  - `D:\weather\src\providers\meteoblue\service.ts`
- 我们的 Windows 服务化与 watchdog  
  - `D:\weather\scripts\windows\kelly-origin-service.ps1`
  - `D:\weather\scripts\windows\watch-kelly-origin.ps1`
