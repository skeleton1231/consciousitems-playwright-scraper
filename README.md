# Conscious Items Product Scraper

一个用于抓取 Conscious Items 网站产品数据的 Playwright 爬虫工具，支持多语言产品抓取和 Supabase 数据库集成。

## 功能特性

- 支持多语言产品抓取 (en, de, fr, es, pt)
- 自动解析 sitemap XML
- 提取产品详细信息（标题、价格、描述、图片等）
- 抓取集合数据
- 生成统计报告
- 支持指定语言抓取
- Supabase 数据库集成
- 数据验证和清理

## 项目结构

```
consciousitems-playwright-scraper/
├── scrape-products.js          # 产品数据抓取脚本
├── scrape-collections.js       # 集合数据抓取脚本
├── insert-to-supabase.js       # Supabase 数据插入脚本
├── config.js                   # 配置文件
├── utils.js                    # 工具函数
├── package.json                # 项目依赖
├── README.md                   # 项目文档
├── .env                        # 环境变量 (需要创建)
├── .gitignore                  # Git 忽略文件
├── sql/                        # 数据库 SQL 文件
│   ├── database-schema.sql
│   ├── add-slug-field.sql
│   ├── modify-slug-field.sql
│   └── ...
└── data/                       # 抓取的数据
    ├── products/               # 产品数据
    ├── collections/            # 集合数据
    └── stats/                  # 统计信息
```

## 安装依赖

```bash
npm install
npx playwright install chromium
```

## 环境配置

创建 `.env` 文件并配置 Supabase 连接信息：

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 使用方法

### 1. 抓取产品数据

#### 抓取所有支持的语言
```bash
node scrape-products.js
```

#### 抓取指定语言
```bash
# 抓取英文产品
node scrape-products.js en

# 抓取德文产品
node scrape-products.js de

# 抓取法文产品
node scrape-products.js fr

# 抓取西班牙文产品
node scrape-products.js es

# 抓取葡萄牙文产品
node scrape-products.js pt
```

### 2. 抓取集合数据

```bash
node scrape-collections.js
```

### 3. 插入数据到 Supabase

#### 插入所有产品数据
```bash
node insert-to-supabase.js
```

#### 插入指定语言的产品数据
```bash
# 插入英文产品
node insert-to-supabase.js en

# 插入德文产品
node insert-to-supabase.js de
```

#### 插入特定产品文件
```bash
node insert-to-supabase.js data/products/en/product-slug.json
```

## 支持的语言

- `en` - 英文
- `de` - 德文
- `fr` - 法文
- `es` - 西班牙文
- `pt` - 葡萄牙文

## 输出文件结构

抓取的数据将保存在以下目录结构中：

```
data/
├── products/
│   ├── en/          # 英文产品数据
│   ├── de/          # 德文产品数据
│   ├── fr/          # 法文产品数据
│   ├── es/          # 西班牙文产品数据
│   └── pt/          # 葡萄牙文产品数据
├── collections/
│   ├── en/          # 英文集合数据
│   ├── de/          # 德文集合数据
│   └── ...          # 其他语言
└── stats/
    └── products_stats_[timestamp].json  # 统计信息
```

## 数据库设置

### Supabase 表结构

项目包含 SQL 文件用于设置数据库表结构，位于 `sql/` 目录：

- `database-schema.sql` - 基础表结构
- `add-slug-field.sql` - 添加 slug 字段
- `modify-slug-field.sql` - 修改 slug 字段
- `fix-table-schema.sql` - 修复表结构

### 运行数据库设置

```bash
# 在 Supabase SQL 编辑器中运行相应的 SQL 文件
```

## 配置

可以在 `config.js` 文件中修改配置：

- 支持的语言列表
- 浏览器设置
- 抓取延迟和超时设置
- 输出格式等

## 主要脚本说明

### scrape-products.js
- 从 sitemap 抓取产品数据
- 支持多语言
- 提取产品详细信息
- 保存为 JSON 文件

### scrape-collections.js
- 抓取集合数据
- 提取集合中的产品 URL
- 支持无限滚动加载

### insert-to-supabase.js
- 将抓取的产品数据插入 Supabase
- 支持数据转换和清理
- 处理重复数据
- 支持批量插入

## 数据字段说明

### 产品数据字段
- `slug`: 产品唯一标识
- `name`: 产品名称
- `description`: 产品描述
- `category`: 产品分类
- `sub_category`: 子分类
- `price`: 价格（以分为单位）
- `currency`: 货币类型
- `image_url`: 主图片 URL
- `affiliate_url`: 产品链接
- `semantic_keywords`: 语义关键词
- `locale`: 语言代码
- `features`: 产品特性
- `dimensions`: 尺寸信息
- `rating`: 评分
- `review_count`: 评论数量

## 注意事项

- 请遵守网站的 robots.txt 和使用条款
- 建议在抓取时添加适当的延迟，避免对服务器造成压力
- 抓取大量数据时请考虑服务器负载
- 确保 Supabase 环境变量正确配置
- 数据库表结构需要提前设置

## 故障排除

### 常见问题

1. **浏览器启动失败**
   - 确保已安装 Playwright: `npx playwright install chromium`

2. **Supabase 连接失败**
   - 检查环境变量是否正确设置
   - 确认 Supabase URL 和 Service Role Key 有效

3. **数据插入失败**
   - 检查数据库表结构是否正确
   - 确认字段类型匹配

## 许可证

ISC License 