// 测试库存逻辑
function testAvailabilityLogic() {
  console.log('=== 测试库存逻辑 ===\n');
  
  // 测试用例1: 有可用变体的产品
  const product1 = {
    variants: [
      { id: '1', value: 'Variant 1', price: 1000, available: true },
      { id: '2', value: 'Variant 2', price: 2000, available: false },
      { id: '3', value: 'Variant 3', price: 3000, available: false }
    ]
  };
  
  const availability1 = product1.variants.some(variant => variant.available);
  const availableCount1 = product1.variants.filter(v => v.available).length;
  
  console.log('测试用例1: 有可用变体的产品');
  console.log(`变体数量: ${product1.variants.length}`);
  console.log(`可用变体数量: ${availableCount1}`);
  console.log(`库存状态: ${availability1}`);
  console.log(`预期结果: true (因为有可用变体)\n`);
  
  // 测试用例2: 所有变体都不可用的产品
  const product2 = {
    variants: [
      { id: '1', value: 'Variant 1', price: 1000, available: false },
      { id: '2', value: 'Variant 2', price: 2000, available: false },
      { id: '3', value: 'Variant 3', price: 3000, available: false }
    ]
  };
  
  const availability2 = product2.variants.some(variant => variant.available);
  const availableCount2 = product2.variants.filter(v => v.available).length;
  
  console.log('测试用例2: 所有变体都不可用的产品');
  console.log(`变体数量: ${product2.variants.length}`);
  console.log(`可用变体数量: ${availableCount2}`);
  console.log(`库存状态: ${availability2}`);
  console.log(`预期结果: false (因为所有变体都不可用)\n`);
  
  // 测试用例3: 没有变体的产品
  const product3 = {
    variants: []
  };
  
  console.log('测试用例3: 没有变体的产品');
  console.log(`变体数量: ${product3.variants.length}`);
  console.log(`库存状态: 需要从页面检测`);
  console.log(`预期结果: 根据页面按钮状态判断\n`);
  
  // 测试实际产品数据
  console.log('=== 实际产品数据分析 ===\n');
  
  const actualProduct = {
    variants: [
      {
        "id": "43186829066432",
        "value": "Manifestation Pen Super Set",
        "price": 4900,
        "available": true
      },
      {
        "id": "43186829099200",
        "value": "Abundance & Prosperity Set",
        "price": 2900,
        "available": false
      },
      {
        "id": "43186829131968",
        "value": "Endless Possibilities Set",
        "price": 2900,
        "available": false
      }
    ]
  };
  
  const actualAvailability = actualProduct.variants.some(variant => variant.available);
  const actualAvailableCount = actualProduct.variants.filter(v => v.available).length;
  
  console.log('实际产品: abundance-pens');
  console.log(`变体数量: ${actualProduct.variants.length}`);
  console.log(`可用变体数量: ${actualAvailableCount}`);
  console.log(`当前库存状态: false (错误)`);
  console.log(`正确库存状态: ${actualAvailability} (应该为true，因为有1个可用变体)`);
  console.log(`可用变体: ${actualProduct.variants.filter(v => v.available).map(v => v.value).join(', ')}`);
}

testAvailabilityLogic();
