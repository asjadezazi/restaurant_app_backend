// utils/calculateDiscountedPrice.js
const calculateDiscountedPrice = (price, discount) => {
  if (!discount || !discount.type || !discount.value) {
    return price;
  }

  if (discount.type === "percentage") {
    return Math.max(price - (price * discount.value) / 100, 0);
  }

  if (discount.type === "flat") {
    return Math.max(price - discount.value, 0);
  }

  return price;
};

module.exports = calculateDiscountedPrice;
