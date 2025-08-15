const { chromium } = require('playwright');

async function testVariantsExtraction() {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    // 测试有变体的产品页面
    console.log('测试变体提取...');
    await page.goto('https://consciousitems.com/products/abundance-pens', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // 等待页面加载
    await page.waitForTimeout(3000);
    
    // 检查变体元素
    console.log('\n=== 变体元素检查 ===');
    
    // 检查variant-radios
    const variantRadios = await page.$('variant-radios');
    if (variantRadios) {
      console.log('✅ 找到 variant-radios 元素');
      
      // 检查变体输入
      const variantInputs = await page.$$('variant-radios input[type="radio"]');
      console.log(`找到 ${variantInputs.length} 个变体输入`);
      
      for (let i = 0; i < variantInputs.length; i++) {
        const input = variantInputs[i];
        const value = await input.getAttribute('value');
        const id = await input.getAttribute('id');
        const disabled = await input.getAttribute('disabled');
        const checked = await input.getAttribute('checked');
        
        console.log(`变体 ${i + 1}:`);
        console.log(`  ID: ${id}`);
        console.log(`  值: ${value}`);
        console.log(`  禁用: ${disabled}`);
        console.log(`  选中: ${checked}`);
      }
    }
    
    // 检查JSON数据
    console.log('\n=== JSON数据检查 ===');
    const jsonScripts = await page.$$('script[type="application/json"]');
    console.log(`找到 ${jsonScripts.length} 个JSON脚本`);
    
    for (let i = 0; i < jsonScripts.length; i++) {
      const script = jsonScripts[i];
      const jsonText = await script.textContent();
      
      if (jsonText) {
        try {
          const jsonData = JSON.parse(jsonText);
          if (Array.isArray(jsonData) && jsonData.length > 0) {
            const firstItem = jsonData[0];
            if (firstItem.id && firstItem.title && typeof firstItem.price === 'number') {
              console.log(`✅ 找到变体JSON数据，包含 ${jsonData.length} 个变体`);
              
              for (let j = 0; j < jsonData.length; j++) {
                const variant = jsonData[j];
                console.log(`变体 ${j + 1}:`);
                console.log(`  ID: ${variant.id}`);
                console.log(`  标题: ${variant.title}`);
                console.log(`  价格: $${(variant.price / 100).toFixed(2)}`);
                console.log(`  可用: ${variant.available}`);
                console.log(`  SKU: ${variant.sku}`);
                console.log(`  库存: ${variant.inventory_quantity}`);
              }
              break;
            }
          }
        } catch (error) {
          // 忽略解析错误
        }
      }
    }
    
    // 等待用户查看
    console.log('\n页面已加载，请查看浏览器窗口...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await browser.close();
  }
}

testVariantsExtraction();
