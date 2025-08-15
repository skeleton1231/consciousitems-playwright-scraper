const { chromium } = require('playwright');

async function testAvailabilityDetection() {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    // 测试有库存的产品页面
    console.log('测试有库存的产品页面...');
    await page.goto('https://consciousitems.com/products/curative-lamp', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // 等待页面加载
    await page.waitForTimeout(3000);
    
    try {
      await page.waitForSelector('.product-form__buttons', { timeout: 10000 });
    } catch (error) {
      console.log('未找到 .product-form__buttons，尝试其他选择器...');
    }
    
    // 检查页面内容
    const formButtons = await page.$('.product-form__buttons');
    if (formButtons) {
      const html = await formButtons.innerHTML();
      console.log('产品表单按钮区域HTML:');
      console.log(html);
      
      // 检查是否有通知按钮
      const notifyButton = await page.$('.klaviyo-bis-trigger');
      if (notifyButton) {
        const text = await notifyButton.textContent();
        console.log(`找到通知按钮: "${text}"`);
      }
      
      // 检查是否有添加购物车按钮
      const addButton = await page.$('button[name="add"]');
      if (addButton) {
        const text = await addButton.textContent();
        const disabled = await addButton.getAttribute('disabled');
        console.log(`找到添加按钮: "${text}", 禁用状态: ${disabled}`);
      }
      
      // 模拟库存检测逻辑
      console.log('\n=== 库存状态检测结果 ===');
      
      // 检查通知按钮
      const notifyButton2 = await page.$('.klaviyo-bis-trigger');
      if (notifyButton2) {
        const text = await notifyButton2.textContent();
        console.log(`✅ 检测到通知按钮: "${text}" -> 库存状态: false (无库存)`);
      }
      
      // 检查禁用的按钮
      const disabledButton = await page.$('button[disabled]');
      if (disabledButton) {
        const text = await disabledButton.textContent();
        console.log(`✅ 检测到禁用按钮: "${text}" -> 库存状态: false (无库存)`);
      }
      
      // 检查可用的添加按钮
      const enabledAddButton = await page.$('button[name="add"]:not([disabled])');
      if (enabledAddButton) {
        const text = await enabledAddButton.textContent();
        console.log(`✅ 检测到可用添加按钮: "${text}" -> 库存状态: true (有库存)`);
      }
    }
    
    // 等待用户查看
    console.log('页面已加载，请查看浏览器窗口...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await browser.close();
  }
}

testAvailabilityDetection();
