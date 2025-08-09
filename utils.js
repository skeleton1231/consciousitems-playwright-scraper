const config = require('./config');

class Utils {
  // 提取语言代码
  static extractLanguageFromUrl(url) {
    // 如果是根路径的sitemap（没有语言代码），默认为英语
    if (url.includes('https://consciousitems.com/sitemap_products_1.xml')) {
      console.log(`根路径sitemap识别为英语: ${url}`);
      return 'en';
    }
    
    const urlParts = url.split('/');
    const domainIndex = urlParts.findIndex(part => part === 'consciousitems.com');
    
    if (domainIndex !== -1 && domainIndex + 1 < urlParts.length) {
      const langPart = urlParts[domainIndex + 1];
      
      // 只处理完全匹配的简单语言代码，不进行智能提取
      // 如果包含连字符，说明是复杂locale，直接返回null
      if (langPart.includes('-')) {
        console.log(`跳过复杂locale: ${langPart} (包含连字符)`);
        return null;
      }
      
      // 检查是否完全匹配支持的语言
      return config.languages.supported.includes(langPart) ? langPart : null;
    }
    
    return null; // 如果没有找到语言代码，返回null
  }

  // 延迟函数
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 重试函数
  static async retry(fn, maxRetries = 3, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        console.log(`重试 ${i + 1}/${maxRetries}: ${error.message}`);
        await this.delay(delay * (i + 1)); // 递增延迟
      }
    }
  }

  // 清理文本
  static cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  // 提取页面数据
  static async extractPageData(page, selectors) {
    return await page.evaluate((sel) => {
      const extractValue = (selectorList) => {
        for (const selector of selectorList) {
          const element = document.querySelector(selector);
          if (element && element.textContent) {
            return element.textContent.trim();
          }
        }
        return '';
      };

      const extractImages = (selector) => {
        const images = Array.from(document.querySelectorAll(selector));
        return images.map(img => img.src).filter(src => src && src.length > 0);
      };

      const data = {};
      
      // 提取标题
      if (sel.title) {
        data.title = extractValue(sel.title);
      }
      
      // 提取价格
      if (sel.price) {
        data.price = extractValue(sel.price);
      }
      
      // 提取描述
      if (sel.description) {
        data.description = extractValue(sel.description);
      }
      
      // 提取图片
      if (sel.images) {
        data.images = extractImages(sel.images);
      }
      
      // 提取分类
      if (sel.category) {
        data.category = extractValue(sel.category);
      }
      
      // 提取SKU
      if (sel.sku) {
        data.sku = extractValue(sel.sku);
      }
      
      // 提取产品数量
      if (sel.productCount) {
        data.productCount = extractValue(sel.productCount);
      }
      
      data.url = window.location.href;
      
      return data;
    }, selectors);
  }

  // 验证URL
  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // 生成文件名
  static generateFilename(prefix, extension = 'json') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${prefix}-${timestamp}.${extension}`;
  }

  // 统计信息
  static generateStats(data) {
    const stats = {
      totalProducts: data.products.length,
      totalCollections: data.collections.length,
      languages: [...new Set([...data.products.map(p => p.language), ...data.collections.map(c => c.language)])],
      productsByLanguage: {},
      collectionsByLanguage: {}
    };

    // 按语言统计产品
    data.products.forEach(product => {
      if (!stats.productsByLanguage[product.language]) {
        stats.productsByLanguage[product.language] = 0;
      }
      stats.productsByLanguage[product.language]++;
    });

    // 按语言统计集合
    data.collections.forEach(collection => {
      if (!stats.collectionsByLanguage[collection.language]) {
        stats.collectionsByLanguage[collection.language] = 0;
      }
      stats.collectionsByLanguage[collection.language]++;
    });

    return stats;
  }

  // 打印统计信息
  static printStats(stats) {
    console.log('\n=== 抓取统计 ===');
    console.log(`总产品数: ${stats.totalProducts}`);
    console.log(`总集合数: ${stats.totalCollections}`);
    console.log(`支持的语言: ${stats.languages.join(', ')}`);
    
    console.log('\n按语言统计产品:');
    Object.entries(stats.productsByLanguage).forEach(([lang, count]) => {
      console.log(`  ${lang}: ${count} 个产品`);
    });
    
    console.log('\n按语言统计集合:');
    Object.entries(stats.collectionsByLanguage).forEach(([lang, count]) => {
      console.log(`  ${lang}: ${count} 个集合`);
    });
    console.log('================\n');
  }
}

module.exports = Utils; 