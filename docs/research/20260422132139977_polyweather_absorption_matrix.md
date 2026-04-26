# PolyWeather 对标吸收能力矩阵（去概率层）

## 边界

- 本轮只吸收 `数据源、城市覆盖、结构化信号、页面工作流、稳定性`。
- 明确不做 `概率桶 / 概率校准 / edge% / 错价扫描主叙事`。
- 市场层保持 `qualitative-only`，Kelly 继续作为执行实验台，不变成概率产品。
- 采用 clean-room 吸收，不复制对方 AGPL 实现。

## 能力矩阵

| 维度 | 能力点 | 对标吸收结论 | 当前落点 | 本期动作 |
| --- | --- | --- | --- | --- |
| 产品结构 | 城市为主入口、快速切城 | 直接适合搬 | 已有地点 rail / 收藏 / 分组 | 继续优化手机端单列工作台 |
| 产品结构 | 分析页从“模型展示”升级为“判断台” | 直接适合搬 | 已有模型页和图片页 | 后续把判断、证据、风险、下一观察点前置 |
| 产品结构 | Kelly 作为单独工作台 | 直接适合搬 | 已有 Kelly 页 | 继续吃更强的数据层与结构信号，不引概率层 |
| 数据与城市 | 城市-站点-来源合同化 | 直接适合搬 | 已落地 `LocationSourceContract` | 本期已上线合同模型与目录注入 |
| 数据与城市 | Meteoblue 之外增加公开多模型层 | 直接适合搬 | 现仅有 Meteoblue 基线 | 下一阶段接 Open-Meteo multi-model |
| 数据与城市 | 机场实况作为结算锚点 | 直接适合搬 | 已有 METAR 映射能力 | 按城市补齐 station mapping 与 fallback |
| 数据与城市 | 官方增强层按区域逐城接入 | 降级后再搬 | 目前只做 planned/candidate 合同标记 | 先接 NMC / JMA / KMA / HKO / MGM |
| 数据与城市 | TAF 作为机场扰动确认层 | 降级后再搬 | 当前未接生产数据 | 只做风险确认，不做主温度模型 |
| 工程与稳定性 | 系统状态页与 metrics | 直接适合搬 | 本期已新增 `/api/system/status`、`/metrics` | 下一阶段接 freshness / fallback 告警 |
| 工程与稳定性 | 服务运行态显式暴露 | 直接适合搬 | 本期已暴露 runtime cache / kelly proxy | 后续补数据源 freshness 与城市补齐状态 |
| 工程与稳定性 | 高价值城市预热 | 直接适合搬 | 目前主要靠请求触发 | 后续加首页摘要、分析页、Kelly 分层预热 |
| 市场辅助 | 市场状态与活跃度背景 | 直接适合搬 | 现有 Kelly 已有市场与证据 | 保留定性参考，不新增概率对比 |
| 市场辅助 | 错价扫描 / 概率比较 | 只参考不实施 | 不符合当前边界 | 明确不进入路线图 |
| 商业化壳层 | 用户体系 / 付费 / Bot / 运营后台 | 只参考不实施 | 当前不是主线 | 本阶段不做 |

## 城市优先级

### P0：已纳入 tier-1，优先做“来源补齐 + 官方增强 + 预热”

- `shanghai_pvg`, `beijing_pek`, `wuhan_wuh`, `hongkong_hkg`
- `tokyo_hnd`, `busan_pus`
- `toronto_yyz`, `miami_mia`, `losangeles_lax`
- `ankara_esb`, `amsterdam_ams`, `london_lcy`

### P1：tier-2，高价值扩容批

- 中国补强：`chengdu_ctu`, `chongqing_ckg`, `shenzhen_szx`
- 欧洲补强：`istanbul_ist`, `munich_muc`, `warsaw_waw`, `madrid_mad`, `helsinki_hel`
- 北美补强：`newyork_lga`, `chicago_ord`, `atlanta_atl`, `dallas_dal`, `austin_aus`, `houston_hou`
- 美洲补强：`mexicocity_mex`, `buenosaires_eze`, `wellington_wlg`

### P2：tier-3，广覆盖与机会池

- 亚洲：`jakarta_hlp`, `jeddah_jed`, `kualalumpur_kul`, `lucknow_lko`, `seoul_icn`, `singapore_sin`, `taipei_tpe`, `telaviv_tlv`
- 欧洲：`milan_mxp`, `moscow_vko`, `paris_cdg`
- 非洲：`capetown_cpt`, `lagos_los`
- 美洲与太平洋：`denver_bfk`, `panamacity_pac`, `sanfrancisco_sfo`, `saopaulo_gru`, `seattle_sea`

## 分阶段落地

### Phase 1：已落地基础层

- 城市/来源合同模型
- dashboard 向后兼容扩展字段：`sourceMetadata`、`intradaySignals`、`marketReference`
- `/api/system/status`
- `/metrics`

### Phase 2：下一批最值得做

1. 接 `Open-Meteo multi-model`，形成公开多模型层
2. 为 P0 城市补齐 METAR station mapping 与官方增强层
3. 把分析页重排为“判断 -> 证据 -> 风险 -> 下一观察点 -> 模型分歧”
4. 做高价值城市的 dashboard / analysis / Kelly 预热

### Phase 3：稳定性闭环

1. 数据源 freshness 指标
2. fallback 连续触发观测
3. 城市补齐状态可视化
4. 高价值城市陈旧数据告警

## 本文对应实现原则

- 所有新增接口与字段都必须向后兼容。
- 旧城市不能因新来源接入而退化。
- 任何新增判断层都不能把概率和 edge% 带回主叙事。
