// utils/calculateDiscountedPrice.js
 const calculateDiscountedPrice = (price, discount = {}) => {
      const numericPrice = Number(price || 0);

      if (!discount || !discount.type) {
        return numericPrice;
      }

      const discountValue = Number(discount.value || 0);

      let finalPrice = numericPrice;

      if (discount.type === "percentage") {
        finalPrice =
          numericPrice - (numericPrice * discountValue) / 100;
      }

      if (discount.type === "flat") {
        finalPrice = numericPrice - discountValue;
      }

      return Math.max(0, Number(finalPrice.toFixed(2)));
    };

    const makeItemKey = (item) => {
      return `${item.menuItemId}_${item.variant || "default"}_${
        item.customizations || ""
      }`;
    };

module.exports = calculateDiscountedPrice;
