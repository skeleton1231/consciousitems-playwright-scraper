const fs = require('fs').promises;
const path = require('path');

async function analyzeProducts() {
  try {
    const productsDir = path.join('data', 'products', 'en');
    
    // 检查目录是否存在
    try {
      await fs.access(productsDir);
    } catch (error) {
      console.error('产品目录不存在:', productsDir);
      return;
    }
    
    // 读取所有产品文件
    const files = await fs.readdir(productsDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    console.log(`=== 产品文件分析 ===`);
    console.log(`产品目录: ${productsDir}`);
    console.log(`总文件数: ${files.length}`);
    console.log(`JSON文件数: ${jsonFiles.length}`);
    
    // 检查每个产品文件的有效性
    let validProducts = 0;
    let invalidProducts = 0;
    const invalidFiles = [];
    
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(productsDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const product = JSON.parse(content);
        
        // 检查必要字段
        if (product.id && product.title && product.url) {
          validProducts++;
        } else {
          invalidProducts++;
          invalidFiles.push(file);
        }
      } catch (error) {
        invalidProducts++;
        invalidFiles.push(file);
        console.error(`解析文件失败 ${file}:`, error.message);
      }
    }
    
    console.log(`\n=== 产品有效性分析 ===`);
    console.log(`有效产品: ${validProducts}`);
    console.log(`无效产品: ${invalidProducts}`);
    
    if (invalidFiles.length > 0) {
      console.log(`\n无效文件列表:`);
      invalidFiles.forEach(file => console.log(`  - ${file}`));
    }
    
    // 检查是否有重复的ID
    const productIds = new Set();
    const duplicateIds = [];
    
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(productsDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const product = JSON.parse(content);
        
        if (product.id) {
          if (productIds.has(product.id)) {
            duplicateIds.push(product.id);
          } else {
            productIds.add(product.id);
          }
        }
      } catch (error) {
        // 忽略解析错误
      }
    }
    
    if (duplicateIds.length > 0) {
      console.log(`\n重复的产品ID:`);
      duplicateIds.forEach(id => console.log(`  - ${id}`));
    }
    
    console.log(`\n=== 总结 ===`);
    console.log(`实际保存的有效产品数: ${validProducts}`);
    console.log(`sitemap中的产品URL数: 242`);
    console.log(`差异: ${242 - validProducts} 个产品`);
    
  } catch (error) {
    console.error('分析失败:', error);
  }
}

analyzeProducts();
