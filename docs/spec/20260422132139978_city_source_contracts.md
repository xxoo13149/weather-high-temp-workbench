# 城市-站点-来源合同表（v2026-04-22）

## 合同规则

- 基线预测：统一以 `Meteoblue Week Page` 为生产基线。
- 多模型解释层：当前仍以 `Meteoblue Multimodel Page` 为生产来源，下一阶段接入 `Open-Meteo Multi-Model`。
- 观察锚点：`AviationWeather METAR` 只有在已解析 station code 时才视为 `production`，否则为 `candidate`。
- TAF：只作为 `airport-disruption-confirmation`，不作为主温度模型。
- 官方增强层：按区域逐城接入，当前只在合同里声明 `planned/candidate`。
- Kelly：继续复用既有市场映射逻辑，状态统一视为 `production`。

## 上线顺序

| 优先级 | 目标 |
| --- | --- |
| `tier-1` | 先补 METAR / 官方增强 / 预热，作为生产核心城市 |
| `tier-2` | 作为高价值扩容批，完成合同补齐后再上增强层 |
| `tier-3` | 先保持 baseline + multimodel 基线，逐步补观察与增强 |

## 城市合同表

| locationId | code | tier | settlement ref | 观察层状态 | Open-Meteo | TAF | 官方增强层 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `shanghai_pvg` | `PVG` | `tier-1` | `ZSPD` | `production` | `planned` | `planned` | `NMC / CMA 官方站网: planned` |
| `wuhan_wuh` | `WUH` | `tier-1` | `ZHHH` | `production` | `planned` | `planned` | `NMC / CMA 官方站网: planned` |
| `beijing_pek` | `PEK` | `tier-1` | `-` | `candidate` | `planned` | `candidate` | `NMC / CMA 官方站网: planned` |
| `busan_pus` | `PUS` | `tier-1` | `-` | `candidate` | `planned` | `candidate` | `KMA 站网: planned` |
| `chengdu_ctu` | `CTU` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `NMC / CMA 官方站网: candidate` |
| `chongqing_ckg` | `CKG` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `NMC / CMA 官方站网: candidate` |
| `hongkong_hkg` | `HKG` | `tier-1` | `-` | `candidate` | `planned` | `candidate` | `Hong Kong Observatory: planned` |
| `jakarta_hlp` | `HLP` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `jeddah_jed` | `JED` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `kualalumpur_kul` | `KUL` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `lucknow_lko` | `LKO` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `seoul_icn` | `ICN` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `shenzhen_szx` | `SZX` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `NMC / CMA 官方站网: candidate` |
| `singapore_sin` | `SIN` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `taipei_tpe` | `TPE` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `telaviv_tlv` | `TLV` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `tokyo_hnd` | `HND` | `tier-1` | `-` | `candidate` | `planned` | `candidate` | `JMA AMeDAS: planned` |
| `istanbul_ist` | `IST` | `tier-2` | `LTFM` | `production` | `planned` | `candidate` | `MGM 官方站网: candidate` |
| `munich_muc` | `MUC` | `tier-2` | `EDDM` | `production` | `planned` | `candidate` | `-` |
| `amsterdam_ams` | `AMS` | `tier-1` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `ankara_esb` | `ESB` | `tier-1` | `-` | `candidate` | `planned` | `candidate` | `MGM 官方站网: planned` |
| `helsinki_hel` | `HEL` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `london_lcy` | `LCY` | `tier-1` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `madrid_mad` | `MAD` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `milan_mxp` | `MXP` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `moscow_vko` | `VKO` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `paris_cdg` | `CDG` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `warsaw_waw` | `WAW` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `capetown_cpt` | `CPT` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `lagos_los` | `LOS` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `toronto_yyz` | `YYZ` | `tier-1` | `CYYZ` | `production` | `planned` | `planned` | `-` |
| `miami_mia` | `MIA` | `tier-1` | `KMIA` | `production` | `planned` | `planned` | `-` |
| `atlanta_atl` | `ATL` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `losangeles_lax` | `LAX` | `tier-1` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `austin_aus` | `AUS` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `buenosaires_eze` | `EZE` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `chicago_ord` | `ORD` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `dallas_dal` | `DAL` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `denver_bfk` | `BFK` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `houston_hou` | `HOU` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `mexicocity_mex` | `MEX` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `newyork_lga` | `LGA` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `panamacity_pac` | `PAC` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `sanfrancisco_sfo` | `SFO` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `saopaulo_gru` | `GRU` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `seattle_sea` | `SEA` | `tier-3` | `-` | `candidate` | `planned` | `candidate` | `-` |
| `wellington_wlg` | `WLG` | `tier-2` | `-` | `candidate` | `planned` | `candidate` | `-` |

## 第一批建议补齐清单

1. 先把 `tier-1` 中已有官方增强声明的城市落地：`shanghai_pvg`, `wuhan_wuh`, `hongkong_hkg`, `tokyo_hnd`, `busan_pus`, `ankara_esb`。
2. 继续补齐 `tier-1` 的 METAR station mapping：`beijing_pek`, `losangeles_lax`, `amsterdam_ams`, `london_lcy`。
3. 再进入 `tier-2` 的中国与土耳其城市，优先 `chengdu_ctu`, `chongqing_ckg`, `shenzhen_szx`, `istanbul_ist`。
