# PolyWeather 四人专家团队综合对标报告

截至 `2026-04-23`，本报告基于四个并行视角完成：

- 产品与体验
- 数据源与城市覆盖
- 工程与稳定性
- 决策辅助与 Kelly

本轮对标边界已经锁定：

- 我们项目仍然是主产品，`PolyWeather` 只是参考对象
- 不引入概率桶、校准概率、`edge%`、错价扫描主叙事
- 不把用户看不懂的专业术语直接搬进前台
- 继续采用 clean-room 吸收，不复制对方 `AGPL` 实现

## 一句话结论

`PolyWeather` 更强的是体系完整度，我们更强的是执行链路聚焦。

它已经把 `城市覆盖 -> 数据源分层 -> TAF / 官方增强 -> 预热 -> 监控告警 -> Web/Bot/ops` 串成完整闭环；我们已经把 `首页 -> 分析页 -> Kelly 页`、Worker 兜底、Kelly 源站服务化、健康与熔断这条核心链路做到了可上线水平，但还没有把城市来源、页面信息层级、后端预热和运行态治理补成系统。

所以接下来最值得做的，不是继续横向堆功能，而是补三个闭环：

1. `城市来源闭环`
2. `前台信息层级闭环`
3. `预热 + 巡检 + 运行态闭环`

## 能力矩阵

| 维度 | PolyWeather 更强的点 | 我们当前状态 | 建议 |
| --- | --- | --- | --- |
| 产品结构 | 有完整产品壳层、地图、城市详情、文档中心、ops、支付、Bot 等完整体系 | 三页主链路清晰，但壳层和体系化表达偏弱 | 保留三页主链路，不搬商业壳；补首页层级、分析页判断台化 |
| 城市覆盖 | README 公布 52 城市，且产品叙事围绕“全球城市覆盖 + 数据层”展开 | 当前本地城市库也已是 `52/52` 全启用，但来源完整度远弱于对方 | 停止盲目扩城市，改做“城市来源包”补齐 |
| 数据源分层 | Meteoblue / Open-Meteo / METAR / TAF / 官方站网 / 历史对账层次更完整 | 已有 `LocationSourceContract` 骨架，但生产接通少 | 优先把合同变成真实生产来源 |
| 工程副线 | docker-compose、prewarm worker、Prometheus、Alertmanager、Grafana、SQLite 运行态更成熟 | 已有 Worker fallback、NSSM 源站服务、watchdog、`/healthz`、`/metrics` | 下一步补后端预热、巡检告警、轻量持久化 |
| 决策辅助 | 把日内判断、TAF、结算来源、风险提示组织得更像完整分析系统 | 我们已经有正确骨架，但前台解释层还不够“用户听得懂” | 强化解释层与上下文条，不走概率路线 |
| Kelly / 执行 | 对方更偏市场分析产品，我们更偏执行工作台 | 我们的 Kelly 页主链路更聚焦、更适合做执行层 | 继续保留 Kelly 中心地位，但补顶部上下文与结算说明 |
| 可观测性 | 闭环更完整，有规则、巡检、告警链路 | 我们已有指标，但还缺“谁来盯”和历史持久化 | 先做轻量巡检和告警，再决定是否上全家桶 |
| 用户可理解性 | 文档体系完整，但产品前台也有大量专业层 | 我们已经出现“功能多于解释”的倾向 | 全站去术语、中文化、前后台信息分层 |

## 我们已经做得更好的地方

这些不是客气话，而是下一阶段应该继续放大的优势：

- `执行链路更聚焦`
  我们的主路径已经很明确：`首页 -> 分析页 -> Kelly 页`。尤其 Kelly 工作台不是“研究工具”，而是接近执行台。
- `公网可用性治理已经更贴当前现网`
  我们已经有 Worker 远端优先、本地 fallback、熔断、stream 握手修正、Windows 源站服务化、watchdog、自恢复。
- `LocationSourceContract` 已经正式化`
  我们不是散落地“想接什么就接什么”，而是已经把 `settlementReference / currentSources / targetUpgrades / rolloutTier` 定义进了生产结构。
- `Kelly 共享 Hub 和运行态健康输出更贴业务`
  我们已经把 `activeHubCount / openStreamCount / fallbackMode / lastOrderbookFailureAt` 这类直接影响用户体验的状态暴露出来了。

## 目前最真实的短板

### 1. 不是少城市，而是少“接通了的城市”

按当前本地代码：

- 城市总量已经是 `52/52`
- `METAR` 主观察锚点只接通了 `10/52`
- `Open-Meteo multi-model` 是 `52/52 都在合同里，但 0 真接通`
- `TAF` 角色已定义，但 `0 真接通`
- `官方增强层` 已为 `16` 个城市预埋骨架，但 `0 生产接通`

这意味着现在真正的工程问题，不是“还差几个城市”，而是“这 52 个城市里有多少能稳定支撑首页、分析页、Kelly 页”。

### 2. 页面信息增长速度快过了用户理解速度

当前首页、分析页、Kelly 页的基础能力已经很多，但出现了三个问题：

- 次要信息会抢核心判断的位置
- 专业字段进入前台后没有被翻译成用户语言
- 新增能力没有先通过“是否值得上主屏”这道门

所以用户会出现“功能变多了，但反而更看不懂”的感受。

### 3. 工程上还缺“核心服务外那一圈闭环”

我们已经能跑，但还没完全做到“长时间稳态运行 + 有问题能立刻知道 + 重启后还能复盘”。

当前最缺的三件事：

- 后端主动预热 worker
- 全链路巡检与告警
- 轻量运行态持久化

## 直接适合搬

这些建议可以明确进入我们的主线：

1. 首页改成稳定三层主线：`今天怎么看 -> 24 小时轨道 -> 去分析 / 去 Kelly`
2. 建立“城市准入机制”：没有结算锚点、观察锚点、最小来源合同的城市，不进入 Kelly 主入口
3. 把“今天怎么看”升级成真正的判断卡，只保留用户关心的六件事：
   当前判断、把握度、偏高情形、偏低情形、下一次重点观察、何时改判
4. 把“证据链”改写成“判断依据”，只讲：
   小时轨道、实况站点、多模型分歧
5. 给 Kelly 页增加顶部上下文条：
   城市、日期、结算参考站、盘口状态、更新时间
6. 按“城市来源包”推进，而不是按页面推进：
   广州包、香港包、东京包、北京包、韩国包、台湾包
7. 增加后端独立预热 worker：
   首页摘要、分析详情、Kelly snapshot 分开预热
8. 增加全链路巡检脚本：
   Worker `/healthz`、`GET /api/weather/kelly`、canary `stream` 握手、源站 `/healthz`
9. 扩展 `/api/system/status`：
   增加 `source freshness`、`prewarm heartbeat`、`fallback 连续触发`、热城市最近成功时间
10. 做一轮全站中文化和去术语：
   前台全部中文，运维词汇和专业词汇不直接暴露给普通用户

## 降级后再搬

这些能力值得学，但不该原样照搬：

1. `Open-Meteo multi-model`
   只做公开多模型补充层，不做概率层
2. `TAF`
   只做“机场扰动确认层”和风险提示，不做主温度模型
3. `官方增强层`
   先按地区分包接入：`NMC/CMA`、`JMA`、`KMA`、`HKO`、`CWA`、`MGM`
4. `SQLite 运行态存储`
   我们先只存 `prewarm heartbeat`、`smoke 历史`、`source freshness`、`fallback 摘要`
5. `Prometheus / Grafana / Alertmanager`
   先做轻量告警和趋势抓取，再决定是否上全家桶
6. `系统状态和来源状态`
   继续存在，但降级到运维 / 辅助区，不再抢首页主视觉

## 只参考不实施

这些目前不进入主线：

1. 概率桶
2. 校准概率
3. `edge%`
4. 错价扫描主叙事
5. `EMOS / LGBM` 概率解释面板
6. 复杂 upper-air 因子分解直接前台化
7. 付费墙、会员、积分、支付后台
8. Telegram Bot 推送体系
9. `/ops` 商业后台

## 分阶段路线图

### Phase 0：先做最影响体验的三件事

目标：让当前产品更清楚、更稳、更不会继续堆出用户看不懂的内容。

1. 首页信息层级重排
2. 城市准入机制
3. 全站文案去术语

### Phase 1：把来源合同变成真实能力

目标：让 52 城市不再只是“挂在目录里”。

优先做 `P0 城市来源包`：

- `guangzhou_can`
- `hongkong_hkg + laufau_shan_lfs`
- `tokyo_hnd`
- `beijing_pek`
- `busan_pus + seoul_icn`
- `taipei_tpe`

每个来源包至少补齐：

- 结算锚点
- 主观察锚点
- `TAF` 可用性
- 官方增强层
- Kelly 映射状态

### Phase 2：补工程副线闭环

目标：从“能跑”升级到“稳定可运维”。

1. 后端主动预热 worker
2. 全链路巡检与告警
3. 轻量运行态持久化

### Phase 3：强化解释层，不碰概率层

目标：让页面更像“判断台”和“执行台”。

1. 首页判断卡正式化
2. 分析页改成“判断 -> 证据 -> 风险 -> 下一观察点 -> 模型分歧”
3. Kelly 页增加上下文条和结算锚点说明
4. `TAF` 和官方增强层只进入风险提示，不进入主叙事

## 推荐的下一轮实施顺序

如果要从这份调研直接进入执行，我建议顺序固定为：

1. `首页重排 + 去术语 spec`
2. `城市准入规则 spec`
3. `P0 城市来源包 spec`
4. `后端预热 worker spec`
5. `全链路巡检 + 告警 spec`

这个顺序的好处是：

- 先解决“用户马上能感受到的问题”
- 再解决“52 城市里哪些是真可用的问题”
- 最后把稳定性补成闭环

## 证据与来源

### 外部一手来源

- [PolyWeather README](https://github.com/yangyuan-zhen/PolyWeather/blob/main/README.md)
- [PolyWeather 中文说明](https://github.com/yangyuan-zhen/PolyWeather/blob/main/README_ZH.md)
- [PolyWeather API 文档](https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/API_ZH.md)
- [PolyWeather 模型栈与 DEB](https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/MODEL_STACK_AND_DEB_ZH.md)
- [PolyWeather TAF 文档](https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/TAF_SIGNAL_ZH.md)
- [PolyWeather 监控文档](https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/MONITORING_ZH.md)
- [PolyWeather 运维后台文档](https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/OPS_ADMIN_ZH.md)
- [PolyWeather docker-compose](https://github.com/yangyuan-zhen/PolyWeather/blob/main/docker-compose.yml)
- [Open-Meteo Ensemble API](https://open-meteo.com/en/docs/ensemble-api)
- [AviationWeather Data API](https://aviationweather.gov/data/api/)

### 我们本地依据

- [src/config.ts](/D:/weather/src/config.ts)
- [src/operational-metadata.ts](/D:/weather/src/operational-metadata.ts)
- [src/cloudflare/worker.ts](/D:/weather/src/cloudflare/worker.ts)
- [src/providers/meteoblue/service.ts](/D:/weather/src/providers/meteoblue/service.ts)
- [src/app.ts](/D:/weather/src/app.ts)
- [zip/src/App.tsx](/D:/weather/zip/src/App.tsx)
- [zip/src/components/WeatherOverview.tsx](/D:/weather/zip/src/components/WeatherOverview.tsx)
- [zip/src/components/AnalysisWorkspace.tsx](/D:/weather/zip/src/components/AnalysisWorkspace.tsx)
- [zip/src/components/kelly/KellyWorkbench.tsx](/D:/weather/zip/src/components/kelly/KellyWorkbench.tsx)
- [zip/src/components/LocationRail.tsx](/D:/weather/zip/src/components/LocationRail.tsx)
- [zip/src/display-text.ts](/D:/weather/zip/src/display-text.ts)
- [docs/spec/20260422132139978_city_source_contracts.md](/D:/weather/docs/spec/20260422132139978_city_source_contracts.md)
- [docs/research/20260423132926152_polyweather_data_city_gap_analysis.md](/D:/weather/docs/research/20260423132926152_polyweather_data_city_gap_analysis.md)
- [docs/research/20260423133428876_polyweather_kelly_decision_absorption.md](/D:/weather/docs/research/20260423133428876_polyweather_kelly_decision_absorption.md)
- [docs/research/20260423162000000_polyweather_engineering_stability_gap.md](/D:/weather/docs/research/20260423162000000_polyweather_engineering_stability_gap.md)

## 最终判断

对我们最有价值的，不是“把 PolyWeather 搬过来”，而是把它拆成三类：

- 体系方法：要学
- 数据层和工程层：要分阶段吸收
- 概率叙事和商业壳：当前不学

接下来最稳妥、也最符合你要求的方向，是围绕我们自己的产品主线，把 `城市来源、解释层、稳定性` 三件事做成长期升级主轴。
