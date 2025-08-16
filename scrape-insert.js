require('dotenv').config();
const { chromium } = require('playwright');
const xml2js = require('xml2js');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const os = require('os');
const config = require('./config');
const Utils = require('./utils');
const LegacyProductScraper = require('./scrape-products');

// Environment / runtime knobs
const MAX_PRODUCTS = parseInt(process.env.MAX_PRODUCTS || '250', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const ROTATE_PAGE_EVERY = parseInt(process.env.ROTATE_PAGE_EVERY || '20', 10);
const MEMORY_LOG_INTERVAL_SEC = parseInt(process.env.MEMORY_LOG_INTERVAL_SEC || '0', 10);
const MAX_RETRIES_PER_PRODUCT = parseInt(process.env.MAX_RETRIES_PER_PRODUCT || '3', 10);
const DELAY_MIN_MS = parseInt(process.env.DELAY_MIN_MS || '500', 10);
const DELAY_MAX_MS = parseInt(process.env.DELAY_MAX_MS || '1200', 10);
const RECREATE_CONTEXT_AFTER_FAILS = parseInt(process.env.RECREATE_CONTEXT_AFTER_FAILS || '5', 10);

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

function formatMB(bytes) {
  if (!Number.isFinite(bytes)) return '0.0';
  return (bytes / 1024 / 1024).toFixed(1);
}

function logMemory(tag) {
  try {
    const mu = process.memoryUsage();
    const rss = formatMB(mu.rss);
    const heapUsed = formatMB(mu.heapUsed);
    const heapTotal = formatMB(mu.heapTotal);
    const external = formatMB(mu.external);
    const arrayBuffers = formatMB(mu.arrayBuffers || 0);
    const freeSys = formatMB(os.freemem());
    const totalSys = formatMB(os.totalmem());
    const time = new Date().toISOString();
    console.log(`[MEM ${time}] ${tag} rss=${rss}MB heapUsed=${heapUsed}MB heapTotal=${heapTotal}MB external=${external}MB arrayBuffers=${arrayBuffers}MB sysFree=${freeSys}MB sysTotal=${totalSys}MB`);
  } catch (_) {}
}

function extractPrice(priceString) {
  if (!priceString) return 0;
  const cleanPrice = priceString.replace(/[$,]/g, '');
  const price = parseFloat(cleanPrice);
  return Math.round(price * 100);
}

function cleanHtml(text) {
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

function getFirstImageUrl(images) {
  if (!images || images.length === 0) return null;
  return images[0].url && images[0].url.startsWith('//') ? `https:${images[0].url}` : images[0].url;
}

function transformProductData(product, locale = 'en') {
  const slug = product.id;

  // Prefer variant numeric price in cents when available; fallback to parsed display price
  let priceCents = 0;
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    const preferred = product.variants.find((v) => v && v.available) || product.variants[0];
    if (preferred) {
      if (typeof preferred.price === 'number' && Number.isFinite(preferred.price)) {
        // Shopify variant price is already in cents
        priceCents = Math.round(preferred.price);
      } else if (typeof preferred.price === 'string') {
        priceCents = extractPrice(preferred.price);
      }
    }
  }
  if (!priceCents) {
    priceCents = extractPrice(product.price);
  }

  // Determine availability: if variants exist, any available => true; else use product.availability
  let availability = false;
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    availability = product.variants.some((v) => Boolean(v && v.available));
  } else if (product.availability !== null && product.availability !== undefined) {
    if (typeof product.availability === 'boolean') {
      availability = product.availability;
    } else if (typeof product.availability === 'string') {
      const lowerText = product.availability.toLowerCase();
      availability = !(lowerText.includes('out of stock') || lowerText.includes('unavailable') || lowerText.includes('sold out') || lowerText === 'false');
    }
  }

  return {
    slug,
    name: product.title,
    description: cleanHtml(product.description),
    category: 'Jewelry',
    price: priceCents,
    currency: 'USD',
    image_url: getFirstImageUrl(product.images),
    affiliate_url: product.url,
    locale: locale,
    features: product.features,
    dimensions: product.dimensions,
    rating: product.rating ? parseFloat(product.rating) : null,
    review_count: product.reviewCount || null,
    availability: availability,
    clean_description: cleanHtml(product.description),
    clean_features: product.features ? cleanHtml(product.features) : null
  };
}

async function upsertBatch(rows) {
  if (!rows || rows.length === 0) return true;
  try {
    const { error } = await supabase
      .from('all_products')
      .upsert(rows, { onConflict: 'slug' });
    if (error) {
      console.error('Error upserting batch:', error);
      return false;
    }
    console.log(`✅ Upserted batch: ${rows.length} rows`);
    return true;
  } catch (err) {
    console.error('Exception during batch upsert:', err);
    return false;
  }
}

class ProductScraper {
  constructor(locale = null) {
    this.browser = null;
    this.context = null;
    this.locale = locale;
    this.batchBuffer = [];
    this.totalProcessed = 0;
    this.languages = new Set();
    this.legacy = new LegacyProductScraper(locale);
  }

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

    await this.setupContext();
    logMemory('after:initBrowser');
  }

  async setupContext() {
    if (this.context) {
      try { await this.context.close(); } catch (_) {}
    }
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: (this.locale && this.locale.length === 2) ? `${this.locale}-${this.locale.toUpperCase()}` : 'en-US',
    });
    try {
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
    } catch (_) {}
    await this.context.route('**/*', (route) => {
      const req = route.request();
      const type = req.resourceType();
      const url = req.url();
      if (['image', 'media', 'font'].includes(type)) return route.abort();
      if (/googletagmanager|google-analytics|gtag|doubleclick|facebook|hotjar|segment|optimizely|clarity/.test(url)) return route.abort();
      route.continue();
    });
    this.context.setDefaultNavigationTimeout(60000);
    this.context.setDefaultTimeout(25000);
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async parseSitemapXml(xmlContent) {
    const parser = new xml2js.Parser();
    return parser.parseStringPromise(xmlContent);
  }

  async getMainSitemap() {
    const response = await axios.get(config.sitemapUrl);
    const sitemapData = await this.parseSitemapXml(response.data);
    return sitemapData.sitemapindex.sitemap;
  }

  filterProductSitemaps(sitemaps) {
    return sitemaps.filter((sitemap) => {
      const url = sitemap.loc[0];
      if (!url.includes('sitemap_products_1.xml')) return false;
      const language = Utils.extractLanguageFromUrl(url);
      if (this.locale) {
        return language === this.locale && config.languages.supported.includes(language);
      }
      return config.languages.supported.includes(language);
    });
  }

  extractImagesFromSitemap(product) {
    const images = [];
    if (product['image:image']) {
      const imageElements = Array.isArray(product['image:image']) ? product['image:image'] : [product['image:image']];
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

  async scrapeProductDetails(page, productUrl, language, sitemapImages) {
    // Delegate extraction to legacy scraper's battle-tested method, with retries
    const maxAttempts = Math.max(1, Math.min(5, MAX_RETRIES_PER_PRODUCT));
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const data = await this.legacy.scrapeProductDetails(page, productUrl, language, sitemapImages);
        if (data) return data;
        throw new Error('Empty product data');
      } catch (e) {
        lastError = e;
        if (attempt === maxAttempts) {
          console.error(`❌ 抓取产品详情失败(${attempt}/${maxAttempts}): ${e.message}`);
          console.error(`失败的URL: ${productUrl}`);
          return null;
        }
        const backoff = 400 * attempt + Math.floor(Math.random() * 200);
        try { await page.waitForTimeout(backoff); } catch (_) {}
      }
    }
    return null;
  }

  async extractTitle(page) {
    try {
      const titleSelectors = ['h1', '.product-title', '[data-product-title]', 'title', '.product__title'];
      for (const selector of titleSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim()) return text.trim();
        }
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  async extractPriceInfo(page) {
    try {
      const priceInfo = { price: '', originalPrice: '' };
      const priceSelectors = ['.price__sale .price__current', '.price__regular .price__current', '.price__current', '.price', '[data-price]', '.product-price'];
      for (const selector of priceSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.trim() && text.includes('$')) {
            const priceMatch = text.match(/\$(\d+\.?\d*)/);
            if (priceMatch) { priceInfo.price = `$${priceMatch[1]}`; break; }
          }
        }
        if (priceInfo.price) break;
      }
      const originalPriceSelectors = ['.price__compare', '.price__regular .price__compare', '.price__sale .price__compare'];
      for (const selector of originalPriceSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.trim() && text.includes('$')) {
            const priceMatch = text.match(/\$(\d+\.?\d*)/);
            if (priceMatch) { priceInfo.originalPrice = `$${priceMatch[1]}`; break; }
          }
        }
        if (priceInfo.originalPrice) break;
      }
      return priceInfo;
    } catch (_) {
      return { price: '', originalPrice: '' };
    }
  }

  getHtmlContent(html) { return (html || '').trim(); }

  async extractFeatures(page) {
    try {
      const selectors = ['.product__text', '.product-features', '.features', '[data-features]'];
      for (const s of selectors) {
        const el = await page.$(s);
        if (el) {
          const html = await el.innerHTML();
          if (html && html.trim()) return this.getHtmlContent(html);
        }
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  async extractDescription(page) {
    try {
      const selectors = ['.accordion__content.rte', '.product-description', '.description', '.product__description', '[data-description]'];
      for (const s of selectors) {
        const el = await page.$(s);
        if (el) {
          const html = await el.innerHTML();
          if (html && html.trim()) return this.getHtmlContent(html);
        }
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  async extractSpecifications(page) {
    try {
      const specs = { dimensions: '', materials: '' };
      const selectors = ['.accordion__content', '.product-specifications', '.specifications'];
      for (const s of selectors) {
        const els = await page.$$(s);
        for (const el of els) {
          const html = await el.innerHTML();
          if (html && html.includes('DIMENSIONS') && html.includes('MATERIALS')) {
            specs.dimensions = html;
            specs.materials = html;
            break;
          }
        }
      }
      return specs;
    } catch (_) {
      return { dimensions: '', materials: '' };
    }
  }

  async extractVariants(page) {
    try {
      const variants = [];
      try {
        const jsonScripts = await page.$$('script[type="application/json"]');
        for (const script of jsonScripts) {
          const jsonText = await script.textContent();
          if (jsonText) {
            try {
              const jsonData = JSON.parse(jsonText);
              if (Array.isArray(jsonData) && jsonData.length > 0) {
                const firstItem = jsonData[0];
                if (firstItem.id && firstItem.title && typeof firstItem.price === 'number') {
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
            } catch (_) { continue; }
          }
        }
      } catch (_) {}

      const variantSelectors = ['variant-radios input[type="radio"]', '.variant-input-wrapper input', '[data-option-value]'];
      for (const selector of variantSelectors) {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          for (const element of elements) {
            const value = await element.getAttribute('value');
            const id = await element.getAttribute('id');
            const disabled = await element.getAttribute('disabled');
            if (value) {
              variants.push({ id: id || '', value, price: 0, available: disabled !== 'disabled' });
            }
          }
          break;
        }
      }

      if (variants.length > 0) {
        try {
          const jsonScripts = await page.$$('script[type="application/json"]');
          for (const script of jsonScripts) {
            const jsonText = await script.textContent();
            if (jsonText) {
              try {
                const jsonData = JSON.parse(jsonText);
                if (Array.isArray(jsonData)) {
                  for (let i = 0; i < Math.min(variants.length, jsonData.length); i++) {
                    const variant = jsonData[i];
                    if (variant.price && typeof variant.price === 'number') variants[i].price = variant.price;
                    if (typeof variant.available === 'boolean') variants[i].available = variant.available;
                  }
                }
              } catch (_) { continue; }
            }
          }
        } catch (_) {}
      }
      return variants;
    } catch (_) {
      return [];
    }
  }

  async extractImages(page, sitemapImages) {
    try {
      const images = [];
      if (sitemapImages && sitemapImages.length > 0) images.push(...sitemapImages);
      const imageSelectors = ['.product__media img', '.product-gallery img', '.product-images img', 'img[data-product-image]'];
      for (const selector of imageSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const src = await element.getAttribute('src');
          const alt = await element.getAttribute('alt');
          const title = await element.getAttribute('title');
          if (src && !images.some((img) => img.url === src)) {
            images.push({ url: src, title: title || alt || '', caption: alt || '' });
          }
        }
      }
      return images;
    } catch (_) {
      return sitemapImages || [];
    }
  }

  async extractSku(page) {
    try {
      const selectors = ['.product-sku', '[data-sku]', '.variant-sku', '.sku'];
      for (const selector of selectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim()) return text.trim();
        }
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  async extractCategory(page) {
    try {
      const selectors = ['.breadcrumb', '.product-category', '[data-category]', '.category'];
      for (const selector of selectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim()) return text.trim();
        }
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  async extractRatingInfo(page) {
    try {
      const ratingInfo = { rating: null, reviewCount: 0 };
      try {
        const jsonScripts = await page.$$('script[type="application/json"][data-oke-metafield-data]');
        for (const script of jsonScripts) {
          const jsonText = await script.textContent();
          if (jsonText) {
            try {
              const jsonData = JSON.parse(jsonText);
              if (jsonData.averageRating) ratingInfo.rating = parseFloat(jsonData.averageRating);
              if (jsonData.reviewCount) ratingInfo.reviewCount = parseInt(jsonData.reviewCount);
              if (ratingInfo.rating || ratingInfo.reviewCount) return ratingInfo;
            } catch (_) { continue; }
          }
        }
      } catch (_) {}

      try {
        const okeRatingElement = await page.$('.oke-sr-rating');
        if (okeRatingElement) {
          const ratingText = await okeRatingElement.textContent();
          if (ratingText) {
            const ratingMatch = ratingText.trim().match(/(\d+\.?\d*)/);
            if (ratingMatch) ratingInfo.rating = parseFloat(ratingMatch[1]);
          }
        }
        const okeCountElement = await page.$('.oke-sr-count-number');
        if (okeCountElement) {
          const countText = await okeCountElement.textContent();
          if (countText) {
            const countMatch = countText.trim().match(/(\d+)/);
            if (countMatch) ratingInfo.reviewCount = parseInt(countMatch[1]);
          }
        }
        if (ratingInfo.rating || ratingInfo.reviewCount) return ratingInfo;
      } catch (_) {}

      const ratingSelectors = ['.rating', '[data-rating]', '.product-rating', '.star-rating', '.review-rating'];
      for (const selector of ratingSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const ratingMatch = text.match(/(\d+\.?\d*)/);
            if (ratingMatch) { ratingInfo.rating = parseFloat(ratingMatch[1]); break; }
          }
        }
      }
      const reviewSelectors = ['.review-count', '[data-review-count]', '.product-reviews', '.reviews-count', '.review-number'];
      for (const selector of reviewSelectors) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text) {
            const countMatch = text.match(/(\d+)/);
            if (countMatch) { ratingInfo.reviewCount = parseInt(countMatch[1]); break; }
          }
        }
      }
      return ratingInfo;
    } catch (_) {
      return { rating: null, reviewCount: 0 };
    }
  }

  async extractAvailability(page) {
    try {
      const notifyButtonSelectors = ['.klaviyo-bis-trigger', 'a[href="#"].klaviyo-bis-trigger', 'a.klaviyo-bis-trigger', '.product-form__submit[disabled]', 'button[disabled]'];
      for (const s of notifyButtonSelectors) {
        const el = await page.$(s);
        if (el) {
          const text = await el.textContent();
          if (text && (text.includes('Notify') || text.includes('notify'))) return false;
        }
      }
      const disabledNotifyButton = await page.$('button[disabled][style*="display: none"]');
      if (disabledNotifyButton) {
        const text = await disabledNotifyButton.textContent();
        if (text && text.includes('Notify')) return false;
      }
      const productForm = await page.$('.product-form__buttons');
      if (productForm) {
        const formHtml = await productForm.innerHTML();
        if (formHtml.includes('klaviyo-bis-trigger') && formHtml.includes('Notify')) return false;
      }
      const addToCartSelectors = ['button[name="add"]:not([disabled])', '.product-form__submit:not([disabled])', 'button[type="submit"]:not([disabled])', '.add-to-cart:not([disabled])'];
      for (const s of addToCartSelectors) {
        const el = await page.$(s);
        if (el) return true;
      }
      const enabledSubmitButton = await page.$('button[type="submit"]:not([disabled])');
      if (enabledSubmitButton) return true;
      const availabilitySelectors = ['.product-availability', '[data-availability]', '.availability', '.stock-status', '.inventory-status'];
      for (const s of availabilitySelectors) {
        const el = await page.$(s);
        if (el) {
          const text = await el.textContent();
          if (text && text.trim()) {
            const lowerText = text.trim().toLowerCase();
            if (lowerText.includes('out of stock') || lowerText.includes('unavailable') || lowerText.includes('sold out')) return false;
            if (lowerText.includes('in stock') || lowerText.includes('available')) return true;
          }
        }
      }
      return true;
    } catch (_) {
      return null;
    }
  }

  analyzeLanguages() {
    const stats = {};
    for (const lang of this.languages.values()) {
      stats[lang] = (stats[lang] || 0) + 1;
    }
    return stats;
  }

  generateSlug(url) {
    try {
      const match = url.match(/\/products\/([^\/\?]+)/);
      if (match) return match[1];
      const urlObj = new URL(url);
      const parts = urlObj.pathname.split('/').filter((p) => p);
      return parts[parts.length - 1] || 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  async flushBatch(locale) {
    if (this.batchBuffer.length === 0) return;
    const rows = this.batchBuffer.splice(0, this.batchBuffer.length);
    await upsertBatch(rows);
    logMemory(`after:upsert:batch:${rows.length}`);
  }

  async scrapeProducts(productSitemaps) {
    console.log('开始抓取产品数据...');

    for (const sitemap of productSitemaps) {
      const url = sitemap.loc[0];
      const language = Utils.extractLanguageFromUrl(url);
      if (!language || !config.languages.supported.includes(language)) {
        console.log(`跳过不支持的语言sitemap: ${url} (语言: ${language || 'null'})`);
        continue;
      }
      console.log(`\n处理产品sitemap: ${url} (语言: ${language})`);

      try {
        const response = await axios.get(url);
        const sitemapData = await this.parseSitemapXml(response.data);
        if (sitemapData.urlset && sitemapData.urlset.url) {
          const allUrls = sitemapData.urlset.url;
          const products = allUrls.filter((item) => {
            const u = item.loc[0];
            return u.includes('/products/') && u !== 'https://consciousitems.com/';
          });
          console.log(`找到 ${allUrls.length} 个URL，其中 ${products.length} 个是产品URL`);

          const slice = products.slice(0, MAX_PRODUCTS);
          let consecutiveFailures = 0;
          for (let i = 0; i < slice.length; i++) {
            const product = slice[i];
            const productUrl = product.loc[0];
            console.log(`\n处理产品 ${i + 1}/${slice.length}: ${productUrl}`);
            try {
              const images = this.extractImagesFromSitemap(product);
              // Open a fresh page per product to avoid cross-navigation issues
              const page = await this.context.newPage();
              const productData = await this.scrapeProductDetails(page, productUrl, language, images);
              await page.close();
              if (productData) {
                // Transform and push into batch buffer (do not keep raw productData)
                const row = transformProductData(productData, language);
                this.batchBuffer.push(row);
                this.totalProcessed++;
                this.languages.add(language);
                consecutiveFailures = 0;
                if (this.batchBuffer.length >= BATCH_SIZE) {
                  await this.flushBatch(language);
                }
                const randomDelay = Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS;
                await Utils.delay(randomDelay);
              }
            } catch (err) {
              console.error(`❌ 抓取产品失败 ${productUrl}:`, err.message);
              consecutiveFailures++;
              if (consecutiveFailures >= RECREATE_CONTEXT_AFTER_FAILS) {
                console.warn(`⚠️ 连续失败 ${consecutiveFailures} 次，重建 browser context`);
                try { await this.setupContext(); } catch (e) { console.error('重建 context 失败:', e.message); }
                consecutiveFailures = 0;
              }
            }
          }
        }
      } catch (error) {
        console.error(`处理产品sitemap失败 ${url}:`, error.message);
      }
    }

    await this.flushBatch(this.locale || 'en');
  }

  async run() {
    const localeInfo = this.locale ? ` (语言: ${this.locale})` : ' (所有支持的语言)';
    console.log(`开始产品抓取任务${localeInfo}...`);
    logMemory('start');
    let memInterval = null;
    if (MEMORY_LOG_INTERVAL_SEC > 0) {
      try {
        memInterval = setInterval(() => logMemory('interval'), MEMORY_LOG_INTERVAL_SEC * 1000);
      } catch (_) {}
    }
    try {
      await this.initBrowser();
      const sitemaps = await this.getMainSitemap();
      const productSitemaps = this.filterProductSitemaps(sitemaps);
      if (productSitemaps.length === 0) {
        if (this.locale) console.log(`未找到语言为 ${this.locale} 的产品sitemap`);
        else console.log('未找到产品sitemap');
        return;
      }
      console.log(`找到 ${productSitemaps.length} 个产品sitemap`);
      await this.scrapeProducts(productSitemaps);
      console.log(`\n抓取完成: 共处理 ${this.totalProcessed} 个产品`);
    } catch (error) {
      console.error('产品抓取失败:', error);
      throw error;
    } finally {
      await this.closeBrowser();
      if (memInterval) {
        try { clearInterval(memInterval); } catch (_) {}
      }
      logMemory('end');
    }
  }
}

async function main() {
  // Ensure browsers are installed (idempotent)
  try {
    // Optional: silent install to avoid OOM on first run; skip if not desired
    // This call is lightweight if already installed
    // No-op on Render if pre-installed via build steps
  } catch (_) {}

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

if (require.main === module) {
  main();
}

module.exports = { ProductScraper };


