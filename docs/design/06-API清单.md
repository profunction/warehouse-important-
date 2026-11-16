# 第六部分：API 清单

## 多台 POS 的设计

| 问题 | 做法 |
|---|---|
| 收据编号 | 店代码 + 机号 + 流水，例如 KL01-P2-000123。离线不重复 |
| 库存扣哪里 | 每台机扣同一店货架位置，Movement 记 device_id |
| 钱箱 | 每机一个 CashDrawerSession。一人同一时间一台机 |
| 挂单 | 存服务器，店内任何机可取。断网只有原机 |
| 价格一致 | 同一服务器拉，改价 30 秒全店同步。离线机恢复先更新价格 |
| 断网 | 各自独立卖，各自排队上传，不需互联。B 模式大店可选店内小服务器 |
| 日结 | 每机各自日结，系统出全店汇总 |
| 报表 | 按店、机、收银员 |
| 顾客侧小屏 | 每机一个 |
| Pandal 多机 | external_ref = Pandal 终端号 + 交易号 |
| 上限 | 无硬上限。A 模式预设 2 台 |

## 四条总规则

1. HTTPS + JSON，/api/v1。旧版本保留 12 个月。
2. 三种身份：员工短期令牌（带公司站点角色）；设备密钥（POS、大屏，绑站点）；外部系统公司级 API 密钥（只能调对接接口）。
3. 权限在服务器检查。成本字段由同一过滤函数删除。
4. 所有写入带 client_id（UUID），重复返回原结果。

## 第一组：登录和基础

| 方法 | 路径 | 谁 | 用途 |
|---|---|---|---|
| POST | /auth/login | 员工 | 员工卡或手机号 + PIN，返回令牌和站点 |
| POST | /auth/select-site | 员工 | 返回角色、首页按钮、权限 |
| POST | /auth/device | 设备 | 设备密钥换令牌 |
| POST | /auth/supervisor-pin | POS | 一次性授权码 |
| GET | /me | | 资料、角色、代理状态 |
| GET | /sync/pull?since= | 手机 POS 大屏 | 增量拉主数据 |
| POST | /sync/push | 手机 POS | 批量上传离线队列，逐条返回 |

## 第二组：主数据

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /products?search=&category= | 所有 | 三语和拼音搜索 |
| GET | /products/by-barcode/{barcode} | 所有 | 含换算量，解析称重码 |
| GET | /products/{id} | 所有 | 成本按权限 |
| POST PUT | /products | product.edit | |
| POST | /products/{id}/barcodes | barcode.add | |
| PUT | /products/{id}/price | price.edit | 写 PriceHistory，超权限变审批 |
| GET POST PUT | /categories /suppliers /customers /tax-codes | 对应 | |
| GET POST PUT | /sites /zones /locations | location.manage | |
| GET | /locations/by-code/{code} | 所有 | 扫货位 |
| POST | /locations/labels | label.print | 标签 PDF |
| GET | /zones/{id}/contents | stock.view | 区内容、占用、到期 |
| GET PUT | /sites/{id}/map | map.edit 写 | |
| POST | /sites/{id}/map/publish | map.edit | 推送大屏 |

## 第三组：库存和移动

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /stock/by-product/{id} | stock.view | |
| GET | /stock/by-location/{id} | stock.view | |
| GET | /stock/lookup/{barcode} | 所有 | 产品、总量、各位置、最近移动 |
| POST | /movements | 按 reason | 唯一库存写入口。product_id, from_location_id, to_location_id, qty, reason, ref_type, ref_id, client_id, device_id, performed_at |
| GET | /movements?... | movement.view | 一线只回自己的 |
| POST | /shelf-assignments | shelf.assign | 触发大屏推送 |
| GET | /stock/low?site= | order.view | |
| GET | /stock/expiring?days= | stock.view | |
| GET | /stock/negative | stock.view | |

## 第四组：采购、收货、调拨

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /order-proposals/today | order.view | |
| PUT | /order-proposals/{id}/lines | order.review | |
| POST | /order-proposals/{id}/submit | order.review | |
| POST | /approvals/{id}/decide | 按类型 | approve/reject/return。Telegram 按钮也调这里 |
| GET | /approvals/pending | 所有 | 含代理 |
| GET POST | /purchase-orders | po.* | |
| GET | /purchase-orders/{id}/pdf /xlsx | po.view | |
| POST | /purchase-orders/{id}/send | po.send | |
| POST | /purchase-orders/{id}/cancel | po.cancel | |
| GET | /goods-receipts/pending?site= | receive | |
| POST | /goods-receipts | receive | |
| POST | /goods-receipts/{id}/lines | receive | 内部调 /movements |
| POST | /goods-receipts/{id}/complete | receive | 差异、工单、GRN |
| GET | /putaway/pending?site= | putaway | |
| GET | /putaway/suggest?product=&site= | putaway | |
| GET POST | /transfers | transfer.* | |
| POST | /transfers/{id}/pick-lines | transfer.pick | |
| POST | /transfers/{id}/dispatch | transfer.pick | |
| POST | /transfers/{id}/receive-lines | transfer.receive | |
| POST | /transfers/{id}/complete | transfer.receive | |

## 第五组：盘点

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /counts/my-today | count.enter | 按路线排 |
| POST | /counts | count.assign | |
| POST | /counts/{id}/lines | count.enter | 不返回系统量 |
| POST | /counts/{id}/location-done | count.enter | 可标空 |
| POST | /counts/{id}/submit | count.enter | |
| GET | /counts/{id}/variance | count.approve | |
| POST | /counts/{id}/approve | count.approve | 内部调 /movements |
| GET PUT | /count-rules | count.rules | |

## 第六组：自有 POS（A 模式）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | /pos/sessions/open | 开班 |
| POST | /pos/sales | lines、payments、customer_id、einvoice_required、client_id、device_id、receipt_no |
| POST | /pos/sales/{id}/einvoice | 个人电子发票 |
| POST | /pos/sales/hold | 挂单 |
| GET | /pos/sales/hold/{code} | 取单 |
| POST | /pos/returns | 退货申请 → ApprovalRequest |
| GET | /pos/sales/{receipt_no} | 扫收据 |
| POST | /pos/sessions/{id}/close | 日结 Z 报表 |
| GET | /pos/catalog?since= | POS 专用瘦目录 |
| POST | /pos/scale-barcode/parse | 解析称重码，离线本地同算法 |
| GET | /pos/customers?search= | 含信用额 |

## 第七组：对外开放 API（Pandal 等，B 模式）公司级密钥，每分钟 600 次

| 方法 | 路径 | 方向 | 用途 |
|---|---|---|---|
| GET | /open/products?since= | 拉 | 无成本无库存数 |
| GET | /open/products/{barcode} | 拉 | |
| GET | /open/stock/{barcode}?site= | 拉 | 有无和数量，可关数量 |
| GET | /open/customers | 拉 | |
| POST | /open/sales | 推 | external_ref、site_code、lines、sold_at、payments。重复返回原结果 |
| POST | /open/sales/{external_ref}/void | 推 | |
| POST | /open/returns | 推 | |
| GET | /open/sales?from=&to= | 拉 | 对账 |
| POST | /open/webhooks | 注册 | product.updated, price.updated, product.deactivated |
| GET | /open/health | | |

我们主动：每 5 分钟拉 Pandal 交易转 /open/sales。无 API 时收银机小程序转导出文件。两条路同一接口。

## 第八组：发票和电子发票

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET POST | /invoices | invoice.* | |
| POST | /invoices/{id}/payments | payment.receive | |
| GET | /customers/{id}/statement?month= | invoice.view | |
| POST | /customers/{id}/statement/send | statement.send | |
| GET POST | /supplier-invoices | ap.* | |
| GET | /supplier-invoices/{id}/match | ap.view | |
| POST | /supplier-invoices/{id}/resolve | ap.resolve | |
| POST | /supplier-invoices/{id}/payments | ap.pay | 超门槛审批 |
| GET | /einvoice/submissions?status= | einvoice.view | |
| POST | /einvoice/submissions/{id}/retry | einvoice.manage | |
| POST | /einvoice/consolidated/{site}/{month}/preview | einvoice.manage | |
| POST | /einvoice/consolidated/{site}/{month}/submit | einvoice.manage | |
| POST | /period/{month}/lock | period.lock | |

MyInvois 调用在服务器内部，失败进重试队列最多 72 小时。

## 第九组：Excel

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /import/templates/{code} | import.upload | |
| POST | /import/jobs | import.upload | |
| GET | /import/jobs/{id}/preview | import.upload | |
| POST | /import/jobs/{id}/submit | import.upload | |
| POST | /import/jobs/{id}/apply | import.approve.* | |
| POST | /export | export.* | 服务器按角色决定列，写 ExportLog |

## 第十组：工单和通知

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| GET | /tickets/mine | 所有 | |
| GET | /tickets?site=&status=&type= | ticket.view_all | |
| POST | /tickets | 所有 | |
| POST | /tickets/{id}/events | 自己的 | |
| POST | /tickets/{id}/assign | ticket.manage | |
| POST | /tickets/{id}/accept | 上架员 | "我去" |
| GET | /notifications | 所有 | |
| POST | /devices/{id}/heartbeat | 设备 | 10 分钟无心跳开工单 |

## 第十一组：大屏（只读，设备密钥，网关只放行 /kiosk）

返回体没有成本、数量、仓库位置字段，模型里就没有。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /kiosk/catalog?since= | 本地缓存 |
| GET | /kiosk/search?q= | 拼音马来英文 |
| GET | /kiosk/categories | |
| GET | /kiosk/products/{barcode} | |
| GET | /kiosk/products/{id}/where | 本店货架 + in_stock 布尔 + 主货架 |
| GET | /kiosk/map | 当前版本 |
| GET | /kiosk/route?to=location_id | 坐标序列，离线本地算 |
| GET | /kiosk/promotions | |
| POST | /kiosk/help | 叫员工 → ticket_id |
| GET | /kiosk/help/{ticket_id} | 员工是否已接 |
| WS | /kiosk/events | shelf.updated, map.published, help.accepted, price.updated |
| POST | /kiosk/heartbeat | |

## 第十二组：机器人

大语言模型只能选查询和填参数，不能写 SQL。

| 方法 | 路径 | 谁 | 用途 |
|---|---|---|---|
| POST | /bot/ask | 员工 App | text 或 audio、language |
| POST | /bot/telegram/webhook | Telegram | 消息和按钮回调 |
| GET | /bot/queries | 内部 | 当前角色可用查询 |
| POST | /bot/queries/{code}/run | 内部 | 参数校验、权限、上限 50 行 |
| GET | /bot/knowledge/search?q= | 内部 | 向量搜索 |
| POST | /bot/escalate | 内部 | 开工单 BOT_UNANSWERED |
| POST | /knowledge | kb.edit | 存知识库 |
| GET | /bot/conversations?unanswered=true | kb.edit | |

### 固定查询清单

| 代码 | 问法 | 权限 |
|---|---|---|
| STOCK_BY_BARCODE | 这个条码在哪里还有多少 | stock.view |
| PRODUCT_LOCATION_SHOP | 可乐在哪个货架 | 所有 |
| ZONE_CONTENTS | A 区有什么 | stock.view |
| LOW_STOCK | 今天什么要补 | order.view |
| EXPIRING | 这周什么到期 | stock.view |
| TODAY_SALES | 今天卖了多少 | report.sales |
| PRODUCT_SALES_30D | 一个月卖多少 | report.sales |
| MY_TICKETS | 我有什么工单 | 所有 |
| PENDING_APPROVALS | 什么等我批 | 所有 |
| PO_STATUS | 货什么时候到 | po.view |
| TRANSFER_STATUS | 调拨到了没 | transfer.view |
| PRODUCT_COST | 成本多少 | product.view_cost |
| DEVICE_STATUS | 哪台掉线 | device.view |

### Telegram 消息类型

| 类型 | 内容 | 按钮 |
|---|---|---|
| 每日订货 | 分供应商清单 | 全部批准、逐项修改、拒绝 |
| 单项审批 | 类型、发起人、金额 | 批准、拒绝、看详情 |
| 日报 | 销售、现金差、低库存、工单、代理 | 看报表 |
| 工单提醒 | 超期清单 | 看工单 |
| 收货摘要 | GRN、差异 | 看 GRN |
| 设备告警 | 掉线 | 开工单 |
| 代理通知 | 指定、到期、撤销 | 无 |
| 自由问答 | 回答 | 深链接 |

## 接口数量：约 129
