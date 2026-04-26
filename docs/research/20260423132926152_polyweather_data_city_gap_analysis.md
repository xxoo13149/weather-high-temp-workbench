# PolyWeather 对标结论：数据源与城市覆盖负责人收敛版

更新时间：2026-04-23

## 结论

- 以 `src/config.ts` 为准，我们当前正式城市库已经是 **52 个城市，且 52 个全部启用**，城市数量本身已经追平 PolyWeather README 在 2026-04-19 声明的 `52 monitored cities`。
- 真正差距 **不在城市数量**，而在 **来源接通完整度**：
  - 我们当前只有 **10/52** 城市真正接通了 `METAR` 主观察锚点。
  - `Open-Meteo multi-model` 在我们这里还是 **52/52 仅合同声明，0 真接通**。
  - `TAF` 在我们这里还是 **角色与状态字段已建好，但 0 真接通**。
  - `官方增强层` 在我们这里已有 **16 个城市的骨架**，但 **0 生产接通**。
- 所以接下来的主线不该是“继续盲目加城市”，而是：
  1. 先把现有 52 城市里最关键的一批来源补齐；
  2. 再按区域把官方增强层接实；
  3. 最后再考虑新增城市。

## 我们当前 52 城市现状

本地代码证据：

- 城市注册表：`D:\weather\src\config.ts`
- 来源合同与 rollout tier：`D:\weather\src\operational-metadata.ts`
- METAR 站点映射：`D:\weather\src\providers\metar\service.ts`
- 合同说明：`D:\weather\docs\spec\20260422132139978_city_source_contracts.md`

关键事实：

- 城市总数：52
- 启用城市：52
- `tier-1 / tier-2 / tier-3`：`12 / 19 / 21`
- `METAR production`：10
- `METAR 非 production`：42
- `Open-Meteo multi-model planned`：52
- `TAF planned`：4
- `TAF candidate`：48
- `官方增强层已建骨架城市`：16
- `官方增强层 production`：0

### 已接通 METAR 的 10 个城市

- `shanghai_pvg`
- `wuhan_wuh`
- `guangzhou_can`
- `istanbul_ist`
- `karachi_khi`
- `manila_mnl`
- `masroor_opmr`
- `munich_muc`
- `toronto_yyz`
- `miami_mia`

### 已有官方增强层骨架但未接通的城市

`planned`

- `shanghai_pvg`
- `wuhan_wuh`
- `beijing_pek`
- `busan_pus`
- `hongkong_hkg`
- `laufau_shan_lfs`
- `tokyo_hnd`
- `ankara_esb`

`candidate`

- `guangzhou_can`
- `chengdu_ctu`
- `chongqing_ckg`
- `karachi_khi`
- `masroor_opmr`
- `manila_mnl`
- `shenzhen_szx`
- `istanbul_ist`

## 与 PolyWeather 52 城市清单的差异

PolyWeather README 在 2026-04-19 声明的 52 城市，与我们当前注册表对比后，结论如下：

- **缺失城市：0**
- **数量差异：0**
- **是否少城市：不是**

### 唯一需要注意的是命名/锚点口径差异

- PolyWeather 用 `Aurora` 对外表述；我们当前内部是 `denver_bfk`，对应 `Buckley Air Force Base`，本质上承接的是丹佛-奥罗拉都会区那一档市场。
- PolyWeather 对外更偏“城市名”；我们当前更偏“机场/站点锚点 ID”。内部这样是好的，但对外展示要更像城市产品，不要让用户感觉我们在展示机场代码表。

### 真正的差异是“同样 52 城市，来源完整度不一样”

PolyWeather 公开声明已上线的增强层包括：

- `METAR` 机场锚点
- `TAF` 机场扰动确认层
- `Open-Meteo`
- `MGM`（土耳其）
- `CMA/NMC`（中国内地）
- `JMA AMeDAS`（日本）
- `KMA`（韩国）
- `HKO`（香港）
- `CWA`（台湾）

而我们当前的差异是：

- `METAR`：只落了 10 城，离全局还差很远。
- `TAF`：合同和角色已经定义，但还没有真正接到产品里。
- `Open-Meteo`：只有合同字段，没有 provider/collector。
- `官方增强层`：只做了骨架，没有城市级生产接通。
- `台湾 CWA`：PolyWeather 已公开声明覆盖，我们当前 **连骨架都还没有**。
- `韩国 KMA`：我们当前只给 `busan_pus` 预埋了骨架，`seoul_icn` 还没补。

## 最该优先补的城市 / 来源

### P0：最值得立刻做

| 优先级 | 城市 / 来源包 | 当前状态 | 为什么最该先做 |
| --- | --- | --- | --- |
| P0 | `guangzhou_can` + `NMC/CMA` + `TAF` | 已有 METAR，官方层是 candidate | 广州已经有交易与业务需求，且基础站点已通，是从 candidate 升到 production 成本最低的一城 |
| P0 | `hongkong_hkg` + `laufau_shan_lfs` + `HKO` | 官方层 planned，特殊站点逻辑已建 | 香港是最典型“机场锚点 + 官方站网增强”城市，做成后对首页、分析页、Kelly 都有明显帮助 |
| P0 | `tokyo_hnd` + `JMA AMeDAS` | 官方层 planned，但缺主观察补齐 | PolyWeather 已把东京官方增强做到公开亮点，我们这里已经埋了骨架，最适合直接接通 |
| P0 | `beijing_pek` + `NMC/CMA` + `METAR` | tier-1，但主观察还是 candidate | 北京是 tier-1 核心城市，当前短板不是模型，而是观察锚点和增强层没落地 |
| P0 | `busan_pus` + `KMA` | 官方层 planned，但主观察还是 candidate | 韩国能力我们现在只开了半扇门，先把 Busan 做通，再扩 Seoul |
| P0 | `taipei_tpe` + `CWA` | 当前无官方层骨架 | 这是我们相对 PolyWeather 最明确的公开差距之一，应该尽快补合同和接线 |

### P1：第二批高价值扩展

| 优先级 | 城市 / 来源包 | 当前状态 | 建议动作 |
| --- | --- | --- | --- |
| P1 | `shenzhen_szx` + `NMC/CMA` | 官方层 candidate | 深圳与广州、香港构成华南组团，做成后收益成组出现 |
| P1 | `chengdu_ctu` + `chongqing_ckg` + `NMC/CMA` | 官方层 candidate | 西南双城适合按一个来源包一起做 |
| P1 | `istanbul_ist` + `ankara_esb` + `MGM` | Istanbul 已有 METAR，官方层 candidate/planned | 土耳其来源包是很适合整组推进的官方增强层 |
| P1 | `manila_mnl` + `karachi_khi` + `masroor_opmr` | 已有 METAR，官方层 candidate | 这是我们自己已经先埋好的骨架，甚至比 PolyWeather README 公开披露更超前，值得做成我们自己的优势 |
| P1 | `seoul_icn` + `KMA` | 当前没有官方层骨架 | 既然 PolyWeather 公开说韩国层已覆盖，我们不应该只停在 Busan |
| P1 | `losangeles_lax` / `london_lcy` / `amsterdam_ams` | tier-1 但无 METAR | 这些是核心城市，但现在连机场观察锚点都没补齐，至少先补 METAR + TAF |

### P2：第三批再做

| 优先级 | 城市 / 来源包 | 当前状态 | 建议 |
| --- | --- | --- | --- |
| P2 | 北美剩余机场城市 `newyork_lga` / `chicago_ord` / `atlanta_atl` / `houston_hou` / `dallas_dal` / `austin_aus` / `sanfrancisco_sfo` / `seattle_sea` | 大多只有 baseline + multimodel | 先补 METAR，再决定是否需要更深增强 |
| P2 | 低优先区域城市 | 多数无官方增强层计划 | 保持 `Meteoblue + Multimodel` 基线即可，先别过度铺开 |
| P2 | Open-Meteo 全量 52 城铺开 | 目前 0 真接通 | 建议先从 P0/P1 热点城市做，再全量 |

## 哪些能力我们已经有骨架，但还没真正接通

### 直接可用的骨架

- `LocationSourceContract` 版本化合同
- `settlementReference / currentSources / targetUpgrades` 分层模型
- rollout tier（`tier-1 / tier-2 / tier-3`）
- `/api/system/status` 与来源覆盖统计能力

### 已有骨架，但仍未接通

1. `Open-Meteo multi-model`
   - 现状：只存在于合同字段与类型定义里
   - 结论：**最典型的“有壳没线”**

2. `TAF`
   - 现状：合同字段已定义，角色也已经限定为 `airport-disruption-confirmation`
   - 结论：**产品定位是对的，但采集、解析、展示还没接上**

3. `官方增强层`
   - 现状：16 个城市已有 `planned/candidate` 骨架
   - 结论：**合同设计已经领先，执行层还没落地**

4. `METAR 扩展覆盖`
   - 现状：客户端已写好，但只有 10 个城市有 ICAO 映射
   - 结论：**这是现在最应该先补的基础设施**

5. `台湾 / 更完整韩国增强层`
   - 现状：PolyWeather 已公开声明 `CWA / KMA` 覆盖；我们这里还不完整
   - 结论：**这是最明确、最值得优先补的公开差距**

### 其实我们已经比 PolyWeather 公开描述更进一步的地方

- 我们已经在合同层预埋了 `PAGASA`（马尼拉）和 `PMD`（卡拉奇 / Masroor）这类增强层候选。
- 这说明我们不是没有方向，而是 **方向已经写进系统，执行还差最后一公里**。

## 能力分类

### 直接适合搬

- `METAR` 作为机场结算锚点
- `TAF` 作为机场扰动确认层
- `Open-Meteo` 作为公开多模型补充层
- `官方近邻站网` 作为增强层，而不是替代结算锚点
- `按城市/来源做 freshness 与覆盖状态`

### 降级后再搬

- `TAF` 时间轴标注
  - 可以搬，但只做“今天怎么看”的风险提示，不要带概率化叙事
- `台北 / 深圳` 这类历史页 / 对账页
  - 可以做成内部运营或证据抽屉，不要做成首页主叙事
- `高价值城市预热`
  - 先只做 P0/P1，不要一上来全量 52 城

### 只参考不实施

- 概率桶
- `EMOS / LGBM` 概率主引擎
- `edge% / 错价扫描` 主叙事
- 任何会让普通用户看不懂的概率化说明层

## 最终建议

### 建议一

先停止“继续加城市”的冲动，接下来 1-2 轮迭代只做 **现有 52 城市的来源补齐**。

### 建议二

数据源主线按下面顺序推进：

1. `METAR 补齐`
2. `中国内地 NMC/CMA`
3. `HKO`
4. `JMA`
5. `KMA`
6. `CWA`
7. `MGM`
8. `Open-Meteo`
9. `TAF`

### 建议三

执行策略不要按“页面”拆，要按“城市来源包”拆。也就是：

- 广州包
- 香港包
- 东京包
- 北京包
- 韩国包
- 台湾包

每做完一个包，就同时改善：

- 首页摘要可信度
- 分析页证据层
- Kelly 的实际可用度

## 来源

- PolyWeather README：
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/README.md
- PolyWeather TAF 文档：
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/TAF_SIGNAL_ZH.md
- PolyWeather 监控文档：
  - https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/MONITORING_ZH.md
- Open-Meteo Ensemble API：
  - https://open-meteo.com/en/docs/ensemble-api
- AviationWeather Data API：
  - https://aviationweather.gov/data/api/
