const fs = require('fs').promises;
const path = require('path');

async function countProducts() {
  try {
    const productsDir = path.join('data', 'products', 'en');
    const files = await fs.readdir(productsDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    console.log(`产品文件数量: ${jsonFiles.length}`);
    
    // 检查是否有无效文件
    let validCount = 0;
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(productsDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const product = JSON.parse(content);
        
        if (product.id && product.title && product.url && product.url.includes('/products/')) {
          validCount++;
        }
      } catch (error) {
        console.error(`解析文件失败: ${file}`);
      }
    }
    
    console.log(`有效产品数量: ${validCount}`);
    
  } catch (error) {
    console.error('统计失败:', error);
  }
}

countProducts();
