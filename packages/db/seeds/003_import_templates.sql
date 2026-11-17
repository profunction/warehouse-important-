INSERT INTO import_template (code, version, sheet_name_zh, sheet_name_ms, sheet_name_en, columns, required_permission, plans) VALUES
('PRODUCT',1,'产品','Produk','Products','[
 {"key":"barcode","zh":"主条码","ms":"Kod Bar Utama","en":"Primary Barcode","required":true,"type":"barcode","example":"9556001234567"},
 {"key":"sku","zh":"货号 SKU","ms":"SKU","en":"SKU","required":false,"type":"text","example":"DRK-001"},
 {"key":"name_zh","zh":"中文名","ms":"Nama Cina","en":"Chinese Name","required":false,"type":"text","max":60,"example":"可口可乐 325ml"},
 {"key":"name_ms","zh":"马来文名","ms":"Nama Melayu","en":"Malay Name","required":false,"type":"text","max":60,"example":"Coca-Cola 325ml"},
 {"key":"name_en","zh":"英文名","ms":"Nama Inggeris","en":"English Name","required":false,"type":"text","max":60,"example":"Coca-Cola 325ml"},
 {"key":"category","zh":"类别","ms":"Kategori","en":"Category","required":true,"type":"category","example":"饮料"},
 {"key":"unit","zh":"单位","ms":"Unit","en":"Unit","required":true,"type":"enum","options":["件","公斤"],"example":"件"},
 {"key":"cost_price","zh":"成本价","ms":"Harga Kos","en":"Cost Price","required":true,"type":"money","min":0,"example":"1.20"},
 {"key":"sell_price","zh":"售价","ms":"Harga Jual","en":"Sell Price","required":true,"type":"money","gt":0,"example":"1.80"},
 {"key":"tax_code","zh":"税码","ms":"Kod Cukai","en":"Tax Code","required":false,"type":"tax_code","example":"SST-0"},
 {"key":"supplier","zh":"供应商","ms":"Pembekal","en":"Supplier","required":false,"type":"supplier","example":"F&N 代理"},
 {"key":"min_level","zh":"最低量","ms":"Paras Minimum","en":"Min Level","required":true,"type":"qty","min":0,"example":"24"},
 {"key":"reorder_qty","zh":"补货量","ms":"Kuantiti Pesan Semula","en":"Reorder Qty","required":true,"type":"qty","gt":0,"example":"48"},
 {"key":"pack_qty","zh":"每箱数量","ms":"Kuantiti Sekotak","en":"Pack Qty","required":false,"type":"int","gt":1,"example":"24"},
 {"key":"shelf_life_days","zh":"保质期天数","ms":"Hari Tempoh Simpan","en":"Shelf Life Days","required":false,"type":"int","example":"180"},
 {"key":"plu_code","zh":"称重 PLU","ms":"PLU Timbang","en":"Scale PLU","required":false,"type":"plu","example":"00123"},
 {"key":"backroom_location","zh":"后仓位置","ms":"Lokasi Stor","en":"Backroom Location","required":false,"type":"location","example":"S-02"},
 {"key":"photo_file","zh":"照片文件名","ms":"Nama Fail Foto","en":"Photo File","required":false,"type":"text","example":"9556001234567.jpg"},
 {"key":"note","zh":"备注","ms":"Nota","en":"Note","required":false,"type":"ignore","example":""}
]','import.approve.product','{A,B}'),
('BARCODE',1,'更多条码','Kod Bar Tambahan','More Barcodes','[
 {"key":"product_barcode","zh":"产品主条码","ms":"Kod Bar Produk","en":"Product Barcode","required":true,"type":"product_ref","example":"9556001234567"},
 {"key":"barcode","zh":"条码","ms":"Kod Bar","en":"Barcode","required":true,"type":"barcode","example":"19556001234564"},
 {"key":"barcode_type","zh":"类型","ms":"Jenis","en":"Type","required":true,"type":"enum","options":["单件","箱"],"example":"箱"},
 {"key":"pack_qty","zh":"换算数量","ms":"Kuantiti Setara","en":"Pack Qty","required":true,"type":"qty","gt":0,"example":"24"}
]','import.approve.product','{A,B}'),
('SUPPLIER',1,'供应商','Pembekal','Suppliers','[
 {"key":"name","zh":"名称","ms":"Nama","en":"Name","required":true,"type":"text","example":"F&N 代理"},
 {"key":"tin","zh":"税号 TIN","ms":"TIN","en":"TIN","required":false,"type":"tin","example":"C12345678900"},
 {"key":"email","zh":"电邮","ms":"E-mel","en":"Email","required":false,"type":"email","example":"order@fn.com"},
 {"key":"phone","zh":"电话","ms":"Telefon","en":"Phone","required":false,"type":"text","example":"0123456789"},
 {"key":"whatsapp","zh":"WhatsApp","ms":"WhatsApp","en":"WhatsApp","required":false,"type":"text","example":"60123456789"},
 {"key":"payment_terms_days","zh":"付款天数","ms":"Hari Bayaran","en":"Payment Days","required":false,"type":"int","example":"30"},
 {"key":"lead_time_days","zh":"送货天数","ms":"Hari Penghantaran","en":"Lead Days","required":false,"type":"int","example":"2"},
 {"key":"min_order_amount","zh":"最低订单金额","ms":"Pesanan Minimum","en":"Min Order","required":false,"type":"money","example":"500"}
]','import.approve.supplier','{A,B}'),
('OPENING_STOCK',1,'期初库存','Stok Awal','Opening Stock','[
 {"key":"barcode","zh":"条码","ms":"Kod Bar","en":"Barcode","required":true,"type":"any_barcode","example":"9556001234567"},
 {"key":"location","zh":"位置代码","ms":"Kod Lokasi","en":"Location Code","required":true,"type":"location","example":"S-02"},
 {"key":"qty","zh":"数量","ms":"Kuantiti","en":"Qty","required":true,"type":"qty","gt":0,"example":"48"},
 {"key":"expiry_date","zh":"到期日","ms":"Tarikh Luput","en":"Expiry Date","required":false,"type":"date","example":"2027-03-31"}
]','import.approve.opening_stock','{A,B}'),
('LOCATION',1,'位置','Lokasi','Locations','[
 {"key":"site_code","zh":"站点代码","ms":"Kod Tapak","en":"Site Code","required":true,"type":"site","example":"WH1"},
 {"key":"zone_code","zh":"区代码","ms":"Kod Zon","en":"Zone Code","required":true,"type":"zone_code","example":"A"},
 {"key":"zone_name","zh":"区名称","ms":"Nama Zon","en":"Zone Name","required":true,"type":"text","example":"饮料区"},
 {"key":"zone_type","zh":"区类型","ms":"Jenis Zon","en":"Zone Type","required":true,"type":"enum","options":["收货","存储","货架","后仓"],"example":"存储"},
 {"key":"allowed_categories","zh":"允许类别","ms":"Kategori Dibenarkan","en":"Allowed Categories","required":false,"type":"category_list","example":"饮料;零食"},
 {"key":"racks","zh":"架数","ms":"Bilangan Rak","en":"Racks","required":true,"type":"int","min":1,"max":99,"example":"10"},
 {"key":"levels","zh":"层数","ms":"Bilangan Tingkat","en":"Levels","required":true,"type":"int","min":1,"max":9,"example":"4"},
 {"key":"boxes_per_level","zh":"每层标准箱数","ms":"Kotak Setiap Tingkat","en":"Boxes per Level","required":false,"type":"int","example":"12"}
]','import.approve.location','{B}'),
('CUSTOMER',1,'客户','Pelanggan','Customers','[
 {"key":"name","zh":"名称","ms":"Nama","en":"Name","required":true,"type":"text","example":"ABC 餐厅"},
 {"key":"tin","zh":"税号 TIN","ms":"TIN","en":"TIN","required":true,"type":"tin","example":"C98765432100"},
 {"key":"brn","zh":"公司注册号","ms":"No. Pendaftaran","en":"Business Reg No","required":true,"type":"text","example":"202301012345"},
 {"key":"sst_no","zh":"SST 号","ms":"No. SST","en":"SST No","required":false,"type":"text","example":""},
 {"key":"email","zh":"电邮","ms":"E-mel","en":"Email","required":true,"type":"email","example":"ap@abc.com"},
 {"key":"phone","zh":"电话","ms":"Telefon","en":"Phone","required":false,"type":"text","example":""},
 {"key":"address","zh":"地址","ms":"Alamat","en":"Address","required":true,"type":"text","example":""},
 {"key":"credit_days","zh":"信用天数","ms":"Hari Kredit","en":"Credit Days","required":false,"type":"int","example":"30"},
 {"key":"credit_limit","zh":"信用额度","ms":"Had Kredit","en":"Credit Limit","required":false,"type":"money","example":"5000"}
]','import.approve.customer','{B}');
