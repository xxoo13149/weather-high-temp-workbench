# PolyWeather 对标吸收结论：结构化信号 / Kelly / 市场参考方向

## 结论先行

- `PolyWeather` 在这条线最值得我们吸收的，不是它的概率层，而是它把“日内判断”拆成了更稳定的工作流：`主判断 -> 把握度 -> 基准/偏高/偏低路径 -> 下一观察点 -> 证据 -> 失效条件 -> 确认条件 -> 市场上下文`。
- 我们项目其实已经有这套骨架，而且方向是对的，只是现在还停留在“字段有了、解释还不够统一、市场上下文不够扎实、城市锚点表达还偏轻”的阶段。
- 因为用户边界已经锁定为“我们项目为主、PolyWeather 为辅；不做概率产品路线”，所以建议只吸收它的`解释层、风险提示层、证据组织方式、结算锚点表达、市场上下文表达`，明确不吸收它的`概率桶、校准概率、edge%/错价扫描主叙事`。

## 我们当前已经有的基础

### 1. 结构化日内判断骨架已经存在

- 后端已经在首页增强块里生成：
  - `headline`
  - `confidence`
  - `baseCase`
  - `upsideCase`
  - `downsideCase`
  - `nextObservationAt`
  - `evidence`
  - `invalidationRules`
  - `confirmationRules`
- 对应实现：`D:\weather\src\operational-metadata.ts`

### 2. 首页已经在展示“今天怎么看 + Kelly 机会”

- 首页 `WeatherOverview` 已有：
  - “今天怎么看”快捷面板
  - `intradaySignals` 详情块
  - `marketReference` 快速入口
- 对应实现：`D:\weather\zip\src\components\WeatherOverview.tsx`

### 3. Kelly 决策台已经是独立工作面

- 现在的 Kelly 页面已经具备：
  - 地点 / 日期 / bankroll / risk mode / min edge / actual temperature
  - 机会面板
  - 市场列表
  - 证据检查器
- 对应实现：
  - `D:\weather\zip\src\components\kelly\KellyWorkbench.tsx`
  - `D:\weather\zip\src\lib\kelly\types.ts`
  - `D:\weather\src\server\kelly-routes.ts`

## PolyWeather 在这条线比我们更成熟的地方

### 1. 它把“日内判断”做成了稳定的专业判断流程

- `README.md` 和 `README_ZH.md` 明确把日内分析定义为：
  - headline
  - confidence
  - base/upside/downside
  - next observation point
  - evidence chain
  - failure modes
  - confirmation rules
- `docs/API_ZH.md` 里也把 `intraday_meteorology` 单独列成结构化字段。

对我们有价值的点：

- 不是多了多少字段，而是它把这些字段当成“主判断流程”来组织，而不是零散补充说明。

### 2. 它把 TAF 放在了正确的位置：机场扰动确认层

- `docs/TAF_SIGNAL_ZH.md` 明确写了：
  - `TAF` 不是主温度模型
  - 不是结算源
  - 也不替代 `METAR`
  - 它只是用来判断机场侧的压温/扰动风险，以及在峰值窗口附近给时间提示

对我们有价值的点：

- 这和我们既定方向完全一致，适合直接吸收为“风险确认层”，而不是把它做成又一个复杂模型。

### 3. 它的“市场上下文”比我们更完整

- `docs/API_ZH.md` 里 `detail` 接口把：
  - `market_scan.available`
  - `primary_market.tradable`
  - `anchor_model / anchor_high / anchor_settlement`
  - `target_date`
  - `market detail`
  这些上下文放在同一个 detail 里组织。

对我们有价值的点：

- 不是照搬 `market_scan`，而是学习它“先讲这个市场对应哪一天、哪座城市、按哪个锚点结算、当前是否可交易、当前看的是哪一档”的上下文组织能力。

### 4. 它对“结算锚点”和“官方增强层”的口径更清楚

- `README.md`、`docs/API_ZH.md` 明确强调：
  - 多数机场市场以 `METAR / 机场主站` 为结算锚点
  - `MGM / NMC / JMA / KMA / HKO / CWA` 属于增强层
  - 增强层不默认替代结算锚点

对我们有价值的点：

- 这非常适合我们，因为我们已经有 `LocationSourceContract` 和 `settlementReference`，只是前端表达还不够稳定、不够“用户能看懂”。

## 可直接吸收的部分

### A. 把“今天怎么看”升级成真正的判断卡，而不是说明卡

建议吸收：

- 固定结构只保留 6 项：
  - 当前判断
  - 把握度
  - 偏高情形
  - 偏低情形
  - 下一次重点观察
  - 何时需要改判

为什么适合我们：

- 我们后端字段已经有了，不需要重做数据层。
- 只要重写前端文案组织和权重，就能明显提升易读性。

不需要搬的：

- `signal_contributions` 那种太细的因子分摊解释，不适合放给普通用户做首页主叙事。

### B. 把“证据链”改成“判断依据”

建议吸收：

- 文案统一改成用户能懂的 3 类依据：
  - 小时轨道正在怎么走
  - 实况站点有没有跟上
  - 多模型有没有明显分歧

为什么适合我们：

- 现在我们首页虽然已有 `evidence`，但表述仍容易滑向“系统说明文”。
- 应该把“证据链”改成“你这次判断主要参考了什么”。

### C. 补齐“结算锚点表达”

建议吸收：

- 在 Kelly 页和首页市场参考里固定展示：
  - 这座城市按哪个站点核对
  - 这个站点是机场实况还是官方站点
  - 官方增强层有没有接入

为什么适合我们：

- 我们已经在 `D:\weather\src\operational-metadata.ts` 里维护了 `settlementReference`、`officialEnhancements`、`kellyMarketMapping`。
- 现在缺的不是后端数据，而是把这些信息变成用户能看懂的“交易背景说明”。

### D. 给 Kelly 页补“市场上下文条”

建议吸收：

- 在 Kelly 页面顶部增加一条轻量上下文栏，只讲：
  - 当前城市
  - 当前目标日
  - 当前结算参考站
  - 当前盘口状态
  - 数据更新时间 / 盘口更新时间

为什么适合我们：

- 能让用户更快确认“我现在看的到底是哪一天、哪座城市、按什么结算”。
- 这比继续堆参数、堆解释段落更有效。

### E. 引入“风险确认层”，但只做轻量提示

建议吸收：

- 后续把 `TAF` 和官方增强源接进来后，不做新面板堆砌，只增加两类短句：
  - 机场侧暂稳 / 有扰动风险
  - 峰值窗口前后需要重点复看

为什么适合我们：

- 这能补强判断可靠性，又不会把首页和 Kelly 页面变成专业气象系统。

## 需要降级后再吸收的部分

### A. PolyWeather 的“市场 detail + intraday detail 同步锁刷新”

可吸收思路：

- 刷新时不要让用户短暂看到旧市场配新判断，或旧判断配新市场。

降级方式：

- 我们不需要照搬它完整的 detail depth 机制。
- 只需要在 Kelly 页和首页相关卡片里明确区分：
  - 已同步
  - 正在刷新
  - 保持上一轮结果

### B. 官方增强层的多国家接入模式

可吸收思路：

- 按国家/地区统一接入官方源，而不是单城市零散补。

降级方式：

- 我们先只补高价值城市。
- 不做 PolyWeather 那种完整大而全国家矩阵展示。

### C. 城市结算锚点合同化表达

可吸收思路：

- 把“城市 - 锚点 - 增强源 - 状态”变成统一合同。

降级方式：

- 后台和 `/system status` 保留完整结构。
- 前端用户只看简化版：
  - 结算参考
  - 已接入数据
  - 当前可靠度

## 明确不建议采纳的部分

### 1. 概率主叙事

不建议采纳：

- `probabilities`
- `calibrated_mu / sigma`
- `shadow_distribution`
- `EMOS / LGBM` 概率面板

原因：

- 用户边界已经明确不要概率层。
- 这些内容会迅速把产品带回“看不懂”的方向。

### 2. 错价扫描 / edge% 作为主叙事

不建议采纳：

- `market_scan.edge_percent`
- “模型概率 vs 市场概率”的首页化表达
- 以错价扫描做核心承诺

原因：

- 这会把产品重心从“帮助用户判断天气与结算路径”变成“喊单型产品”。
- 也不符合你当前要求的“市场层只做定性参考”。

### 3. 过重的专业信号层

不建议直接给用户：

- `vertical_profile_signal`
- 复杂 upper-air 因子分解
- 太长的 `signal_contributions`

原因：

- 这些更适合作为内部研究或专业模式，不适合默认用户界面。

### 4. 付费墙 / 积分 / Bot / 商业壳层

不建议作为当前主线吸收：

- 订阅
- 积分
- 链上支付
- `/ops`
- Telegram Bot

原因：

- 这些不是当前产品体验瓶颈。
- 先把核心判断台、城市数据、Kelly 稳定性做好，收益更高。

## 对我们项目的模块化落地建议

### 模块 1：判断卡重写

目标：

- 把首页“今天怎么看”重写成真正的判断卡。

只做这些：

- 当前判断
- 把握度
- 偏高 / 偏低路径
- 下一次重点观察
- 改判条件

### 模块 2：市场参考收口

目标：

- 把现在偏散的“市场参考”收成一条简洁的上下文说明。

只做这些：

- 当前目标日
- 当前参考站点
- 是否已接入 Kelly
- 去 Kelly 看机会

### 模块 3：Kelly 顶部上下文条

目标：

- 让用户一进 Kelly 就知道自己在看什么。

只做这些：

- 城市
- 日期
- 结算参考
- 盘口状态
- 更新时间

### 模块 4：风险提示层

目标：

- 后续接入 `TAF` / 官方增强后，只给出短句风险提示。

只做这些：

- 机场侧暂稳
- 峰值窗口前后有扰动风险
- 建议下一次观察时间

## 优先级建议

### P0

- 重写首页判断卡文案和信息顺序
- 把结算锚点表达搬进首页与 Kelly
- 给 Kelly 补顶部上下文条

### P1

- 接入 `TAF` 轻量风险提示
- 把官方增强源状态接进“判断依据”与“参考数据”

### P2

- 做更完整的城市锚点合同展示
- 只在高级模式或研究页保留更深证据层

## 来源

### 外部来源（PolyWeather）

- [PolyWeather README](https://github.com/yangyuan-zhen/PolyWeather/blob/main/README.md)
- [PolyWeather 中文说明 README_ZH](https://github.com/yangyuan-zhen/PolyWeather/blob/main/README_ZH.md)
- [PolyWeather API 文档](https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/API_ZH.md)
- [PolyWeather TAF 信号说明](https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/TAF_SIGNAL_ZH.md)

### 本地实现依据（我们项目）

- `D:\weather\src\operational-metadata.ts`
- `D:\weather\src\server\kelly-routes.ts`
- `D:\weather\zip\src\components\WeatherOverview.tsx`
- `D:\weather\zip\src\components\kelly\KellyWorkbench.tsx`
- `D:\weather\zip\src\lib\kelly\types.ts`
