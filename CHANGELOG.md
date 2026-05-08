# 更新日志

本文记录全球机场高温天气决策台的关键版本变化。格式参考 Keep a Changelog 的分组思路，并按最近版本优先排列。

## v0.1.12 - 多模型加载 UX 稳定

发布时间：2026-05-07

### 新增

- 新增 `tools/measure-multimodel-render-timing.mjs`，支持真实 Cloudflare 域名下的 `direct`、`switch`、`burst`、`click-burst` 多模型渲染时延验证。
- `click-burst` 模式使用真实城市按钮快速点击，能区分请求未发出、API 失败、仍在加载、返回但未渲染等状态。

### 改进

- 分析页已有 dashboard 时，不再让多模型整页 skeleton 遮住工作区。
- 模型排名为空但 insight 正在加载时，显示明确的排名加载态，避免用户误判为“完全加载不出来”。

### 验证

- `npm run build`
- `npm run check`
- `npm test`，249 passed
- Cloudflare 线上真实点击：9 个城市、50ms 间隔，最后城市约 1.63s 渲染，多模型 insight/distribution 均为 200。
- Cloudflare 线上 burst：7 组全部 `render_ready`，p50 约 1.44s，max 约 1.71s。

## v0.1.11 - 多模型稳定性硬化

发布时间：2026-05-07

### 修复

- 修复多模型 insight/distribution 超时后底层请求仍继续运行的问题，timeout 会联动 abort。
- `MULTIMODEL_ORIGIN_UNAVAILABLE` 不再进入会放大故障的 warmup/general 503 重试路径。
- origin location-version skew 被识别为非重试错误，不再计入全局 multimodel circuit。
- 当 analysis 和 image 都不可用时，source metadata 的 multimodel freshness 正确标记为 `fallback_error`。

### 验证

- `npm run build`
- `npm run check`
- `npm test`
- 52 城市线上多模型 API sweep：52/52 成功，p95 约 537ms。

## v0.1.10 - 多模型 Origin Proxy

发布时间：2026-05-07

### 背景

- Cloudflare 线上 analysis-all 测试出现 43/52 成功，失败包含 Cloudflare 1102 `Worker exceeded resource limits`。
- 结论是 Worker 不适合承载重型 multimodel 抓取和解析。

### 新增

- Cloudflare Worker 在配置 `KELLY_SERVER_BASE_URL` 后，将 `/api/weather/multimodel/status`、`/distribution`、`/insights`、`/image` 代理到 origin。
- `/healthz` 增加 multimodel origin timeout 和 circuit 健康字段。

### 改进

- origin 不健康时返回 retryable `MULTIMODEL_ORIGIN_UNAVAILABLE`，不再在 Worker 内执行重型本地 fallback。
- 前端多模型 timeout budget 扩展到 35s，并能 retry code-less 502/503/504。
- 空模型列表区域优先展示 insight error，而不是含糊的空状态。

### 验证

- `npm run check`
- `npm run build`
- `npm test`
- Targeted Worker and Meteoblue tests：71 passed

## v0.1.9 - HTTP 状态驱动的多模型重试

发布时间：2026-05-07

### 改进

- 多模型 `WeatherApiError` 遇到 HTTP 502、503、504 时进入 retry loop。
- 保留 `retryable: false` 的 fail-fast 语义，避免不可恢复错误被重复请求。

### 背景

- v0.1.8 的 52 城市前端等价测试仍出现 code-less 503，这些响应没有进入外层多模型 retry loop。

## v0.1.8 - 瞬时多模型失败自动恢复

发布时间：2026-05-07

### 改进

- 前端对短时上游/Worker 队列尖峰自动重试，包括 `UPSTREAM_BAD_STATUS`、`UPSTREAM_FETCH_FAILED`、`MULTIMODEL_PAGE_TIMEOUT`、`MULTIMODEL_HIGHCHARTS_TIMEOUT` 等。
- 多模型队列等待从 30s 降到 8s，让饱和状态能更快返回给前端 retry loop。

### 背景

- v0.1.7 后，部分 52 城市 sweep 失败城市在立即重试时成功，说明剩余问题主要是 transient。

## v0.1.7 - Distribution 延迟加载

发布时间：2026-05-07

### 改进

- 先加载 insight，确认请求仍属于当前城市/时间戳后，再加载 distribution。
- location surface prewarm 不再预热 distribution，减少用户当前不可见数据占用 Worker/origin 能力。
- 延续渐进式渲染：Insight 先显示，Distribution 后补齐。

### 背景

- v0.1.6 线上测量显示仍有 `MULTIMODEL_CACHE_LOAD_BUSY`，主要压力来自 distribution 过早启动。

## v0.1.6 - 渐进式多模型分析渲染

发布时间：2026-05-07

### 改进

- Insight 请求成功后立即渲染模型排名，不再等待 distribution。
- Distribution 失败只影响分布卡片，不再清空整个分析工作区。
- 冷 `getMultiModelStatus` 不再触发隐藏 multimodel page/highcharts load。
- 后台 multimodel cache load 并发从 7 降到 2，保护前台用户请求。

## v0.1.5 - 前台缓存优先级

发布时间：2026-05-07

### 改进

- 冷启动前台 cache read 可以越过正在执行的后台 load。
- dashboard/status background warmup 不再让分析页用户等待慢后台任务。
- 前台 load 获胜后，旧后台结果不会覆盖前台结果。

### 背景

- 线上 smoke 发现武汉冷分析路径中，insights 很快返回，但 distribution 可能排在后台 refresh 后面直到浏览器 20s timeout。

## v0.1.4 - Source Read State 和地点审计

发布时间：2026-05-07

### 新增

- `npm run audit:meteoblue-locations`，用于检查配置的 meteoblue location links 与 multimodel chart 坐标。

### 修复

- 多模型 analysis 只有解析出 insight 数据时才算 read，而不是仅凭 scrape timestamp 或 image URL。
- Home source card 在多模型 analysis 缺失或 revalidating 时保持 unread/pending。
- 修复 Los Angeles International Airport 的 meteoblue week path id。

## v0.1.3 - 多模型切换硬化

发布时间：2026-05-07

### 改进

- 多模型后台刷新改为前台优先，并保留 1 个前台并发槽，避免 7-8 个城市快速切换时被后台刷新占满。
- 切城市 pending 期间清空旧城市 analysis surface，避免旧分析短暂回刷。
- pending 期间多模型图片不沿用旧城市 `imageUrl`。
- 公开响应不再输出原始 `diagnosticMessage`，只保留用户可读文案和 `diagnosticCode`。

## v0.1.1 - 多模型城市切换稳定性

发布时间：2026-05-07

### 修复

- 后端 multimodel cold refresh 不再用 refresh-in-progress 失败前台 distribution/insight 请求。
- Cloudflare dashboard edge cache 要求 fresh sync/hourly/report 和 ready/fresh multimodel 状态，避免缓存 revalidating 中间态。
- 前端城市切换在 dashboard 可用后先提交路由，analysis/image/home/Kelly 后续 hydrate。
- 前端 analysis 保持当前城市稳定快照，拒绝跨城市 fallback，并在 secondary distribution 对齐后复查 epoch/route/timestamp/temperature。

### 评审修复

- 修复旧城市 analysis snapshot 混入新城市。
- 修复 secondary distribution late-write 风险。
- 修复 dashboard 缓存 hourly/report revalidating 状态。
- 修复 7 城市后台 load 压住前台 multimodel 请求的问题。

## 2026-04 - Kelly 和生产稳定性基础

### 新增

- Kelly 桥接、流式分析、市场参考和生产环境热修复路径。
- Cloudflare Worker 路由、meteoblue 多模型分布读取和小时级天气缓存策略。

### 改进

- 高温天气首页、分析页、移动端布局和中文展示文案持续收敛。

## 参考

- [Keep a Changelog](https://keepachangelog.com/)
- [GitHub Docs: About READMEs](https://docs.github.com/articles/about-readmes/)
