# 显示链路统一与乱码防回归计划

## 背景
- 本轮目标不是再次做单点乱码修补，而是收敛前后端显示链路，避免同类问题反复进入首页和分析工作区。
- 现状已确认存在三类结构性风险：
  - 后端与前端各自维护一份天气响应契约，容易漂移。
  - 后端翻译、前端翻译、页面兜底文案同时存在，中文来源不唯一。
  - 页面容器直接承担路由、加载、派生、翻译、错误文案，导致重复逻辑和回归难发现。

## 已确认根因
- `src/domain/weather.ts` 与 `zip/src/types.ts` 为双份手写契约。
- `src/providers/meteoblue/week.ts` 和 `zip/src/App.tsx` 仍残留坏掉的中文字符串。
- `zip/src/mappers.ts` 同时承担清洗、排序、派生和兼容兜底。
- `tools/check-encoding.mjs` 与 `tests/encoding-guard.test.ts` 只拦截极窄的 mojibake token，没覆盖真实坏字样本。

## 实施范围
- 后端：
  - 修复 `src/providers/meteoblue/week.ts` 中残留的乱码翻译与兜底文本。
  - 明确后端中文出口：`report.textZh`、`hourly.items[].summaryZh`、稳定 warning/predictability 展示文本。
- 前端：
  - 将 `zip/src/types.ts` 收敛为基于后端共享契约的薄别名层，不再双写结构。
  - 抽离 `App.tsx` 中的页面显示文案、peak summary、warning 翻译与页面装配逻辑。
  - 保持现有 UI 和交互，不重做布局。
- 工程防线：
  - 扩展编码检测覆盖 `src` 与 `zip/src` 全链路。
  - 增加针对后端中文文本和前端显示兜底的回归验证。

## 验收标准
- 首页与分析工作区不再出现乱码、半中半英或损坏标点。
- 后端成为中文天气语义的唯一主来源，前端不再主翻译天气内容。
- 前端显示契约只保留一层适配边界，页面组件不直接消费原始混合语义。
- `npm test`
- `npm run check`
- `npm run build`

## 备注
- 本轮不改路由、不改接口路径、不改现有核心视觉和交互。
- 若实施中发现必须扩大到接口 shape 变更，再单独写 decision 记录。
