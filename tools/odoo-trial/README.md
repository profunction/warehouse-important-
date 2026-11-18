# Odoo POS 试用

目的：让收银员试半天 Odoo Community 的 POS，判断第三阶段是接它还是自己做老人版 POS。

1. 装 Docker Desktop（Windows）。
2. 在这个目录开命令提示符：`docker compose up -d`。
3. 浏览器开 http://localhost:8069 ，建数据库时语言选 中文，勾 Point of Sale。
4. 试：扫码加商品、挂单、退货、现金找零、日结。看老人能不能在 30 分钟内学会。
5. 结论记到 `docs/design/phase3/00-硬件桥接与会计对接.md` 第 6 节。
6. 删除：`docker compose down -v`。
