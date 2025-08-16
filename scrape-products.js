require('dotenv').config();
const { chromium } = require('playwright');
const xml2js = require('xml2js');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const Utils = require('./utils');

class ProductScraper {
  constructor(locale = null) {
    this.data = {
      products: [],
      totalProducts: 0,
      languages: []
    };
    this.browser = null;
    this.context = null;
    this.locale = locale; // 新增locale参数
    // 批量入库缓冲
    this.batchBuffer = [];
    this.BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
    this.MAX_PRODUCTS = parseInt(process.env.MAX_PRODUCTS || '250', 10);
    this.ROTATE_PAGE_EVERY = parseInt(process.env.ROTATE_PAGE_EVERY || '20', 10);
    this.DELAY_MIN_MS = parseInt(process.env.DELAY_MIN_MS || '200', 10);
    this.DELAY_MAX_MS = parseInt(process.env.DELAY_MAX_MS || '300', 10);

    // Supabase
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.supabase = (this.supabaseUrl && this.supabaseKey)
      ? createClient(this.supabaseUrl, this.supabaseKey)
      : null;
  }

  // 将抓取的产品数据转换为数据库结构（价格单位：分）
  transformForDb(product, locale = 'en') {
    const priceCents = (() => {
      if (Array.isArray(product.variants) && product.variants.length > 0) {
        const preferred = product.variants.find(v => v && v.available) || product.variants[0];
        if (!preferred) return 0;
        if (typeof preferred.price === 'number' && Number.isFinite(preferred.price)) return Math.round(preferred.price);
        if (typeof preferred.price === 'string') return this.extractPrice(preferred.price);
      }
      return this.extractPrice(product.price);
    })();

    let availability = false;
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      availability = product.variants.some(v => Boolean(v && v.available));
    } else if (typeof product.availability === 'boolean') {
      availability = product.availability;
    } else if (typeof product.availability === 'string') {
      const t = product.availability.toLowerCase();
      availability = !(t.includes('out of stock') || t.includes('unavailable') || t.includes('sold out') || t === 'false');
    }

    return {
      slug: product.id,
      name: product.title,
      description: this.cleanHtml(product.description),
      category: 'Jewelry',
      price: priceCents,
      currency: 'USD',
      image_url: (product.images && product.images[0] && product.images[0].url) ? (product.images[0].url.startsWith('//') ? `https:${product.images[0].url}` : product.images[0].url) : null,
      affiliate_url: product.url,
      locale: locale,
      features: product.features,
      dimensions: product.dimensions,
      rating: product.rating ? parseFloat(product.rating) : null,
      review_count: product.reviewCount || null,
      availability: availability,
      clean_description: this.cleanHtml(product.description),
      clean_features: product.features ? this.cleanHtml(product.features) : null
    };
  }

  extractPrice(priceString) {
    if (!priceString) return 0;
    const cleanPrice = priceString.replace(/[$,]/g, '');
    const price = parseFloat(cleanPrice);
    return Math.round(price * 100);
  }

  cleanHtml(text) {
    if (!text) return '';
    return text
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  async flushBatch() {
    if (!this.supabase || this.batchBuffer.length === 0) return;
    const rows = this.batchBuffer.splice(0, this.batchBuffer.length);
    try {
      const { error } = await this.supabase
        .from('all_products')
        .upsert(rows, { onConflict: 'slug' });
      if (error) console.error('批量写入失败:', error);
      else console.log(`✅ 批量写入 ${rows.length} 条`);
    } catch (e) {
      console.error('批量写入异常:', e);
    }
  }

  // 初始化浏览器
  async initBrowser() {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-breakpad',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--metrics-recording-only',
        '--mute-audio',
        '--blink-settings=imagesEnabled=false',
        '--js-flags=--max-old-space-size=256'
      ]
    });
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    await this.context.route('**/*', (route) => {
      const type = route.request().resourceType();
      const url = route.request().url();
      if (['image','media','font'].includes(type)) return route.abort();
      if (/googletagmanager|google-analytics|gtag|doubleclick|facebook|hotjar|segment|optimizely|clarity/.test(url)) return route.abort();
      route.continue();
    });
    this.context.setDefaultNavigationTimeout(60000);
    this.context.setDefaultTimeout(25000);
  }

  // 关闭浏览器
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  // 解析sitemap XML
  async parseSitemapXml(xmlContent) {
    try {
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlContent);
      return result;
    } catch (error) {
      console.error('解析XML失败:', error);
      throw error;
    }
  }

  // 获取主sitemap
  async getMainSitemap() {
    try {
      console.log('正在获取主sitemap...');
      const response = await axios.get(config.sitemapUrl);
      const sitemapData = await this.parseSitemapXml(response.data);
      
      const sitemaps = sitemapData.sitemapindex.sitemap;
      console.log(`找到 ${sitemaps.length} 个sitemap`);
      
      return sitemaps;
    } catch (error) {
      console.error('获取主sitemap失败:', error);
      throw error;
    }
  }

  // 过滤产品sitemap
  filterProductSitemaps(sitemaps) {
    return sitemaps.filter(sitemap => {
      const url = sitemap.loc[0];
      // 检查是否包含产品sitemap
      if (!url.includes('sitemap_products_1.xml')) {
        return false;
      }
      
      // 检查语言是否在配置的支持语言中
      const language = Utils.extractLanguageFromUrl(url);
      
      // 如果指定了locale，只处理该locale
      if (this.locale) {
        return language === this.locale && config.languages.supported.includes(language);
      }
      
      // 否则按照原有逻辑处理所有支持的语言
      return config.languages.supported.includes(language);
    });
  }

  // 抓取产品数据
  async scrapeProducts(productSitemaps) {
    console.log('开始抓取产品数据...');
    let page = await this.context.newPage();

    for (const sitemap of productSitemaps) {
      const url = sitemap.loc[0];
      const language = Utils.extractLanguageFromUrl(url);
      
      // 额外检查：如果获取到的locale不在支持列表中，就跳过
      if (!language || !config.languages.supported.includes(language)) {
        console.log(`\n跳过不支持的语言sitemap: ${url} (语言: ${language || 'null'})`);
        continue;
      }
      
      console.log(`\n处理产品sitemap: ${url} (语言: ${language})`);
      
      try {
        // 获取sitemap内容
        const response = await axios.get(url);
        const sitemapData = await this.parseSitemapXml(response.data);
        
        if (sitemapData.urlset && sitemapData.urlset.url) {
          const allUrls = sitemapData.urlset.url;
          
          // 过滤出真正的产品URL
          const products = allUrls.filter(item => {
            const url = item.loc[0];
            return url.includes('/products/') && url !== 'https://consciousitems.com/';
          });
          
          console.log(`找到 ${allUrls.length} 个URL，其中 ${products.length} 个是产品URL`);
          const slice = products.slice(0, this.MAX_PRODUCTS);
          
          for (let i = 0; i < slice.length; i++) {
            const product = slice[i];
            const productUrl = product.loc[0];
            const lastmod = product.lastmod ? product.lastmod[0] : null;
            
            console.log(`\n处理产品 ${i + 1}/${products.length}: ${productUrl}`);
            
            try {
              // 提取产品图片信息
              const images = this.extractImagesFromSitemap(product);
              
              // 抓取产品详情
              const productData = await this.scrapeProductDetails(page, productUrl, language, images);
              
              if (productData) {
                // 直接入库（批量）
                try {
                  const row = this.transformForDb(productData, language);
                  this.batchBuffer.push(row);
                  this.data.totalProducts++;
                  if (this.batchBuffer.length >= this.BATCH_SIZE) {
                    await this.flushBatch();
                  }
                  console.log(`✅ 待写入: ${productData.title}`);
                } catch (error) {
                  console.error(`❌ 入库准备失败: ${productData.title}`, error.message);
                }
                
                // 添加随机延迟避免被检测
                const range = Math.max(0, this.DELAY_MAX_MS - this.DELAY_MIN_MS + 1);
                const randomDelay = Math.floor(Math.random() * range) + this.DELAY_MIN_MS;
                console.log(`等待 ${randomDelay}ms 后继续下一个产品...`);
                await Utils.delay(randomDelay);
              }
              
            } catch (error) {
              console.error(`❌ 抓取产品失败 ${productUrl}:`, error.message);
              // 记录失败的URL到日志
              console.error(`失败的产品URL: ${productUrl}`);
            }

            if ((i + 1) % this.ROTATE_PAGE_EVERY === 0) {
              try { await page.close(); } catch (_) {}
              page = await this.context.newPage();
            }
          }
        }
        
        // 记录语言信息
        if (!this.data.languages.includes(language)) {
          this.data.languages.push(language);
        }
        
      } catch (error) {
        console.error(`处理产品sitemap失败 ${url}:`, error.message);
      }
    }
    
    await this.flushBatch();
    await page.close();
  }

  // 从sitemap中提取图片信息
  extractImagesFromSitemap(product) {
    const images = [];
    
    if (product['image:image']) {
      const imageElements = Array.isArray(product['image:image']) 
        ? product['image:image'] 
        : [product['image:image']];
      
      for (const image of imageElements) {
        if (image['image:loc'] && image['image:title']) {
          images.push({
            url: image['image:loc'][0],
            title: image['image:title'][0],
            caption: image['image:caption'] ? image['image:caption'][0] : ''
          });
        }
      }
    }
    
    return images;
  }

  // 抓取产品详情
  async scrapeProductDetails(page, productUrl, language, sitemapImages) {
    try {
      console.log(`正在访问产品页面: ${productUrl}`);
      
      await page.goto(productUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });

      // 等待页面基本元素加载
      await page.waitForSelector('h1, .product__title, .product-title', { timeout: 30000 });
      
      // 额外等待页面完全加载
      await page.waitForTimeout(2000);
      
      // 提取产品信息
      const productData = {
        id: this.generateSlug(productUrl), // 添加产品ID
        url: productUrl,
        language: language,
        lastmod: null,
        title: '',
        price: '',
        originalPrice: '',
        description: '',
        features: '',
        dimensions: '',
        materials: '',
        images: [],
        variants: [],
        sku: '',
        category: '',
        rating: null,
        reviewCount: 0,
        availability: null,
        scrapedAt: new Date().toISOString()
      };

      // 提取标题
      productData.title = await this.extractTitle(page);
      
      // 提取价格信息
      const priceInfo = await this.extractPriceInfo(page);
      productData.price = priceInfo.price;
      productData.originalPrice = priceInfo.originalPrice;
      
      // 提取产品特性
      productData.features = await this.extractFeatures(page);
      
      // 提取产品描述
      productData.description = await this.extractDescription(page);
      
      // 提取尺寸和材料信息
      const specs = await this.extractSpecifications(page);
      productData.dimensions = specs.dimensions;
      productData.materials = specs.materials;
      
      // 提取变体信息
      productData.variants = await this.extractVariants(page);
      
      // 如果有变体，更新价格逻辑
      if (productData.variants && productData.variants.length > 0) {
        console.log(`产品有 ${productData.variants.length} 个变体`);
        
        // 找到第一个可用的变体
        const firstAvailableVariant = productData.variants.find(variant => variant.available);
        
        if (firstAvailableVariant) {
          // 使用第一个可用变体的价格
          const variantPrice = firstAvailableVariant.price / 100; // 转换为美元
          productData.price = `$${variantPrice.toFixed(2)}`;
          console.log(`使用变体价格: ${productData.price} (变体: ${firstAvailableVariant.value})`);
        } else {
          // 如果没有可用的变体，使用第一个变体的价格
          const firstVariant = productData.variants[0];
          const variantPrice = firstVariant.price / 100; // 转换为美元
          productData.price = `$${variantPrice.toFixed(2)}`;
          console.log(`使用第一个变体价格: ${productData.price} (变体: ${firstVariant.value})`);
        }
      } else {
        console.log('产品没有变体，使用原始价格');
      }
      
      // 提取图片
      productData.images = await this.extractImages(page, sitemapImages);
      
      // 提取SKU
      productData.sku = await this.extractSku(page);
      
      // 提取分类
      productData.category = await this.extractCategory(page);
      
      // 提取评分和评论数
      const ratingInfo = await this.extractRatingInfo(page);
      productData.rating = ratingInfo.rating;
      productData.reviewCount = ratingInfo.reviewCount;
      
      // 根据变体情况确定库存状态
      if (productData.variants && productData.variants.length > 0) {
        // 如果有变体，检查是否有任何变体可用
        const hasAvailableVariant = productData.variants.some(variant => variant.available);
        productData.availability = hasAvailableVariant;
        console.log(`基于变体判断库存状态: ${productData.availability} (${productData.variants.filter(v => v.available).length}/${productData.variants.length} 个变体可用)`);
      } else {
        // 如果没有变体，使用页面检测的库存状态
        productData.availability = await this.extractAvailability(page);
        console.log(`基于页面检测库存状态: ${productData.availability}`);
      }
      
      console.log(`成功抓取产品: ${productData.title}`);
      return productData;
      
    } catch (error) {
      console.error(`❌ 抓取产品详情失败: ${error.message}`);
      console.error(`失败的URL: ${productUrl}`);
      return null;
    }
  }

  // 提取产品标题
  async extractTitle(page) {
    try {
      const titleSelectors = [
        'h1',
        '.product-title',
        '[data-product-title]',
        'title',
        '.product__title'
      ];
      
      for (const selector of titleSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim()) {
            return text.trim();
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取标题失败:', error.message);
      return '';
    }
  }

  // 提取价格信息
  async extractPriceInfo(page) {
    try {
      const priceInfo = {
        price: '',
        originalPrice: ''
      };
      
      // 提取当前价格 - 更精确的选择器
      const priceSelectors = [
        '.price__sale .price__current',
        '.price__regular .price__current',
        '.price__current',
        '.price',
        '[data-price]',
        '.product-price'
      ];
      
      for (const selector of priceSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.trim() && text.includes('$')) {
            // 提取价格数字
            const priceMatch = text.match(/\$(\d+\.?\d*)/);
            if (priceMatch) {
              priceInfo.price = `$${priceMatch[1]}`;
              break;
            }
          }
        }
        if (priceInfo.price) break;
      }
      
      // 提取原价
      const originalPriceSelectors = [
        '.price__compare',
        '.price__regular .price__compare',
        '.price__sale .price__compare'
      ];
      
      for (const selector of originalPriceSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.trim() && text.includes('$')) {
            // 提取价格数字
            const priceMatch = text.match(/\$(\d+\.?\d*)/);
            if (priceMatch) {
              priceInfo.originalPrice = `$${priceMatch[1]}`;
              break;
            }
          }
        }
        if (priceInfo.originalPrice) break;
      }
      
      return priceInfo;
    } catch (error) {
      console.error('提取价格失败:', error.message);
      return { price: '', originalPrice: '' };
    }
  }

  // 直接返回HTML内容，保持原始结构
  getHtmlContent(html) {
    return html.trim();
  }

  // 提取产品特性
  async extractFeatures(page) {
    try {
      const featureSelectors = [
        '.product__text',
        '.product-features',
        '.features',
        '[data-features]'
      ];
      
      for (const selector of featureSelectors) {
        const element = await page.$(selector);
        if (element) {
          const html = await element.innerHTML();
          if (html && html.trim()) {
            return this.getHtmlContent(html);
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取产品特性失败:', error.message);
      return '';
    }
  }

  // 提取产品描述
  async extractDescription(page) {
    try {
      const descriptionSelectors = [
        '.accordion__content.rte',
        '.product-description',
        '.description',
        '.product__description',
        '[data-description]'
      ];
      
      for (const selector of descriptionSelectors) {
        const element = await page.$(selector);
        if (element) {
          const html = await element.innerHTML();
          if (html && html.trim()) {
            return this.getHtmlContent(html);
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取产品描述失败:', error.message);
      return '';
    }
  }

  // 提取规格信息（尺寸和材料）
  async extractSpecifications(page) {
    try {
      const specs = {
        dimensions: '',
        materials: ''
      };
      
      // 查找包含"Size & Materials"的accordion
      const accordionSelectors = [
        '.accordion__content',
        '.product-specifications',
        '.specifications'
      ];
      
      for (const selector of accordionSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const html = await element.innerHTML();
          if (html && html.includes('DIMENSIONS') && html.includes('MATERIALS')) {
            // 直接保存HTML内容
            specs.dimensions = html;
            specs.materials = html;
            break;
          }
        }
      }
      
      return specs;
    } catch (error) {
      console.error('提取规格信息失败:', error.message);
      return { dimensions: '', materials: '' };
    }
  }

  // 提取变体信息
  async extractVariants(page) {
    try {
      const variants = [];
      
      // 首先尝试从JSON数据中提取完整的变体信息
      try {
        const jsonScripts = await page.$$('script[type="application/json"]');
        for (const script of jsonScripts) {
          const jsonText = await script.textContent();
          if (jsonText) {
            try {
              const jsonData = JSON.parse(jsonText);
              if (Array.isArray(jsonData) && jsonData.length > 0) {
                // 检查是否是变体数据（包含id, title, price等字段）
                const firstItem = jsonData[0];
                if (firstItem.id && firstItem.title && typeof firstItem.price === 'number') {
                  console.log(`从JSON数据中提取到 ${jsonData.length} 个变体`);
                  
                  for (const variant of jsonData) {
                    variants.push({
                      id: variant.id?.toString() || '',
                      value: variant.title || variant.option1 || '',
                      price: variant.price || 0,
                      available: variant.available || false,
                      sku: variant.sku || '',
                      inventory_quantity: variant.inventory_quantity || 0
                    });
                  }
                  
                  return variants;
                }
              }
            } catch (parseError) {
              // 忽略JSON解析错误，继续处理其他脚本
              continue;
            }
          }
        }
      } catch (error) {
        console.error('从JSON提取变体数据失败:', error.message);
      }
      
      // 备用方案：从HTML元素中提取变体信息
      const variantSelectors = [
        'variant-radios input[type="radio"]',
        '.variant-input-wrapper input',
        '[data-option-value]'
      ];
      
      for (const selector of variantSelectors) {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          console.log(`从HTML元素中提取到 ${elements.length} 个变体`);
          
          for (const element of elements) {
            const value = await element.getAttribute('value');
            const id = await element.getAttribute('id');
            const disabled = await element.getAttribute('disabled');
            
            if (value) {
              variants.push({
                id: id || '',
                value: value,
                price: 0, // 初始化为数字0
                available: disabled !== 'disabled'
              });
            }
          }
          break;
        }
      }
      
      // 如果从HTML提取了变体，尝试从JSON中补充价格信息
      if (variants.length > 0) {
        try {
          const jsonScripts = await page.$$('script[type="application/json"]');
          for (const script of jsonScripts) {
            const jsonText = await script.textContent();
            if (jsonText) {
              try {
                const jsonData = JSON.parse(jsonText);
                if (Array.isArray(jsonData)) {
                  // 匹配变体数据
                  for (let i = 0; i < Math.min(variants.length, jsonData.length); i++) {
                    const variant = jsonData[i];
                    if (variant.price && typeof variant.price === 'number') {
                      variants[i].price = variant.price;
                    }
                    if (typeof variant.available === 'boolean') {
                      variants[i].available = variant.available;
                    }
                  }
                }
              } catch (parseError) {
                // 忽略JSON解析错误，继续处理其他脚本
                continue;
              }
            }
          }
        } catch (error) {
          console.error('补充变体价格信息失败:', error.message);
        }
      }
      
      return variants;
    } catch (error) {
      console.error('提取变体信息失败:', error.message);
      return [];
    }
  }

  // 提取图片
  async extractImages(page, sitemapImages) {
    try {
      const images = [];
      
      // 优先使用sitemap中的图片信息
      if (sitemapImages && sitemapImages.length > 0) {
        images.push(...sitemapImages);
      }
      
      // 从页面中提取图片
      const imageSelectors = [
        '.product__media img',
        '.product-gallery img',
        '.product-images img',
        'img[data-product-image]'
      ];
      
      for (const selector of imageSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const src = await element.getAttribute('src');
          const alt = await element.getAttribute('alt');
          const title = await element.getAttribute('title');
          
          if (src && !images.some(img => img.url === src)) {
            images.push({
              url: src,
              title: title || alt || '',
              caption: alt || ''
            });
          }
        }
      }
      
      return images;
    } catch (error) {
      console.error('提取图片失败:', error.message);
      return sitemapImages || [];
    }
  }

  // 提取SKU
  async extractSku(page) {
    try {
      const skuSelectors = [
        '.product-sku',
        '[data-sku]',
        '.variant-sku',
        '.sku'
      ];
      
      for (const selector of skuSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim()) {
            return text.trim();
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取SKU失败:', error.message);
      return '';
    }
  }

  // 提取分类
  async extractCategory(page) {
    try {
      const categorySelectors = [
        '.breadcrumb',
        '.product-category',
        '[data-category]',
        '.category'
      ];
      
      for (const selector of categorySelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim()) {
            return text.trim();
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取分类失败:', error.message);
      return '';
    }
  }

  // 提取评分信息
  async extractRatingInfo(page) {
    try {
      const ratingInfo = {
        rating: null,
        reviewCount: 0
      };
      
      // 方法1: 从Okendo JSON数据中提取（最稳定）
      try {
        const jsonScripts = await page.$$('script[type="application/json"][data-oke-metafield-data]');
        for (const script of jsonScripts) {
          const jsonText = await script.textContent();
          if (jsonText) {
            try {
              const jsonData = JSON.parse(jsonText);
              if (jsonData.averageRating) {
                ratingInfo.rating = parseFloat(jsonData.averageRating);
              }
              if (jsonData.reviewCount) {
                ratingInfo.reviewCount = parseInt(jsonData.reviewCount);
              }
              // 如果找到了数据，直接返回
              if (ratingInfo.rating || ratingInfo.reviewCount) {
                console.log(`从Okendo JSON提取: 评分=${ratingInfo.rating}, 评论数=${ratingInfo.reviewCount}`);
                return ratingInfo;
              }
            } catch (parseError) {
              continue;
            }
          }
        }
      } catch (error) {
        console.error('从Okendo JSON提取评分失败:', error.message);
      }
      
      // 方法2: 从Okendo评分元素中提取
      try {
        const okeRatingElement = await page.$('.oke-sr-rating');
        if (okeRatingElement) {
          const ratingText = await okeRatingElement.textContent();
          if (ratingText) {
            const ratingMatch = ratingText.trim().match(/(\d+\.?\d*)/);
            if (ratingMatch) {
              ratingInfo.rating = parseFloat(ratingMatch[1]);
            }
          }
        }
        
        const okeCountElement = await page.$('.oke-sr-count-number');
        if (okeCountElement) {
          const countText = await okeCountElement.textContent();
          if (countText) {
            const countMatch = countText.trim().match(/(\d+)/);
            if (countMatch) {
              ratingInfo.reviewCount = parseInt(countMatch[1]);
            }
          }
        }
        
        if (ratingInfo.rating || ratingInfo.reviewCount) {
          console.log(`从Okendo元素提取: 评分=${ratingInfo.rating}, 评论数=${ratingInfo.reviewCount}`);
          return ratingInfo;
        }
      } catch (error) {
        console.error('从Okendo元素提取评分失败:', error.message);
      }
      
      // 方法3: 通用评分选择器（备用方案）
      const ratingSelectors = [
        '.rating',
        '[data-rating]',
        '.product-rating',
        '.star-rating',
        '.review-rating'
      ];
      
      for (const selector of ratingSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const ratingMatch = text.match(/(\d+\.?\d*)/);
            if (ratingMatch) {
              ratingInfo.rating = parseFloat(ratingMatch[1]);
              break;
            }
          }
        }
      }
      
      // 通用评论数选择器
      const reviewSelectors = [
        '.review-count',
        '[data-review-count]',
        '.product-reviews',
        '.reviews-count',
        '.review-number'
      ];
      
      for (const selector of reviewSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const countMatch = text.match(/(\d+)/);
            if (countMatch) {
              ratingInfo.reviewCount = parseInt(countMatch[1]);
              break;
            }
          }
        }
      }
      
      if (ratingInfo.rating || ratingInfo.reviewCount) {
        console.log(`从通用选择器提取: 评分=${ratingInfo.rating}, 评论数=${ratingInfo.reviewCount}`);
      }
      
      return ratingInfo;
    } catch (error) {
      console.error('提取评分信息失败:', error.message);
      return { rating: null, reviewCount: 0 };
    }
  }

  // 提取库存状态
  async extractAvailability(page) {
    try {
      // 方法1: 检查是否有"Notify Me When Available"按钮 - 表示无库存
      const notifyButtonSelectors = [
        '.klaviyo-bis-trigger',
        'a[href="#"].klaviyo-bis-trigger',
        'a.klaviyo-bis-trigger',
        '.product-form__submit[disabled]',
        'button[disabled]'
      ];
      
      for (const selector of notifyButtonSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && (text.includes('Notify') || text.includes('notify'))) {
            console.log(`检测到无库存状态: 找到通知按钮 "${text.trim()}"`);
            return false;
          }
        }
      }
      
      // 方法2: 检查按钮是否被禁用且显示"Notify me"
      const disabledNotifyButton = await page.$('button[disabled][style*="display: none"]');
      if (disabledNotifyButton) {
        const text = await disabledNotifyButton.textContent();
        if (text && text.includes('Notify')) {
          console.log(`检测到无库存状态: 找到禁用的通知按钮 "${text.trim()}"`);
          return false;
        }
      }
      
      // 方法3: 检查整个产品表单区域
      const productForm = await page.$('.product-form__buttons');
      if (productForm) {
        const formHtml = await productForm.innerHTML();
        if (formHtml.includes('klaviyo-bis-trigger') && formHtml.includes('Notify')) {
          console.log('检测到无库存状态: 在产品表单中找到通知按钮');
          return false;
        }
      }
      
      // 方法4: 检查是否有"Add to Cart"按钮 - 表示有库存
      const addToCartSelectors = [
        'button[name="add"]:not([disabled])',
        '.product-form__submit:not([disabled])',
        'button[type="submit"]:not([disabled])',
        '.add-to-cart:not([disabled])'
      ];
      
      for (const selector of addToCartSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && (text.includes('Add') || text.includes('add'))) {
            console.log(`检测到有库存状态: 找到添加购物车按钮 "${text.trim()}"`);
            return true;
          }
        }
      }
      
      // 方法5: 检查是否有可用的提交按钮
      const enabledSubmitButton = await page.$('button[type="submit"]:not([disabled])');
      if (enabledSubmitButton) {
        const text = await enabledSubmitButton.textContent();
        if (text && text.trim()) {
          console.log(`检测到有库存状态: 找到可用的提交按钮 "${text.trim()}"`);
          return true;
        }
      }
      
      // 方法6: 通用库存状态选择器（备用方案）
      const availabilitySelectors = [
        '.product-availability',
        '[data-availability]',
        '.availability',
        '.stock-status',
        '.inventory-status'
      ];
      
      for (const selector of availabilitySelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim()) {
            const lowerText = text.trim().toLowerCase();
            if (lowerText.includes('out of stock') || lowerText.includes('unavailable') || lowerText.includes('sold out')) {
              console.log(`从通用选择器检测到无库存状态: "${text.trim()}"`);
              return false;
            } else if (lowerText.includes('in stock') || lowerText.includes('available')) {
              console.log(`从通用选择器检测到有库存状态: "${text.trim()}"`);
              return true;
            }
          }
        }
      }
      
      // 默认状态：如果无法确定，返回true（有库存）
      console.log('无法确定库存状态，默认为有库存');
      return true;
    } catch (error) {
      console.error('提取库存状态失败:', error.message);
      return null;
    }
  }

  // 分析语言
  analyzeLanguages() {
    const languageStats = {};
    
    this.data.products.forEach(product => {
      const lang = product.language;
      if (!languageStats[lang]) {
        languageStats[lang] = 0;
      }
      languageStats[lang]++;
    });
    
    return languageStats;
  }

  // 生成统计信息
  generateStats() {
    const stats = {
      totalProducts: this.data.totalProducts,
      languages: this.data.languages,
      languageStats: this.analyzeLanguages(),
      averagePrice: 0,
      priceRange: { min: 0, max: 0 },
      categories: {},
      ratingStats: { average: 0, totalReviews: 0 }
    };
    
    // 计算价格统计
    const prices = this.data.products
      .map(p => parseFloat(p.price.replace(/[^\d.]/g, '')))
      .filter(p => !isNaN(p));
    
    if (prices.length > 0) {
      stats.averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      stats.priceRange.min = Math.min(...prices);
      stats.priceRange.max = Math.max(...prices);
    }
    
    // 计算分类统计
    this.data.products.forEach(product => {
      const category = product.category || 'Unknown';
      if (!stats.categories[category]) {
        stats.categories[category] = 0;
      }
      stats.categories[category]++;
    });
    
    // 计算评分统计
    const ratings = this.data.products
      .map(p => p.rating)
      .filter(r => r !== null);
    
    if (ratings.length > 0) {
      stats.ratingStats.average = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      stats.ratingStats.totalReviews = this.data.products
        .reduce((sum, p) => sum + (p.reviewCount || 0), 0);
    }
    
    return stats;
  }

  // 打印统计信息
  printStats(stats) {
    console.log('\n=== 产品抓取统计 ===');
    console.log(`总产品数: ${stats.totalProducts}`);
    console.log(`支持语言: ${stats.languages.join(', ')}`);
    console.log('\n语言分布:');
    Object.entries(stats.languageStats).forEach(([lang, count]) => {
      console.log(`  ${lang}: ${count} 个产品`);
    });
    
    console.log(`\n价格统计:`);
    console.log(`  平均价格: $${stats.averagePrice.toFixed(2)}`);
    console.log(`  价格范围: $${stats.priceRange.min.toFixed(2)} - $${stats.priceRange.max.toFixed(2)}`);
    
    console.log(`\n评分统计:`);
    console.log(`  平均评分: ${stats.ratingStats.average.toFixed(1)}/5`);
    console.log(`  总评论数: ${stats.ratingStats.totalReviews}`);
    
    console.log(`\n分类分布:`);
    Object.entries(stats.categories)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([category, count]) => {
        console.log(`  ${category}: ${count} 个产品`);
      });
  }

  // 清理和验证产品数据，确保JSON兼容
  sanitizeProductData(productData) {
    const sanitized = { ...productData };
    
    // 确保所有字符串字段都是有效的UTF-8字符串
    const stringFields = ['id', 'title', 'price', 'originalPrice', 'sku', 'category'];
    stringFields.forEach(field => {
      if (sanitized[field] && typeof sanitized[field] === 'string') {
        // 移除控制字符和无效字符
        sanitized[field] = sanitized[field]
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // 移除控制字符
          .replace(/\uFFFD/g, '') // 移除替换字符
          .trim();
      } else if (sanitized[field] === null || sanitized[field] === undefined) {
        sanitized[field] = '';
      }
    });
    
    // 确保availability字段是有效的布尔值
    if (sanitized.availability !== null && sanitized.availability !== undefined) {
      if (typeof sanitized.availability === 'boolean') {
        // 已经是布尔值，保持不变
      } else if (typeof sanitized.availability === 'string') {
        // 如果是字符串，转换为布尔值
        const lowerText = sanitized.availability.toLowerCase();
        if (lowerText.includes('out of stock') || lowerText.includes('unavailable') || lowerText.includes('sold out') || lowerText === 'false') {
          sanitized.availability = false;
        } else if (lowerText.includes('in stock') || lowerText.includes('available') || lowerText === 'true') {
          sanitized.availability = true;
        } else {
          sanitized.availability = true; // 默认值
        }
      } else {
        sanitized.availability = true; // 默认值
      }
    } else {
      sanitized.availability = true; // 默认值
    }
    
    // 保持HTML格式的字段（description, features, dimensions, materials）
    const htmlFields = ['description', 'features', 'dimensions', 'materials'];
    htmlFields.forEach(field => {
      if (sanitized[field] && typeof sanitized[field] === 'string') {
        // 只移除控制字符，但保留换行符和回车符
        sanitized[field] = sanitized[field]
          .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '') // 移除控制字符，但保留\n(10)和\r(13)
          .replace(/\uFFFD/g, '') // 移除替换字符
          .trim();
      } else if (sanitized[field] === null || sanitized[field] === undefined) {
        sanitized[field] = '';
      }
    });
    
    // 确保数字字段是有效的数字
    if (sanitized.rating !== null && sanitized.rating !== undefined) {
      if (isNaN(sanitized.rating) || sanitized.rating < 0 || sanitized.rating > 5) {
        sanitized.rating = null;
      }
    }
    
    if (sanitized.reviewCount !== null && sanitized.reviewCount !== undefined) {
      if (isNaN(sanitized.reviewCount) || sanitized.reviewCount < 0) {
        sanitized.reviewCount = 0;
      }
    }
    
    // 确保数组字段是有效的数组
    if (!Array.isArray(sanitized.images)) {
      sanitized.images = [];
    }
    
    if (!Array.isArray(sanitized.variants)) {
      sanitized.variants = [];
    }
    
    // 清理图片数据
    sanitized.images = sanitized.images.map(img => ({
      url: (img.url || '').toString(),
      title: (img.title || '').toString(),
      caption: (img.caption || '').toString()
    }));
    
    // 清理变体数据
    sanitized.variants = sanitized.variants.map(variant => ({
      id: (variant.id || '').toString(),
      value: (variant.value || '').toString(),
      price: typeof variant.price === 'number' ? variant.price : 0, // 保持为数字
      available: Boolean(variant.available)
    }));
    
    // 确保时间戳是有效的ISO字符串
    if (sanitized.scrapedAt) {
      try {
        new Date(sanitized.scrapedAt).toISOString();
      } catch (error) {
        sanitized.scrapedAt = new Date().toISOString();
      }
    } else {
      sanitized.scrapedAt = new Date().toISOString();
    }
    
    return sanitized;
  }

  // 从URL生成slug
  generateSlug(url) {
    try {
      // 从产品URL中提取slug
      const match = url.match(/\/products\/([^\/\?]+)/);
      if (match) {
        return match[1];
      }
      
      // 如果没有匹配到，使用URL的hash
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part);
      return pathParts[pathParts.length - 1] || 'unknown';
    } catch (error) {
      console.error('生成slug失败:', error);
      return 'unknown';
    }
  }

  // 保存单个产品数据
  async saveProductData(productData) {
    // 已弃用：不再落盘保存
    return null;
  }

  // 保存数据（现在主要用于生成统计文件）
  async saveData() {
    // 已弃用：不再生成统计文件
    return;
  }

  // 保存统计信息
  async saveStats() {
    // 已弃用：不再生成统计文件
    return;
  }

  // 主运行方法
  async run() {
    const localeInfo = this.locale ? ` (语言: ${this.locale})` : ' (所有支持的语言)';
    console.log(`开始产品抓取任务${localeInfo}...`);
    
    try {
      // 初始化浏览器
      await this.initBrowser();
      
      // 获取主sitemap
      const sitemaps = await this.getMainSitemap();
      
      // 过滤产品sitemap
      const productSitemaps = this.filterProductSitemaps(sitemaps);
      
      if (productSitemaps.length === 0) {
        if (this.locale) {
          console.log(`未找到语言为 ${this.locale} 的产品sitemap`);
        } else {
          console.log('未找到产品sitemap');
        }
        return;
      }
      
      console.log(`找到 ${productSitemaps.length} 个产品sitemap`);
      
      // 抓取产品数据
      await this.scrapeProducts(productSitemaps);
      
      // 直接结束（不生成统计、不落盘）
      
      console.log('\n产品抓取任务完成!');
      
    } catch (error) {
      console.error('产品抓取失败:', error);
      throw error;
    } finally {
      // 关闭浏览器
      await this.closeBrowser();
    }
  }
}

// 主函数
async function main() {
  // 从命令行参数获取locale
  const args = process.argv.slice(2);
  const locale = args.length > 0 ? args[0] : null;
  
  if (locale && !config.languages.supported.includes(locale)) {
    console.error(`错误: 不支持的语言 "${locale}"`);
    console.log(`支持的语言: ${config.languages.supported.join(', ')}`);
    process.exit(1);
  }
  
  const scraper = new ProductScraper(locale);
  
  try {
    await scraper.run();
  } catch (error) {
    console.error('程序执行失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

module.exports = ProductScraper; 