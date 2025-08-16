module.exports = {
  // 基础配置
  baseUrl: 'https://consciousitems.com',
  sitemapUrl: 'https://consciousitems.com/sitemap.xml',
  
  // 浏览器配置
  browser: {
    headless: true,
    slowMo: 50, // 减少延迟到50ms，避免被检测但提高速度
    timeout: 20000 // 减少超时时间到20秒
  },
  
  // 抓取配置
  scraping: {
    maxConcurrent: 5, // 增加并发数到5
    delayBetweenRequests: 1000, // 减少请求间隔到1秒
    maxRetries: 2, // 减少重试次数到2次
    timeout: 20000, // 减少页面加载超时到20秒
    // 新增：产品间延迟配置
    productDelay: {
      min: 500, // 最小延迟500ms
      max: 1500  // 最大延迟1.5秒
    },
    // 新增：页面等待配置
    pageWait: {
      selectorTimeout: 15000, // 选择器等待超时15秒
      pageLoadDelay: 1000, // 页面加载后额外等待1秒
      waitUntil: 'domcontentloaded' // 等待策略
    }
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