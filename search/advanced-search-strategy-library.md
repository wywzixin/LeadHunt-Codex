# LeadHunt 高级搜索策略库

版本：V1.0  
生成日期：2026-04-28  
定位：通信设备行业 AI 外贸获客搜索策略库  
结构化版本：[advanced-search-strategy-library.json](advanced-search-strategy-library.json)

## 1. 这是什么

这个文件就是你说的“Google search 指令库”的正式版本，但名字改成 **高级搜索策略库**。

原因是：V1 真正自动执行搜索的是 Brave Search API，不是人工在 Google 里搜。所以这个库不能只写 Google 指令，也不能追求所谓“Google 指令全集”。它要同时管理：

- Brave 官方 operator 白名单
- Google 官方常用搜索逻辑
- 常见但需测试的 SEO 搜索操作符
- 外贸获客业务模板
- 通信设备行业关键词库
- 排除词库
- 每个搜索式的执行效果评分

`google search.md` 只作为初始业务经验输入，不作为完整规则库。

## 2. 什么时候生成

这个库现在已经生成，生成时间是 **2026-04-28**。

后续开发时，LangGraph 的 `plan_search_queries` 节点应该读取结构化 JSON：

```text
search/advanced-search-strategy-library.json
```

然后根据用户任务、产品画像、参考客户画像和目标国家，生成至少 15 组可执行 query。

## 3. 官方来源

- Brave Search API Search Operators：https://api-dashboard.search.brave.com/documentation/resources/search-operators
- Google Search Help Refine Searches：https://support.google.com/websearch/answer/2466433

## 4. 兼容性字段

每个 operator 和模板都需要记录两个关键字段。

`operator_source`：

| 值 | 含义 |
| --- | --- |
| `brave_official` | Brave 官方文档列出的 operator，V1 自动执行优先使用 |
| `google_official` | Google 官方帮助文档中的常用搜索逻辑 |
| `common_seo` | SEO 圈常见用法或历史 Google 用法，需要测试或只允许手动 |

`execution_status`：

| 值 | 含义 |
| --- | --- |
| `supported` | 已验证可稳定用于当前执行器 |
| `experimental` | 官方列出或可执行，但需要持续记录效果 |
| `manual_only` | 可作为人工搜索策略，不进入 V1 自动执行 |
| `disabled` | V1 不自动生成 |

V1 默认把 Brave 官方 operator 也标记为 `experimental`，因为 Brave 官方说明 search operators 仍需要持续测试。

## 5. V1 优先执行白名单

这些操作符由 Brave 官方文档列出，V1 可以优先支持，但必须记录执行效果。

| 操作符 | 来源 | 执行状态 | 用途 |
| --- | --- | --- | --- |
| `"关键词"` | `brave_official` / `google_official` | `experimental` | 精确匹配品牌、产品和客户类型 |
| `-term` | `brave_official` / `google_official` | `experimental` | 排除招聘、新闻、培训、论坛、消费者内容 |
| `OR` / `AND` / `NOT` | `brave_official` | `experimental` | 组合产品词、品牌词和客户类型词 |
| `site:` | `brave_official` / `google_official` | `experimental` | 限定国家域名或目标站点 |
| `filetype:` / `ext:` | `brave_official` | `experimental` | 查找 PDF、Excel、目录、展商名单和资料表 |
| `intitle:` | `brave_official` | `experimental` | 强化标题命中 |
| `inbody:` / `inpage:` | `brave_official` | `experimental` | 强化页面正文和页面内容命中 |
| `loc:` / `lang:` | `brave_official` | `experimental` | 地区和语言约束 |
| `+term` | `brave_official` | `experimental` | 要求某个词必须出现，谨慎使用 |

## 6. 手动或禁用操作符

| 操作符 | 来源 | 执行状态 | 说明 |
| --- | --- | --- | --- |
| `inurl:` | `common_seo` | `manual_only` | Google / SEO 常见用法，不进入 V1 Brave 自动执行白名单 |
| `intext:` | `common_seo` | `manual_only` | Google / SEO 常见用法，不进入 V1 Brave 自动执行白名单 |
| `allintitle:` / `allinurl:` / `allintext:` | `common_seo` | `disabled` | V1 不自动生成 |
| `before:` / `after:` / `AROUND()` / `related:` / `cache:` | `common_seo` | `disabled` | V1 不自动生成 |

## 7. AI 扩展词模型

这个部分借鉴跨境魔方的“AI 扩展词”思路，但要改成通信设备行业版本。

搜索前先扩词，再套高级搜索策略模板。不要直接拿用户输入的一个主产品去搜，否则结果会太窄或太泛。

### 7.1 扩词维度

| 维度 | 说明 | 通信设备示例 |
| --- | --- | --- |
| 用户输入的主产品 | 从用户输入、产品画像或独立站中识别核心产品 | `telecom equipment`、`RRU`、`BBU`、`microwave backhaul`、`telecom power` |
| 同类产品 / 细分品类 | 把主产品扩展成相关产品、型号、模块、应用品类 | `AAU`、`remote radio unit`、`baseband unit`、`rectifier module`、`optical module` |
| 商品长尾词 | 更接近买家搜索、产品目录、库存页和采购清单里的具体产品名称 | `Huawei RRU spare parts`、`ZTE BBU boards`、`telecom power rectifier module` |
| 上下游词 | 零部件、技术材料、配套设备、供应链和服务环节相关词 | `power module`、`RF module`、`antenna feeder`、`site power`、`IBS solution` |
| 客户采购意图词 | 围绕采购、进口、批发、经销、现货、供应、项目交付等商业意图扩展 | `distributor`、`stockist`、`importer`、`purchasing`、`project supply` |
| 目标市场词 | 结合国家、地区、城市、国家域名、loc operator 和 API country 参数生成本地化搜索词 | `UAE`、`Dubai`、`Saudi Arabia`、`Riyadh`、`Nigeria`、`Lagos` |
| 行业场景词 | 根据产品使用场景、应用行业、解决方案方向扩展 | `telecom infrastructure`、`network rollout`、`site maintenance`、`tower power` |

### 7.2 通信设备扩词示例

用户输入：

```text
帮我找 UAE / Saudi 的通信设备经销商和系统集成商
```

AI 扩展词：

```text
主产品：
telecom equipment

同类产品 / 细分品类：
RRU, BBU, AAU, microwave backhaul, telecom power

商品长尾词：
Huawei RRU spare parts, ZTE BBU boards, telecom power rectifier module,
microwave link equipment supplier

上下游词：
power module, antenna feeder, IBS solution, network maintenance,
equipment refurbishment

客户采购意图词：
distributor, stockist, system integrator, telecom contractor, importer, purchasing

目标市场词：
UAE, Dubai, Abu Dhabi, Saudi Arabia, Riyadh, Jeddah

行业场景词：
telecom infrastructure, network rollout, site maintenance, spare parts availability
```

### 7.3 扩词后的搜索组合

扩词结果不是直接展示完就结束，而是进入 `keyword_groups`，再与策略模板组合：

```text
("RRU" OR "BBU" OR "AAU") ("distributor" OR "stockist" OR "system integrator") UAE -job -training -news
```

```text
("telecom power" OR "rectifier module") ("supplier" OR "service" OR "stockist") Saudi
```

```text
("Huawei RRU spare parts" OR "ZTE BBU boards") ("importer" OR "trading" OR "purchasing") UAE
```

## 8. 通信设备关键词池

品牌词：

```text
Huawei, ZTE, Ericsson, Nokia, Eltek, Delta, Vertiv
```

产品词：

```text
RRU, BBU, AAU, remote radio unit, baseband unit, microwave backhaul,
telecom power, rectifier, power module, telecom battery, optical module,
OLT, board, spare parts, refurbished telecom equipment
```

客户类型词：

```text
telecom equipment distributor, telecom equipment stockist,
telecom spare parts supplier, system integrator, telecom contractor,
tower contractor, IBS contractor, network maintenance company,
telecom service provider, telecom trading company, telecom importer
```

业务场景词：

```text
project supply, network rollout, site maintenance, equipment replacement,
spare parts availability, microwave link, telecom infrastructure,
tower power, IBS solution, lifecycle extension
```

排除词：

```text
-job, -jobs, -career, -training, -course, -news, -blog, -forum,
-youtube, -facebook, -linkedin, -wiki, -consumer, -phone,
-marketplace, -directory, -yellowpages, -Alibaba, -Amazon,
-AliExpress, -China, -Chinese, -cn
```

## 9. V1 默认搜索模板

### 9.1 多品牌通信设备经销商 / 现货商

```text
("RRU" OR "BBU" OR "AAU") ("distributor" OR "stockist" OR "system integrator") UAE -job -training -news
```

### 9.2 标题命中 telecom equipment

```text
intitle:"telecom equipment" ("Huawei" OR "ZTE") ("stockist" OR "distributor") site:.ae
```

### 9.3 备件贸易商 / 进口商

```text
"Huawei ZTE spare parts" ("trading" OR "importer" OR "purchasing") UAE -Alibaba -Amazon -China -forum
```

### 9.4 微波回传 / 电源服务商

```text
inpage:telecom ("microwave backhaul" OR "telecom power") ("service" OR "solution") loc:sa
```

### 9.5 系统集成商 / 工程承包商

```text
("telecom infrastructure" OR "network rollout") ("system integrator" OR "turnkey contractor" OR "telecom contractor") Saudi
```

### 9.6 铁塔 / 电源 / IBS 服务商

```text
("tower power" OR "IBS service" OR "site maintenance") ("telecom" OR "mobile network") UAE -job -training -news
```

### 9.7 网络维护 / 设备替换

```text
("network maintenance" OR "equipment replacement" OR "refurbished telecom equipment") ("RRU" OR "BBU" OR "telecom spare parts") Nigeria
```

### 9.8 PDF 展商 / 目录线索

```text
filetype:pdf "telecom" ("exhibitors" OR "catalog") UAE
```

### 9.9 光网络 / OLT 设备渠道商

```text
("OLT" OR "optical module" OR "fiber access") ("distributor" OR "stockist" OR "supplier") Kenya -job -news -training
```

### 9.10 通信电源 / 整流模块

```text
("telecom power" OR "rectifier" OR "power module") ("Eltek" OR "Delta" OR "Vertiv") ("supplier" OR "service") Brazil
```

### 9.11 品牌 + 备件可用性

```text
("Huawei" OR "ZTE" OR "Ericsson" OR "Nokia") ("spare parts" OR "replacement parts" OR "availability") ("stockist" OR "supplier") UAE
```

### 9.12 公司官网服务页强化

```text
inbody:"telecom" inpage:"services" ("microwave" OR "power" OR "network maintenance") loc:ae
```

### 9.13 国家域名限定

```text
("telecom equipment" OR "telecom spare parts") ("distributor" OR "supplier") site:.ae
```

### 9.14 贸易 / 采购语义

```text
("telecom equipment" OR "network equipment") ("purchase" OR "purchasing" OR "importer" OR "trading") Saudi
```

### 9.15 招投标 / 项目线索

```text
("telecom project" OR "network upgrade" OR "site rollout") ("contractor" OR "integrator" OR "supplier") UAE
```

## 10. 生成规则

每个任务至少生成 15 组组合 query。

每条 query 至少包含：

- 一个产品词或品牌词
- 一个客户类型词
- 一个国家/地区约束
- 一组排除词，除非是文件搜索或站点限定搜索
- `operator_source`
- `execution_status`
- 原始策略模板
- 实际提交给 Brave 的 query

V1 禁止自动执行：

- `manual_only`
- `disabled`

每条 query 执行后要记录：

- 候选结果数量
- 去重后公司数量
- ICP 合格数量
- 平均 ICP 分数
- 邮箱可用率
- 后续回复率
- query 效果评分

## 11. LangGraph 使用方式

推荐节点：

```text
load_search_strategy_library
  -> expand_keywords
  -> select_strategy_templates
  -> fill_keywords_and_market
  -> validate_operator_compatibility
  -> generate_minimum_15_queries
  -> brave_search
  -> score_query_effectiveness
```

也就是说：现在生成的是“库”，不是每次都现场凭空想搜索词。后面用户输入任务时，Agent 从这个库里挑模板、填关键词、检查兼容性，再执行搜索。
