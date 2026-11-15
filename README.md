# 个人中控台（豆包版）

原站：WorkBuddy 生成的 `console-hub`（腾讯云 CloudBase 托管，云端表 `cc_state`）。
本目录是把那套系统按「界面 + 功能 + 数据」1:1 重建的版本，纯静态，双击文件即可用。

## 文件结构

```
个人中控台/
├─ 个人中控台.html          ← 门户（10 张卡片，打开这个）
├─ pages/
│  ├─ quotes.html           1 弱智吧（原名言警句，2026-11-10 改名，key 仍是 quotes）
│  ├─ memo.html             2 备忘提醒系统
│  ├─ funds.html            3 指数 / 基金观察
│  ├─ visit.html            4 客户拜访安排
│  ├─ credit-card.html      5 信用卡还款管理系统（4 个 tab）
│  ├─ credit-card-offers.html  5-T 信用卡优惠资讯（三级页，首页无卡片）
│  ├─ shopping.html         6 购物计价系统
│  ├─ read-aloud.html       7 温柔朗读
│  ├─ screenshot.html       8 截图取字 · 翻译 · 朗读
│  ├─ news.html             9 政策 · 板块资讯台（5 个 tab）
│  └─ backup.html           10 数据备份与恢复（永远排最后）
├─ shared/hub.css           共享样式（沿用原站视觉）
├─ shared/hub.js            共享数据层（存储 + 同步 + 备份）
└─ data/seed.js             真实数据种子（首次打开自动写入本机）
```

12 个页面齐全（1 门户 + 10 二级 + 1 三级），与磁盘上原站的 HTML 数量一致。

## 数据存在哪里

- 默认：浏览器 `localStorage`，键名 `hub_v1_<key>`，与原站云端表的 key 一一对应：
  `quotes / memos / cards / insts / repay_records / funds / visits / shopping / news / news_saved / news_cols / news_crowd / auto_memo_ids / offers`
  （原站 13 个业务 key + 未登记的 `memos_hourly`；本站把 `offers` 也归档为独立 key，共 14 个）。
- 换浏览器、换设备时本机数据不跟过去，这是浏览器的限制，不是 bug。
- 右上角「同步」徽章点开可配云端同步，配置一次即可多设备互通。

## 怎样开多设备同步（3 步，约 5 分钟）

原站靠 WorkBuddy 自动配的 CloudBase（你那个空间资源点已用尽，`cc_state` 被隔离，线上已读不到数据）。
豆包不会替网页自动配后端，所以这里给出两条真能跑的路，你选一个：

### 方案 A：Supabase（推荐，免费额度够用）

1. 去 supabase.com 免费建一个项目。
2. 打开 SQL Editor，执行：

```sql
create table if not exists hub_state (
  id text primary key,
  payload jsonb,
  updated_at timestamptz default now()
);
alter table hub_state enable row level security;
create policy "hub_all" on hub_state for all
  using (true) with check (true);
```

3. 把项目 URL（形如 `https://abcd.supabase.co`）和 anon public key 填进任意一页右上角「同步」弹窗，
   选「Supabase」→ 保存并立即同步。手机、电脑各填一次同一套配置即可。

同步方式说明：写入是「先拉后推」的读-改-写，按 key 的更新时间戳合并，所以两台设备同时改**不同**系统不会互相覆盖；
同一秒改同一条记录时以时间戳较新的为准。页面可见时每 15 秒拉一次，改动后 0.8 秒自动推一次——是轮询，不是实时推送，与原站一致。

### 方案 B：自定义 JSON 端点

任意支持 `GET`（读整份文档）和 `PUT`（写整份文档）的地址都行，例如 jsonblob.com 生成的地址，或你自己的接口。
文档格式：`{ schema:1, data:{ "<key>": { t: 毫秒时间戳, v: 值 } } }`。

## 真实数据：哪些全、哪些只有样例

数据逐字来自 WorkBuddy 每日全量快照 `console-backup/out/2026-11-14.json`。**没有编造任何一条记录。**

| 类别 | 原站总量 | 本站内置 | 说明 |
|---|---|---|---|
| 信用卡 cards | 16 | **16（全）** | 含额度、账单日、还款日、宽限期、本期账单、剩余额度 |
| 分期 insts | 12 | **12（全）** | 含 IRR、总利息 |
| 优惠 offers | 23 | **23（全）** | 四平台优惠资讯全文 |
| 自动提醒标记 auto_memo_ids | 10 | **10（全）** | |
| 拥挤度 news_crowd | 3 天 | **3 天（全）** | 2026-11-12 ~ 14，每天 22 个指数 |
| 弱智吧 quotes | 86 句 | 23 句 | 导出文档只含样例 |
| 备忘 memos | 37 条 | 23 条 | 同上 |
| 观察标的 funds | 48 个 | 23 个 | 同上 |
| 客户 visits | 84 位 | 23 位 | 同上 |
| 资讯 news | 80 条 | 23 条 | 同上 |
| 购物 shopping | 0 | 0 | 原站即为空 |
| 还款记录 repay_records | 0 | 0 | 原站即为空 |

缺的部分**不猜、不补**。补全办法：把原站完整备份 JSON 放到 `pages/backup.html` 的「导入恢复」里，
它兼容三种格式（整份导出文档 / 纯数组 / `{data:{...}}`），导完刷新即全量恢复。

## 公式与规则（逐字照抄原站，已在本机复核）

- 还款周转：`fee=费率‰/1000`；`cashUsed=min(cash,billSum)`；`remainBill=billSum-cashUsed`；`totalNeed=remainBill/(1-fee)`；
  单卡 `share=billAmount/billSum`、`eff=billAmount-cashUsed*share`、`need=eff/(1-fee)`；
  出款区按「下个账单日由远及近」，`totalLimit=ΣremainLimit`、`usePct=totalNeed/totalLimit`、单卡 `need=remainLimit*usePct`、`arrive=need*(1-fee)`。
  额度不足提示 `totalNeed-totalLimit`。
- 分期恒等式：`M=P/n+I`；`T=M*n`；`TI=I*n`；`P=T-TI=M*n-TI`。四种算法 ① n+P+I ② n+P+M ③ n+P+T ④ n+TI+T。
- 真实月利率 IRR：`M*n<=P` 返回 0；`f(i)=M*(1-(1+i)^-n)/i-P`；`lo=1e-7,hi=1`（`f(hi)>0` 时 `hi*=2`，最多 40 次，`hi>1000` 中断）；二分 200 次。
  年化 = `irr*12`（单利近似，**不是** `(1+i)^12-1`）；百分比一律 `(v*100).toFixed(3)+'%'`。
  **复核结果：16 张卡里 12 笔分期的 IRR 与快照存的值完全一致**（0.959% / 1.648% / 0.597% / 0.520% …）。
- 宽限期：`graceEnd = dueDate + graceDays 天 + graceHour 点整`；`now>graceEnd→逾期`；`now>dueDate 23:59:59→宽限期`；否则正常。
- 自动宽限期备忘：**提醒时间 = 宽限期截止减 1 天，时刻不变**；仅 `billAmount>0`、`now<dueDate`、未超 `graceEnd` 7 天时生成；
  `id=auto_<cardId>_<dueDate>`；文本「<银行> 宽限期到X月X日X点」。
- 备忘重要度评分与「全局最多一条重要」、弱智吧置顶+排序规则、基金 `gapPct=(price-target)/target*100`、到点边沿触发、
  拜访 `wan()` 保费格式与「1 访不显示不参与搜索 / 2 访在备注之上」、购物 `bestOf` 与图片压缩、资讯台官方措辞 8 级 / A-B-C 档 / 估值分级 / 拥挤度阈值，
  均已按原文实现。

## 与原站不一样的地方（如实列出）

1. **没有服务端**。原站的定时抓取（资讯每天 02:59、拥挤度、优惠每天 08:00）、乐享客户数据拉取、妙搭平台 AI（音色合成 / 图片 OCR / 文档解析）
   都是云能力。静态页调不到：
   - 资讯页显示的是 2026-11-14 的真实镜像，点「抓取最新」不会真的联网抓（会被浏览器 CORS 拦），页面已写明。
   - 基金行情同样改为「改价」手填后本机计算；估值/拥挤度用内置真实快照。
   - 温柔朗读：平台音色换成浏览器 `speechSynthesis`；图片取字改用 CDN 的 tesseract.js（首次需联网下载）；PDF/doc/docx 解析**没实现**，页面直接提示改粘贴文字。
   - 截图取字：截图走 `getDisplayMedia`（**需 https 或 localhost，file:// 下不可用**，可改用「导入图片」）；框选保留拖拽 + 14px 磁吸，8 个把手与「沿用上次范围」未实现。
2. **自动备份**从「每天 03:00 服务端跑」改为「每天第一次打开时补备一份到本机，保留 5 份」（网页关掉后无法定时）。
3. 备份页多了一个「恢复初始数据」按钮（原站没有），用于清空改动回到种子数据。

## 顺手能做的事

- 想改完就发链接给别人看：这套是多文件站点，发布需整目录；单文件发布器只认单 HTML，不适合本目录。
- 想让手机也用：把整个目录放到任意能访问的 https 位置（或本机起个静态服务），再用同一套 Supabase 配置即可跨设备。
