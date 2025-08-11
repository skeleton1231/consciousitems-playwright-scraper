const { chromium } = require('playwright');
const xml2js = require('xml2js');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const Utils = require('./utils');

// 白名单：只抓取以下集合URL
const WHITELIST_COLLECTION_URLS = [
  'https://consciousitems.com/collections/anklets',
  'https://consciousitems.com/collections/bracelet',
  'https://consciousitems.com/collections/demi-fine-silver-jewelry',
  'https://consciousitems.com/collections/earrings',
  'https://consciousitems.com/collections/healing-necklace',
  'https://consciousitems.com/collections/rings',
  'https://consciousitems.com/collections/carvings-pyramids',
  'https://consciousitems.com/collections/crystals',
  'https://consciousitems.com/collections/crystals-for-car-protection',
  'https://consciousitems.com/collections/carvings-pyramids',
  'https://consciousitems.com/collections/healing-crystal-lamps',
  'https://consciousitems.com/collections/crystal-cleansing',
];

class CollectionScraper {
  constructor() {
    this.data = {
      collections: [],
      totalProducts: 0,
      languages: []
    };
    this.browser = null;
    this.context = null;
  }

  // 直接根据白名单URL抓取集合
  async scrapeCollectionsFromWhitelist(collectionUrls) {
    console.log('开始从白名单抓取集合数据...');
    const page = await this.context.newPage();

    for (let i = 0; i < collectionUrls.length; i++) {
      const collectionUrl = (collectionUrls[i] || '').trim();
      if (!collectionUrl) continue;

      // 从URL推断语言，否则使用默认语言
      const language = Utils.extractLanguageFromUrl(collectionUrl) || config.languages.default;

      console.log(`\n处理白名单集合 ${i + 1}/${collectionUrls.length}: ${collectionUrl} (语言: ${language})`);

      try {
        const collectionData = await Utils.retry(async () => {
          await page.goto(collectionUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
          });

          await page.waitForTimeout(2000);

          const data = await Utils.extractPageData(page, config.selectors.collection);
          const productUrls = await this.extractProductUrlsFromCollection(page, collectionUrl);

          return {
            ...data,
            language,
            lastmod: null,
            originalUrl: collectionUrl,
            productUrls: productUrls,
            productCount: productUrls.length
          };
        }, config.scraping.maxRetries);

        this.data.collections.push(collectionData);
        this.data.totalProducts += collectionData.productUrls.length;

        console.log(`✓ 已抓取集合: ${collectionData.title || '未知标题'}`);
        console.log(`  产品数量: ${collectionData.productUrls.length} 个`);

        await this.saveCollectionData(collectionData);

        if (collectionData.productUrls.length > 0) {
          console.log('  产品URL示例:');
          collectionData.productUrls.slice(0, 10).forEach((url, index) => {
            console.log(`    ${index + 1}. ${url}`);
          });
          if (collectionData.productUrls.length > 10) {
            console.log(`    ... 还有 ${collectionData.productUrls.length - 10} 个产品`);
          }
        }

        // 添加延迟避免被检测
        await Utils.delay(5000);
      } catch (error) {
        console.error(`✗ 抓取白名单集合失败 ${collectionUrl}:`, error.message);
      }
    }

    await page.close();
  }

  // 初始化浏览器
  async initBrowser() {
    this.browser = await chromium.launch({
      ...config.browser,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
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

  // 过滤集合sitemap
  filterCollectionSitemaps(sitemaps) {
    return sitemaps.filter(sitemap => 
      sitemap.loc[0].includes('sitemap_collections_1.xml')
    );
  }

  // 抓取集合数据
  async scrapeCollections(collectionSitemaps) {
    console.log('开始抓取集合数据...');
    const page = await this.context.newPage();

    for (const sitemap of collectionSitemaps) {
      const url = sitemap.loc[0];
      const language = Utils.extractLanguageFromUrl(url);
      
      // 额外检查：如果获取到的locale不在支持列表中，就跳过
      if (!language || !config.languages.supported.includes(language)) {
        console.log(`\n跳过不支持的语言sitemap: ${url} (语言: ${language || 'null'})`);
        continue;
      }
      
      console.log(`\n处理集合sitemap: ${url} (语言: ${language})`);
      
      try {
        // 获取sitemap内容
        const response = await axios.get(url);
        const sitemapData = await this.parseSitemapXml(response.data);
        
        if (sitemapData.urlset && sitemapData.urlset.url) {
          const collections = sitemapData.urlset.url;
          console.log(`找到 ${collections.length} 个集合URL`);
          
          for (let i = 0; i < collections.length; i++) {
            const collection = collections[i];
            const collectionUrl = collection.loc[0];
            const lastmod = collection.lastmod ? collection.lastmod[0] : null;
            
            console.log(`\n处理集合 ${i + 1}/${collections.length}: ${collectionUrl}`);
            
            try {
                             // 使用重试机制访问集合页面
               const collectionData = await Utils.retry(async () => {
                 await page.goto(collectionUrl, { 
                   waitUntil: 'domcontentloaded', // 改为更快的等待策略
                   timeout: 60000 // 增加超时时间到60秒
                 });
                 
                 // 等待页面加载完成
                 await page.waitForTimeout(2000);
                 
                 const data = await Utils.extractPageData(page, config.selectors.collection);
                 
                 // 从集合页面获取产品URL
                 const productUrls = await this.extractProductUrlsFromCollection(page, collectionUrl);
                 
                 return {
                   ...data,
                   language,
                   lastmod,
                   originalUrl: collectionUrl,
                   productUrls: productUrls,
                   productCount: productUrls.length
                 };
               }, config.scraping.maxRetries);
              
              this.data.collections.push(collectionData);
              this.data.totalProducts += collectionData.productUrls.length;
              
              console.log(`✓ 已抓取集合: ${collectionData.title || '未知标题'}`);
              console.log(`  产品数量: ${collectionData.productUrls.length} 个`);
              
              // 动态保存单个集合数据
              await this.saveCollectionData(collectionData);
              
              // 打印前10个产品URL作为示例
              if (collectionData.productUrls.length > 0) {
                console.log(`  产品URL示例:`);
                collectionData.productUrls.slice(0, 10).forEach((url, index) => {
                  console.log(`    ${index + 1}. ${url}`);
                });
                if (collectionData.productUrls.length > 10) {
                  console.log(`    ... 还有 ${collectionData.productUrls.length - 10} 个产品`);
                }
              }
              
                             // 添加延迟避免被检测 (较慢的速度)
               await Utils.delay(5000); // 5秒延迟
              
            } catch (error) {
              console.error(`✗ 抓取集合页面失败 ${collectionUrl}:`, error.message);
            }
          }
        }
      } catch (error) {
        console.error(`✗ 处理集合sitemap失败 ${url}:`, error.message);
      }
    }
    
    await page.close();
  }

  // 从集合页面提取产品URL
  async extractProductUrlsFromCollection(page, collectionUrl) {
    try {
      // 首先获取产品数量
      const productCount = await page.evaluate(() => {
        const productCountElement = document.querySelector('#ProductCount.product-count__text');
        if (productCountElement) {
          const text = productCountElement.textContent.trim();
          const match = text.match(/(\d+)\s+products?/i);
          return match ? parseInt(match[1]) : 0;
        }
        return 0;
      });

      console.log(`  页面显示产品数量: ${productCount}`);

      // 检查是否有"Show more"按钮或分页
      const hasLoadMore = await page.evaluate(() => {
        const loadMoreBtn = document.querySelector('button[data-load-more], .load-more, .show-more');
        
        // 查找包含"Show more"文本的按钮
        const buttons = Array.from(document.querySelectorAll('button, a'));
        const showMoreBtn = buttons.find(btn => 
          btn.textContent.toLowerCase().includes('show more') ||
          btn.textContent.toLowerCase().includes('load more') ||
          btn.textContent.toLowerCase().includes('view more')
        );
        
        return !!(loadMoreBtn || showMoreBtn);
      });

      // 如果有加载更多按钮，点击直到所有产品加载完成
      if (hasLoadMore) {
        console.log('  发现"Show more"按钮，正在加载所有产品...');
        await this.loadAllProducts(page);
      }

      // 滚动页面确保所有产品都加载
      await this.scrollToLoadAllProducts(page);

      // 从ProductGridContainer中提取产品URL
      const productUrls = await page.evaluate(() => {
        const productGridContainer = document.querySelector('#ProductGridContainer');
        if (!productGridContainer) {
          console.log('未找到ProductGridContainer');
          return [];
        }

        const urls = [];
        const seenUrls = new Set(); // 使用Set来跟踪已见过的URL

        // 查找所有产品卡片 - 使用更广泛的选择器
        const productCards = productGridContainer.querySelectorAll('.card-wrapper, .product-item, .grid__item, li');
        
        console.log(`找到 ${productCards.length} 个产品卡片`);
        
        productCards.forEach((card, index) => {
          try {
            // 提取产品链接 - 使用多种选择器
            const productLink = card.querySelector('a[href*="/products/"]') || 
                               card.querySelector('a[href*="/collections/"]') ||
                               card.querySelector('a');
            
            if (!productLink) {
              console.log(`卡片 ${index + 1} 没有找到产品链接`);
              return;
            }

            const productUrl = productLink.href;
            if (!productUrl.includes('/products/')) {
              console.log(`卡片 ${index + 1} 的链接不是产品链接: ${productUrl}`);
              return;
            }
            
            // 使用Set来检查重复，更高效
            if (seenUrls.has(productUrl)) {
              console.log(`卡片 ${index + 1} 的链接已存在: ${productUrl}`);
              return; // 避免重复
            }

            seenUrls.add(productUrl);
            urls.push(productUrl);
            console.log(`提取产品 ${index + 1}: ${productUrl}`);

          } catch (error) {
            console.log(`提取产品 ${index + 1} URL时出错:`, error);
          }
        });

        return urls;
      });

      console.log(`  成功提取 ${productUrls.length} 个产品URL`);

      // 验证提取的产品数量是否与页面显示的一致
      if (productCount > 0 && productUrls.length !== productCount) {
        console.log(`  警告: 页面显示 ${productCount} 个产品，但只提取到 ${productUrls.length} 个`);
        console.log('  继续滚动直到加载所有产品...');
        
        // 持续滚动直到产品数量匹配或达到最大尝试次数
        let maxRetryAttempts = 10;
        let retryCount = 0;
        let currentProductUrls = productUrls;
        
        while (currentProductUrls.length < productCount && retryCount < maxRetryAttempts) {
          retryCount++;
          console.log(`  重试 ${retryCount}/${maxRetryAttempts}: 当前 ${currentProductUrls.length}/${productCount} 个产品`);
          
          // 再次滚动确保所有产品加载
          await this.scrollToLoadAllProducts(page);
          
          // 重新提取产品URL
          currentProductUrls = await page.evaluate(() => {
            const productGridContainer = document.querySelector('#ProductGridContainer');
            if (!productGridContainer) {
              return [];
            }

            const urls = [];
            const seenUrls = new Set(); // 使用Set来避免重复

            const productCards = productGridContainer.querySelectorAll('.card-wrapper, .product-item, .grid__item, li');
            
            productCards.forEach((card) => {
              try {
                const productLink = card.querySelector('a[href*="/products/"]') || 
                                   card.querySelector('a[href*="/collections/"]') ||
                                   card.querySelector('a');
                
                if (!productLink) return;

                const productUrl = productLink.href;
                if (!productUrl.includes('/products/')) return;
                
                if (seenUrls.has(productUrl)) return; // 避免重复

                seenUrls.add(productUrl);
                urls.push(productUrl);

              } catch (error) {
                console.log('提取产品URL时出错:', error);
              }
            });

            return urls;
          });

          console.log(`  重试后提取到 ${currentProductUrls.length} 个产品URL`);
          
          // 如果产品数量没有增加，等待更长时间
          if (currentProductUrls.length === productUrls.length) {
            console.log('  产品数量没有增加，等待更长时间...');
            await page.waitForTimeout(5000);
          }
        }
        
        return currentProductUrls;
      }

      // 如果提取的产品数量与页面显示的不符，尝试其他方法
      if (productUrls.length === 0) {
        console.log('  尝试备用方法提取产品URL...');
        const fallbackUrls = await page.evaluate(() => {
          const selectors = [
            'a[href*="/products/"]',
            '.product-item a[href*="/products/"]',
            '.collection-product a[href*="/products/"]',
            'a[href*="/collections/"]'
          ];
          
          let allUrls = [];
          
          selectors.forEach(selector => {
            try {
              const links = Array.from(document.querySelectorAll(selector));
              const urls = links.map(link => link.href).filter(url => 
                url.includes('/products/') && !url.includes('#')
              );
              allUrls = allUrls.concat(urls);
            } catch (e) {
              // 忽略选择器错误
            }
          });
          
          // 去重并过滤
          const uniqueUrls = [...new Set(allUrls)];
          return uniqueUrls.filter(url => url.includes('/products/'));
        });

        return fallbackUrls;
      }

      return productUrls;
    } catch (error) {
      console.error(`提取产品URL失败 ${collectionUrl}:`, error.message);
      return [];
    }
  }

  // 滚动页面加载所有产品
  async scrollToLoadAllProducts(page) {
    try {
      console.log('  正在滚动页面加载所有产品...');
      
      let previousHeight = 0;
      let currentHeight = await page.evaluate(() => document.body.scrollHeight);
      let scrollAttempts = 0;
      const maxScrollAttempts = 50; // 大幅增加滚动次数
      let previousProductCount = 0;
      let noChangeCount = 0;
      const maxNoChangeCount = 10; // 增加无变化容忍次数
      
      while (scrollAttempts < maxScrollAttempts) {
        // 使用缓慢滚动策略来触发无限滚动
        await page.evaluate(() => {
          const scrollStep = 300;
          return new Promise((resolve) => {
            const scrollInterval = setInterval(() => {
              window.scrollBy(0, scrollStep);
              if (window.scrollY >= document.body.scrollHeight - window.innerHeight) {
                clearInterval(scrollInterval);
                resolve();
              }
            }, 100);
          });
        });
        
        // 等待内容加载
        await page.waitForTimeout(3000);
        
        // 检查是否有新的产品加载
        const currentProductCount = await page.evaluate(() => {
          const productGridContainer = document.querySelector('#ProductGridContainer');
          if (productGridContainer) {
            return productGridContainer.querySelectorAll('.card-wrapper, .product-item, .grid__item').length;
          }
          return 0;
        });
        
        previousHeight = currentHeight;
        currentHeight = await page.evaluate(() => document.body.scrollHeight);
        scrollAttempts++;
        
        console.log(`    滚动尝试 ${scrollAttempts}/${maxScrollAttempts}, 页面高度: ${currentHeight}, 当前产品数: ${currentProductCount}`);
        
        // 检查产品数量是否有变化
        if (currentProductCount === previousProductCount) {
          noChangeCount++;
          console.log(`    产品数量无变化，连续 ${noChangeCount} 次`);
          
          // 如果连续多次没有变化，尝试更激进的滚动
          if (noChangeCount >= 3) {
            console.log('    尝试更激进的滚动...');
            await page.evaluate(() => {
              // 滚动到更底部的位置
              window.scrollTo(0, document.body.scrollHeight + 1000);
            });
            await page.waitForTimeout(2000);
            
            // 再次检查产品数量
            const newProductCount = await page.evaluate(() => {
              const productGridContainer = document.querySelector('#ProductGridContainer');
              if (productGridContainer) {
                return productGridContainer.querySelectorAll('.card-wrapper, .product-item, .grid__item').length;
              }
              return 0;
            });
            
            if (newProductCount > currentProductCount) {
              console.log(`    激进滚动后产品数量增加: ${currentProductCount} -> ${newProductCount}`);
              noChangeCount = 0;
              currentProductCount = newProductCount;
            }
          }
        } else {
          noChangeCount = 0; // 重置计数器
          console.log(`    产品数量增加: ${previousProductCount} -> ${currentProductCount}`);
        }
        
        // 如果连续多次没有变化，停止滚动
        if (noChangeCount >= maxNoChangeCount) {
          console.log(`    连续 ${maxNoChangeCount} 次产品数量无变化，停止滚动`);
          break;
        }
        
        // 如果页面高度没有变化且产品数量没有变化，也停止
        if (previousHeight === currentHeight && currentProductCount === previousProductCount) {
          console.log('    页面高度和产品数量都无变化，停止滚动');
          break;
        }
        
        previousProductCount = currentProductCount;
      }
      
      // 滚动回顶部
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      
      console.log('  滚动完成');
    } catch (error) {
      console.error('滚动页面失败:', error.message);
    }
  }

  // 点击"Show more"按钮加载所有产品
  async loadAllProducts(page) {
    try {
      let clickAttempts = 0;
      const maxClickAttempts = 10; // 减少点击次数
      
      while (clickAttempts < maxClickAttempts) {
        // 查找并点击"Show more"按钮
        const showMoreButton = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          return buttons.find(btn => 
            btn.textContent.toLowerCase().includes('show more') ||
            btn.textContent.toLowerCase().includes('load more') ||
            btn.textContent.toLowerCase().includes('view more')
          );
        });
        
        if (!showMoreButton) {
          console.log('    没有找到更多"Show more"按钮');
          break;
        }
        
        // 点击按钮
        await page.evaluate((button) => {
          button.click();
        }, showMoreButton);
        
        // 等待内容加载
        await page.waitForTimeout(1500);
        
        clickAttempts++;
        console.log(`    点击"Show more"按钮 ${clickAttempts}/${maxClickAttempts}`);
      }
      
      console.log('  "Show more"按钮点击完成');
    } catch (error) {
      console.error('点击"Show more"按钮失败:', error.message);
    }
  }

  // 分析语言分布
  analyzeLanguages() {
    const languages = new Set();
    
    this.data.collections.forEach(collection => {
      languages.add(collection.language);
    });
    
    this.data.languages = Array.from(languages);
    console.log(`\n发现的语言: ${this.data.languages.join(', ')}`);
  }

  // 生成统计信息
  generateStats() {
    const stats = {
      totalCollections: this.data.collections.length,
      totalProducts: this.data.totalProducts,
      languages: this.data.languages,
      collectionsByLanguage: {}
    };

    // 按语言统计集合
    this.data.collections.forEach(collection => {
      if (!stats.collectionsByLanguage[collection.language]) {
        stats.collectionsByLanguage[collection.language] = {
          count: 0,
          totalProducts: 0
        };
      }
      stats.collectionsByLanguage[collection.language].count++;
      stats.collectionsByLanguage[collection.language].totalProducts += collection.productUrls.length;
    });

    return stats;
  }

  // 打印统计信息
  printStats(stats) {
    console.log('\n=== 抓取统计 ===');
    console.log(`总集合数: ${stats.totalCollections}`);
    console.log(`总产品URL数: ${stats.totalProducts}`);
    console.log(`支持的语言: ${stats.languages.join(', ')}`);
    
    console.log('\n按语言统计:');
    Object.entries(stats.collectionsByLanguage).forEach(([lang, data]) => {
      console.log(`  ${lang}: ${data.count} 个集合, ${data.totalProducts} 个产品URL`);
    });
    
    // 显示每种语言的详细信息
    console.log('\n语言详细信息:');
    Object.entries(stats.collectionsByLanguage).forEach(([lang, data]) => {
      const avgProductsPerCollection = data.count > 0 ? (data.totalProducts / data.count).toFixed(1) : 0;
      console.log(`  ${lang}:`);
      console.log(`    集合数: ${data.count}`);
      console.log(`    产品URL数: ${data.totalProducts}`);
      console.log(`    平均每集合产品数: ${avgProductsPerCollection}`);
    });
    console.log('================\n');
  }

  // 动态保存单个集合数据
  async saveCollectionData(collectionData) {
    try {
      const locale = collectionData.language || 'unknown';
      
      // 从URL中提取slug
      const urlParts = collectionData.originalUrl.split('/');
      const slug = urlParts[urlParts.length - 1] || 'unknown';
      
      // 创建目录结构: collections/{locale}/
      const collectionsDir = path.join('data', 'collections', locale);
      await fs.mkdir(collectionsDir, { recursive: true });
      
      // 只保存产品URL数据
      const productUrlsFile = path.join(collectionsDir, `${slug}-urls.json`);
      const productUrlsData = collectionData.productUrls.map(url => ({
        url: url,
        collection: collectionData.originalUrl,
        language: collectionData.language,
        collectionTitle: collectionData.title,
        slug: slug
      }));
      
      await fs.writeFile(
        productUrlsFile,
        JSON.stringify(productUrlsData, null, 2)
      );
      
      console.log(`  💾 已保存到: collections/${locale}/${slug}-urls.json`);
      
    } catch (error) {
      console.error(`  保存集合数据失败: ${error.message}`);
    }
  }

  // 保存数据到文件
  async saveData() {
    const dataDir = 'data';
    
    try {
      await fs.mkdir(dataDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // 保存完整数据
      await fs.writeFile(
        path.join(dataDir, `collections-data-${timestamp}.json`),
        JSON.stringify(this.data, null, 2)
      );
      
      // 生成按语言分组的统计信息
      const collectionsByLanguage = {};
      const productUrlsByLanguage = {};
      
      this.data.collections.forEach(collection => {
        const lang = collection.language || 'unknown';
        
        // 按语言分组统计
        if (!collectionsByLanguage[lang]) {
          collectionsByLanguage[lang] = [];
        }
        collectionsByLanguage[lang].push(collection);
        
        if (!productUrlsByLanguage[lang]) {
          productUrlsByLanguage[lang] = [];
        }
        
        collection.productUrls.forEach(url => {
          productUrlsByLanguage[lang].push({
            url: url,
            collection: collection.originalUrl,
            language: collection.language,
            collectionTitle: collection.title
          });
        });
      });
      
      // 保存所有产品URL
      const allProductUrls = [];
      
      this.data.collections.forEach(collection => {
        collection.productUrls.forEach(url => {
          allProductUrls.push({
            url: url,
            collection: collection.originalUrl,
            language: collection.language,
            collectionTitle: collection.title
          });
        });
      });
      
      await fs.writeFile(
        path.join(dataDir, `all-product-urls-${timestamp}.json`),
        JSON.stringify(allProductUrls, null, 2)
      );
      
      console.log(`数据已保存到 ${dataDir} 目录`);
      console.log(`- collections-data-${timestamp}.json (完整数据)`);
      console.log(`- all-product-urls-${timestamp}.json (所有产品URL)`);
      
      // 显示按语言统计的信息
      const savedLanguages = Object.keys(collectionsByLanguage);
      console.log(`\n按语言统计:`);
      savedLanguages.forEach(lang => {
        const collectionCount = collectionsByLanguage[lang].length;
        const productCount = productUrlsByLanguage[lang] ? productUrlsByLanguage[lang].length : 0;
        console.log(`  ${lang}: ${collectionCount} 个集合, ${productCount} 个产品URL`);
        console.log(`    已保存到: data/collections/${lang}/ 目录`);
      });
      
    } catch (error) {
      console.error('保存数据失败:', error);
    }
  }

  // 主执行方法
  async run() {
    try {
      console.log('开始抓取 ConsciousItems 集合数据...');
      console.log('配置信息:', {
        headless: config.browser.headless,
        delay: '3秒',
        maxRetries: config.scraping.maxRetries,
        supportedLanguages: config.languages.supported
      });
      
      // 1. 初始化浏览器
      await this.initBrowser();
      
      // 2. 使用白名单URL抓取集合数据（不再从sitemap读取）
      await this.scrapeCollectionsFromWhitelist(WHITELIST_COLLECTION_URLS);
      
      // 5. 分析语言
      this.analyzeLanguages();
      
      // 6. 生成统计信息
      const stats = this.generateStats();
      this.printStats(stats);
      
      // 7. 保存数据
      await this.saveData();
      
      console.log('抓取完成!');
      
    } catch (error) {
      console.error('抓取过程中发生错误:', error);
    } finally {
      // 8. 关闭浏览器
      await this.closeBrowser();
    }
  }
}

// 运行抓取器
async function main() {
  const scraper = new CollectionScraper();
  await scraper.run();
}

main().catch(console.error); 