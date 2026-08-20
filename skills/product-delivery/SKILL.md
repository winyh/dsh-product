---
name: product-delivery
description: Use dsh-product for evidence-backed product delivery from opportunity handoff through POC, MVP, beta, PMF and explicit continue, iterate, hold, abandon or scale decisions.
---

# 产品落地与决策门

`dsh-product` 处理已经确认的机会进入产品后的验证、交付和阶段决策，并可查询公开互联网资讯作为产品证据；不替代 `dsh-idea` 的需求发现，也不替代 `dsh-growth` 的增长执行。

## 资讯查询

在产品 Brief、POC、竞品判断、法规判断、定价研究或版本决策前，优先使用 `product_research` 查询当前公开资讯；对关键的一手来源再使用 `product_source_scan` 获取有限原文快照。

- 查询只使用公开 HTTP(S) 能力，不携带 Cookie、登录态或本地项目文件；
- 搜索摘要和页面快照都必须标明证据边界，关键事实回到原文核验；
- 资讯查询用于产品方法、技术、竞品、市场背景、法规、定价和发布动态，不用于替代 `dsh-idea` 的需求发现；
- 没有 Web 提供方时，输出“缺证据”，不要用猜测填充。

## 决策门

使用 `product_decision_review` 评估当前阶段是否应该：

- `proceed`：所有决策门通过，进入下一阶段；
- `iterate`：有失败或警告项，先做最小修正和验证；
- `hold`：证据不足，补齐证据后再判断；
- `abandon`：存在明确的 `blocking=true` 关键失败，关闭或重新定义当前方向；
- `scale`：所有决策门通过，并且调用方明确设置 `scaleReady=true`。

决策门使用 JSON 数组，每项至少包含 `label` 和 `status`：

```json
[
  {
    "id": "value",
    "label": "用户是否获得核心价值",
    "status": "pass",
    "evidence": "目标用户中 7/10 完成核心任务",
    "threshold": "至少 6/10",
    "blocking": true
  }
]
```

明确区分失败和缺证据：缺证据会得到 `hold`，不会自动得到 `abandon`；没有标记 `blocking=true` 的失败会得到 `iterate`。只有关键阻断门失败时才建议放弃。

## 阶段顺序

通常按照 `handoff → strategy → poc → mvp → beta → pmf → growth-handoff` 推进。`product_decision_review` 的 `stage` 表示正在做决策的阶段，只有 `proceed` 才会给出下一阶段；`scale` 表示在护栏指标下扩大投入。

## 工具选择

- `product_brief`：明确目标、用户、价值主张和成功标准；
- `product_research`：查询与当前产品阶段相关的互联网资讯和可引用来源；
- `product_source_scan`：读取用户明确提供的公开一手来源并生成有限快照；
- `product_poc_plan`：验证最高风险并预先写明成功/失败阈值；
- `product_mvp_plan`：定义最小可交付和可观测范围；
- `product_release_check`：判断是否发布、带条件发布或暂缓；
- `product_pmf_review`：复盘价值、使用、留存、商业和推荐证据；
- `product_decision_review`：做统一的继续/调整/暂缓/放弃/扩大决策；
- `product_growth_handoff`：通过产品决策门后交给 `dsh-growth`。
