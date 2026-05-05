# 全球机场高温天气决策台

一个面向机场高温、小时级天气与市场信号的综合决策工作台。项目后端负责聚合 meteoblue、航空天气报文与 Kelly 分析服务，前端提供桌面端高信息密度工作流和移动端触屏友好的快速判断体验。

当前生产部署使用 Cloudflare Workers + 静态资源托管，主域名配置在 `wrangler.toml` 中。仓库不提交任何本地密钥，部署凭据请放在本机环境或 `.local/` 目录中。

## 当前功能

- 全球机场天气 Alpha 首页：按城市/机场查看当前温度、高温峰值、24 小时轨道、关键小时与天气摘要。
- 地点工作流：支持地点切换、收藏持久化、最近地点、移动端地点抽屉，以及切换时的旧数据 race guard。
- meteoblue week 数据：解析小时级预报、中文天气报告和 week meteogram 表格数据。
- meteoblue multimodel：转发官方 multimodel 原图，并从公开 Highcharts payload 中提取多模型温度分布与模型级分析。
- 航空天气报文：接入 AviationWeather 的 METAR / TAF 数据，首页提供机场报文摘要。
- METAR Reader 入口：首页会根据四字 ICAO 机场码生成一键外链，例如 `https://www.metarreader.com/ZSPD`。
- 数据源可用性展示：用户侧优先展示“已读取/可用”的体验状态，非阻断的刷新、缓存回退和源站提示不再打扰主流程。
- 多模型 Insight：支持城市级多模型刷新、超时保护、缓存兜底和可读分析文本。
- Kelly 工作台：集成 Kelly 概率、市场参考、机会面板、证据检查器与流式更新路径。
- 移动端适配：重构 Header、地点选择器、首页信息层级、分析页触屏列表/详情工作流，并保留桌面端完整排序和 sticky 资料栏。

## 最近更新

- 2026-05：新增 METAR Reader 外链能力，首页和详情层都可以快速跳转到对应机场报文站点。
- 2026-05：完成移动端核心回归，覆盖收藏、刷新四态、切地点准确性、中文编码、移动首屏、弹层和桌面主工作流。
- 2026-05：收敛用户侧噪音提示，隐藏不影响体验的源站超时、嵌入 meteogram 增强失败、缓存回退等非阻断运行信息。
- 2026-05：修复部分中文乱码和 `null` 被误显示为 `0` 的展示问题。
- 2026-04：强化 meteoblue 多模型分布读取、小时数据缓存、Cloudflare Worker 路由和 Kelly 预热策略。
- 2026-04：加入 Kelly 桥接、流式分析、市场参考和生产环境稳定性热修复。

## 技术栈

- 运行时：Node.js 22+、TypeScript、ESM。
- 后端服务：Fastify 5、`@fastify/websocket`、Cheerio、WebSocket。
- Cloudflare：Workers、Assets、`wrangler`、自定义域名路由。
- 前端：React 19、Vite 6、Tailwind CSS 4、Radix UI、cmdk、lucide-react、motion。
- 测试与验证：Vitest、TypeScript 编译检查、Playwright 回归脚本、编码检查脚本。
- 数据处理：meteoblue 页面解析、Highcharts payload 解析、航空报文解析、Kelly origin 代理与预热。

## 数据源与口径

- meteoblue week 页面用于小时级天气、天气报告和 week meteogram 补充数据。
- meteoblue multimodel 图片接口只转发官方原图，不在本项目中重绘官方图。
- 多模型分布来自 multimodel 页面公开的 `format=highcharts` 数据，不依赖 OCR。
- METAR / TAF 默认来自 AviationWeather；`.env.example` 中保留 AVWX、CheckWX 等可选配置位。
- METAR Reader 是外部详情站点，本项目只生成对应 ICAO 链接，不抓取或缓存其页面内容。
- 当源站短时不完整或慢响应时，后端允许使用最近一次成功缓存；前端默认不把非阻断诊断信息暴露给普通用户。

## API 概览

- `GET /`：前端入口，由 `zip/dist` 构建产物提供。
- `GET /healthz`：健康检查和构建信息。
- `GET /api/weather/dashboard?locationId=...&mode=1h|3h&limit=...`：首页聚合数据。
- `GET /api/weather/report?locationId=...`：中文天气报告。
- `GET /api/weather/hourly?locationId=...&mode=1h|3h&limit=...`：小时级天气。
- `GET /api/weather/multimodel/image?locationId=...&allowStale=true|false`：官方 multimodel 图片转发。
- `GET /api/weather/multimodel/status?locationId=...`：multimodel 刷新状态。
- `GET /api/weather/multimodel/distribution?locationId=...&timestamp=<ISO>&bucketSize=1`：模型级温度分布。
- `GET /api/weather/aviation?locationId=...`：航空天气报文摘要。
- `GET /api/kelly/*`：Kelly 工作台代理、预热、流式与市场参考相关接口。

具体参数会随页面状态和地点配置变化，前端 API client 位于 `zip/src/api.ts`。

## 本地开发

```bash
npm install
npm --prefix zip install
copy .env.example .env
npm run dev
```

前端单独开发时使用 Vite，并通过代理访问后端 API：

```bash
npm run dev:web
```

Cloudflare Worker 本地调试：

```bash
npm run build
npm run dev:cloudflare
```

## 构建、测试与部署

```bash
npm run build
npm test
npm run check
```

常用定向回归：

```bash
npx vitest run tests/frontend-api.test.ts tests/display-text.test.ts tests/source-read-state.test.ts tests/metar-reader-link.test.ts
npm run test:pw
```

部署到 Cloudflare：

```bash
npm run build
npm run deploy:cloudflare
```

部署前请确认 Cloudflare 凭据已经在本机 shell 或本地私有文件中配置，避免把任何密钥写入仓库。

## 目录结构

- `src/`：后端 Fastify 服务、Cloudflare Worker 入口、领域模型、数据源适配器与 Kelly 代理逻辑。
- `zip/src/`：React 前端源码，包含首页、分析页、Kelly 工作台、移动端布局和展示文案。
- `tests/`：Vitest 单元测试、接口契约测试和关键展示逻辑回归。
- `tools/`：编码检查、生产审计、Playwright 地点回归和 Kelly 批量检查脚本。
- `docs/plan/`：阶段性实施计划和任务拆分文档。
- `.local/`：本地私有配置目录，已被 `.gitignore` 排除，不应提交。

## 维护注意事项

- 不要把 `.local/`、`.wrangler/`、运行日志、截图、Playwright 产物、测试报告或热修复 zip 提交到仓库。
- 用户可见文案统一走 `zip/src/display-text.ts` 等展示层 helper，避免把底层错误直接暴露到 UI。
- 数据源状态卡片应表达“用户现在是否能读到数据”，不要把内部刷新中、缓存回退等诊断状态当成用户主状态。
- 移动端改造不能破坏桌面端主工作流：桌面分析页仍应保持左侧完整排序和右侧 sticky 资料栏。
- `null`、缺测和真实 `0` 必须区分展示，避免把缺数据误读为 0 度、0 风速或 0 概率。
