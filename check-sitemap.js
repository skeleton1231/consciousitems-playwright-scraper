const axios = require('axios');
const xml2js = require('xml2js');

async function checkSitemap() {
  try {
    console.log('检查产品sitemap...');
    
    // 获取产品sitemap
    const sitemapUrl = 'https://consciousitems.com/sitemap_products_1.xml?from=10571041800&to=8246397370560';
    const response = await axios.get(sitemapUrl);
    
    // 解析XML
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);
    
    if (result.urlset && result.urlset.url) {
      const urls = result.urlset.url;
      console.log(`sitemap中包含 ${urls.length} 个URL`);
      
      // 检查前几个URL
      console.log('\n前10个URL:');
      for (let i = 0; i < Math.min(10, urls.length); i++) {
        const url = urls[i].loc[0];
        console.log(`${i + 1}. ${url}`);
      }
      
      // 检查是否有非产品页面的URL
      const nonProductUrls = urls.filter(item => {
        const url = item.loc[0];
        return !url.includes('/products/') || url === 'https://consciousitems.com/';
      });
      
      if (nonProductUrls.length > 0) {
        console.log(`\n发现 ${nonProductUrls.length} 个非产品页面URL:`);
        nonProductUrls.forEach(item => {
          console.log(`  - ${item.loc[0]}`);
        });
      }
      
      // 统计产品URL
      const productUrls = urls.filter(item => {
        const url = item.loc[0];
        return url.includes('/products/') && url !== 'https://consciousitems.com/';
      });
      
      console.log(`\n实际产品URL数量: ${productUrls.length}`);
      console.log(`非产品URL数量: ${nonProductUrls.length}`);
      console.log(`总URL数量: ${urls.length}`);
      
    } else {
      console.log('sitemap格式异常');
    }
    
  } catch (error) {
    console.error('检查sitemap失败:', error.message);
  }
}

checkSitemap();
