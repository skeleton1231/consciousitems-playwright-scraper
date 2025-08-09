module.exports = {
  // 基础配置
  baseUrl: 'https://consciousitems.com',
  sitemapUrl: 'https://consciousitems.com/sitemap.xml',
  
  // 浏览器配置
  browser: {
    headless: true,
    slowMo: 100, // 延迟，避免被检测
    timeout: 30000
  },
  
  // 抓取配置
  scraping: {
    maxConcurrent: 3, // 最大并发数
    delayBetweenRequests: 1000, // 请求间隔(毫秒)
    maxRetries: 3, // 最大重试次数
    timeout: 30000 // 页面加载超时
  },
  
  // 语言配置
  languages: {
    // 支持的语言
    supported: ['en', 'de', 'fr', 'es', 'pt'],
    default: 'en'
  },
  
  // 输出配置
  output: {
    directory: 'output',
    format: 'json', // json, csv
    includeTimestamp: true,
    separateFiles: true // 是否分别保存产品和集合文件
  },
  
  // 选择器配置 (用于提取页面数据)
  selectors: {
    product: {
      title: ['h1', '.product-title', '[data-product-title]', 'title'],
      price: ['.price', '[data-price]', '.product-price', '.price__regular', '.price__sale'],
      description: ['.product-description', '[data-description]', '.description', '.product__description'],
      images: 'img',
      category: ['.product-category', '[data-category]', '.breadcrumb'],
      sku: ['.product-sku', '[data-sku]', '.variant-sku']
    },
    collection: {
      title: ['h1', '.collection-title', '[data-collection-title]', 'title'],
      description: ['.collection-description', '[data-description]', '.description'],
      productCount: ['.product-count', '[data-product-count]', '.collection-product-count'],
      images: 'img'
    }
  }
}; 