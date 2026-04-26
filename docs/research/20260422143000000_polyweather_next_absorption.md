# PolyWeather 下一阶段吸收顺序（去概率层）

## 目标边界

- 继续 clean-room 吸收 `PolyWeather` 的产品思路、数据合同和运维模式。
- 不引入概率层，不做概率桶、校准概率、EMOS、edge% 主叙事。
- 市场层继续只做定性参考，Kelly 保持执行台定位。

## 推荐顺序

### P0-1: 接入 TAF 确认层

- 目标：把 `TAF` 做成机场扰动确认层，不把它当主温度模型。
- 用途：
  - 标记 `FM / TEMPO / BECMG / PROB30 / PROB40`
  - 识别雷暴、降雨、低云、风向突变是否会压制峰值兑现
  - 给首页和分析页增加“下一观测点前的扰动提示”
- 我们现有落点：
  - `src/domain/weather.ts`
  - `src/providers/meteoblue/service.ts`
  - `src/app.ts`
  - `zip/src/components/WeatherOverview.tsx`
  - `zip/src/components/AnalysisWorkspace.tsx`

### P0-2: 把来源合同升级成真实官方源适配器

- 目标：把我们已经建好的 `source contract` 从元数据升级成真实运行态。
- 优先国家/区域：
  - 中国内地：`CMA / NMC`
  - 日本：`JMA`
  - 韩国：`KMA`
  - 香港：`HKO`
  - 土耳其：`MGM`
- 价值：
  - 让“城市来源合同”从展示信息变成真实增强来源
  - 给高价值城市补齐机场锚点之外的官方交叉验证

### P0-3: 增加 Open-Meteo 多模型 JSON 通道

- 目标：降低对 Meteoblue 页面解析的长期依赖。
- 作用：
  - 继续只做模型分歧、包络、峰值窗口参考
  - 不做概率输出
- 我们已经有合同位：
  - `src/operational-metadata.ts` 里的 `openMeteoMultiModel`

### P0-4: 先补站点覆盖，再继续扩城市

- 目标：补齐城市到 ICAO / METAR / 结算锚点映射，避免“城市多了但锚点是空的”。
- 当前策略：
  - 先补 tier-1 城市
  - 再补热点交易城市组
  - 最后扩大覆盖面

## 第二阶段

### P1-1: 做后端预热

- 目标：把现有前端预热升级为后端 cache prewarm。
- 优先预热：
  - 首页 dashboard
  - 分析页详情
  - Kelly 热门城市
- 要求：
  - 有热城市列表
  - 有运行心跳
  - 有成功/失败计数

### P1-2: 把监控做成可告警

- 目标：从“有 `/healthz`、`/metrics`”升级为“知道哪里坏了”。
- 第一版覆盖：
  - 数据源 freshness
  - fallback 连续触发
  - 城市 detail 补齐失败
  - 高价值城市长时间陈旧
  - prewarm 持续失败

### P1-3: 显式化详情完整度状态

- 目标：让“加载中 / 已同步 / 局部陈旧 / 正在补齐”有明确状态合同。
- 结果：
  - 避免城市切换、时间切换时短暂闪出旧数据
  - 让前端状态机更可解释

## 第三阶段

### P2-1: 做机场锚点 vs 官方站网对比卡

- 目标：让官方增强层不只是元数据，而是能直观看到差异。
- 展示内容：
  - 机场主站
  - 官方附近站
  - 温度差
  - 时间差
  - 当前是否可用于日内判断

### P2-2: 强化结构化信号

- 目标：把现在已经有的 `headline / base / upside / downside / next observation / invalidation / confirmation` 做得更实。
- 数据来源：
  - 小时轨道
  - METAR
  - 多模型分歧
  - 未来接入的 TAF / 官方增强层

## 本轮结论

- 最有价值的吸收顺序固定为：
  1. `TAF`
  2. 官方增强源适配器
  3. 后端预热
  4. 可告警监控
- 这样能直接复用我们已经上线的：
  - `sourceMetadata`
  - `intradaySignals`
  - `marketReference`
  - `/api/system/status`
  - `/metrics`

## 公开参考

- PolyWeather README:
  - <https://github.com/yangyuan-zhen/PolyWeather/blob/main/README.md>
- PolyWeather API 文档:
  - <https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/API_ZH.md>
- PolyWeather TAF 文档:
  - <https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/TAF_SIGNAL_ZH.md>
- PolyWeather 监控文档:
  - <https://github.com/yangyuan-zhen/PolyWeather/blob/main/docs/MONITORING_ZH.md>
- Open-Meteo Ensemble API:
  - <https://open-meteo.com/en/docs/ensemble-api>
- AviationWeather Data API:
  - <https://aviationweather.gov/data/api/>
