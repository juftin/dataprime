/**
 * DataPrime Background Service Worker - Demo Data Seeding Engine
 */

/**
 * Seeds high-quality demo data for visual dashboard testing.
 * @returns {Promise<Array<Object>>}
 */
export async function seedDemoData() {
  const categories = [
    "Electronics",
    "Kitchen",
    "Apparel",
    "Office Supplies",
    "Groceries",
    "Books",
    "Streaming",
    "Home Goods",
  ];
  const sellers = [
    "Amazon.com",
    "Anker Direct",
    "Spreetail",
    "Whole Foods Market",
    "Patagonia",
    "Logitech Inc.",
    "Digital Services",
  ];

  const mockTransactions = [];
  const now = new Date();

  // Generate 25 mock transactions over the last 12 months
  for (let i = 0; i < 25; i++) {
    const txDate = new Date(now.getTime() - i * 14 * 24 * 60 * 60 * 1000);
    const dateISO = txDate.toISOString().split("T")[0];
    const orderId = `114-${Math.floor(1000000 + Math.random() * 9000000)}-${Math.floor(1000000 + Math.random() * 9000000)}`;

    // Determine random transaction structure
    const amountPaid = parseFloat((15 + Math.random() * 250).toFixed(2));

    // Calculate realistic shipping and tax
    const hasTax = Math.random() > 0.1;
    const hasShipping = Math.random() > 0.6;
    const shipping = hasShipping ? 5.99 : 0.0;
    const taxRate = hasTax ? 0.0825 : 0.0;

    const orderSubtotal = parseFloat(
      ((amountPaid - shipping) / (1 + taxRate)).toFixed(2),
    );
    const orderTax = parseFloat((orderSubtotal * taxRate).toFixed(2));
    const orderTotal = parseFloat(
      (orderSubtotal + shipping + orderTax).toFixed(2),
    );

    // Create 1-3 itemized items
    const items = [];
    const itemCount = Math.floor(1 + Math.random() * 3);
    let remainingAmount = orderSubtotal;

    for (let j = 0; j < itemCount; j++) {
      const itemPrice =
        j === itemCount - 1
          ? remainingAmount
          : parseFloat(
              (
                (remainingAmount / (itemCount - j)) *
                (0.6 + Math.random() * 0.4)
              ).toFixed(2),
            );
      remainingAmount = parseFloat((remainingAmount - itemPrice).toFixed(2));

      const category =
        categories[Math.floor(Math.random() * categories.length)];
      const seller = sellers[Math.floor(Math.random() * sellers.length)];

      let itemTitle = `Premium ${category} Product ${j + 1}`;
      if (category === "Electronics") {
        itemTitle = [
          "Anker USB-C Power Hub 100W",
          "Logitech MX Master 3S Wireless Mouse",
          "Sony WH-1000XM4 Noise Cancelling Headphones",
          "Kindle Paperwhite (16 GB)",
        ][Math.floor(Math.random() * 4)];
      } else if (category === "Kitchen") {
        itemTitle = [
          "Instant Pot Duo 7-in-1 Smart Cooker",
          "Hydro Flask Wide Mouth Water Bottle",
          "Cosori Air Fryer Max XL 5.8 Qt",
          "Bodum Chambord French Press",
        ][Math.floor(Math.random() * 4)];
      } else if (category === "Groceries") {
        itemTitle = [
          "Organic Fuji Apples (3lb Bag)",
          "LaCroix Sparkling Water 24-Pack",
          "Organic Creamy Peanut Butter 28oz",
          "365 Everyday Value Olive Oil",
        ][Math.floor(Math.random() * 4)];
      } else if (category === "Apparel") {
        itemTitle = [
          "Patagonia Better Sweater Fleece Jacket",
          "Levis 511 Slim Fit Men's Jeans",
          "Champion Powerblend Fleece Hoodie",
          "Darn Tough Merino Wool Hiking Socks",
        ][Math.floor(Math.random() * 4)];
      }

      const asin = `B07M${Math.floor(100000 + Math.random() * 900000)}`;
      items.push({
        title: itemTitle,
        url: `https://www.amazon.com/gp/product/${asin}`,
        asin,
        price: itemPrice,
        quantity: 1,
        imageUrl: `https://picsum.photos/seed/${Math.floor(Math.random() * 1000)}/100/100`, // beautiful random product fallback images
        seller,
      });
    }

    mockTransactions.push({
      id: orderId,
      date: dateISO,
      paymentAmount: orderTotal,
      description: `Payment for Order ${orderId}`,
      orderId,
      orderDetailsUrl: `https://www.amazon.com/gp/your-account/order-details?orderID=${orderId}`,
      paymentMethod: [
        "Visa (*4321)",
        "MasterCard (*9876)",
        "Amex (*1002)",
        "Amazon Gift Card",
      ][Math.floor(Math.random() * 4)],
      summary: {
        orderSubtotal,
        shippingHandling: shipping,
        orderTax,
        orderTotal,
      },
      items,
    });
  }

  // Add 2 refunds
  for (let i = 0; i < 2; i++) {
    const txDate = new Date(now.getTime() - (5 + i * 40) * 24 * 60 * 60 * 1000);
    const dateISO = txDate.toISOString().split("T")[0];
    const originalOrderId = `114-${Math.floor(1000000 + Math.random() * 9000000)}-${Math.floor(1000000 + Math.random() * 9000000)}`;
    const refundAmount = -parseFloat((20 + Math.random() * 80).toFixed(2));

    const baseKey = `${originalOrderId}-${dateISO}-${Math.abs(refundAmount).toFixed(2)}`;
    mockTransactions.push({
      id: `${baseKey}-0-R`,
      date: dateISO,
      paymentAmount: refundAmount,
      description: `Refund for Order ${originalOrderId}`,
      orderId: originalOrderId,
      orderDetailsUrl: `https://www.amazon.com/gp/your-account/order-details?orderID=${originalOrderId}`,
      paymentMethod: "Refund to Card",
      items: [
        {
          title: "Returned Item Refund",
          url: `https://www.amazon.com/gp/product/B07M${Math.floor(100000 + Math.random() * 900000)}`,
          asin: `B07M${Math.floor(100000 + Math.random() * 900000)}`,
          price: refundAmount,
          quantity: 1,
          imageUrl: `https://picsum.photos/seed/refund/100/100`,
          seller: "Amazon.com",
        },
      ],
    });
  }

  // Add a dedicated partial refund test case (Order with 2 items, only 1 returned)
  const partialRefundDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  const partialRefundOrderId = "114-1234567-7654321";

  // Original Purchase
  mockTransactions.push({
    id: partialRefundOrderId,
    date: new Date(partialRefundDate.getTime() - 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0], // 7 days ago
    paymentAmount: 37.89,
    description: `Payment for Order ${partialRefundOrderId}`,
    orderId: partialRefundOrderId,
    orderDetailsUrl: `https://www.amazon.com/gp/your-account/order-details?orderID=${partialRefundOrderId}`,
    paymentMethod: "Visa (*4321)",
    summary: {
      orderSubtotal: 35.0,
      shippingHandling: 0.0,
      orderTax: 2.89,
      orderTotal: 37.89,
    },
    items: [
      {
        title: "Premium French Press Coffee Maker (34 oz)",
        url: "https://www.amazon.com/gp/product/B07M123456",
        asin: "B07M123456",
        price: 20.0,
        quantity: 1,
        imageUrl: "https://picsum.photos/seed/press/100/100",
        seller: "Amazon.com",
      },
      {
        title: "Double-Walled Borosilicate Espresso Glasses (Set of 2)",
        url: "https://www.amazon.com/gp/product/B07M654321",
        asin: "B07M654321",
        price: 15.0,
        quantity: 1,
        imageUrl: "https://picsum.photos/seed/glass/100/100",
        seller: "Anker Direct",
      },
    ],
  });

  // Subsequent Partial Refund (Refund for the glasses)
  const refundDateISO = partialRefundDate.toISOString().split("T")[0];
  const partialRefundBaseKey = `${partialRefundOrderId}-${refundDateISO}-16.24`;
  mockTransactions.push({
    id: `${partialRefundBaseKey}-0-R`,
    date: refundDateISO,
    paymentAmount: -16.24,
    description: `Refund for Order ${partialRefundOrderId}`,
    orderId: partialRefundOrderId,
    orderDetailsUrl: `https://www.amazon.com/gp/your-account/order-details?orderID=${partialRefundOrderId}`,
    paymentMethod: "Refund to Card",
    summary: {
      refundSubtotal: 15.0,
      refundTax: 1.24,
      refundTotal: 16.24,
    },
    items: [
      {
        title: "Premium French Press Coffee Maker (34 oz)",
        url: "https://www.amazon.com/gp/product/B07M123456",
        asin: "B07M123456",
        price: 20.0,
        quantity: 1,
        imageUrl: "https://picsum.photos/seed/press/100/100",
        seller: "Amazon.com",
      },
      {
        title: "Double-Walled Borosilicate Espresso Glasses (Set of 2)",
        url: "https://www.amazon.com/gp/product/B07M654321",
        asin: "B07M654321",
        price: 15.0,
        quantity: 1,
        imageUrl: "https://picsum.photos/seed/glass/100/100",
        seller: "Anker Direct",
      },
    ],
  });

  // Sort descending
  mockTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  await chrome.storage.local.set({
    transactions: mockTransactions,
    lastScraped: new Date().toISOString(),
  });

  return mockTransactions;
}
