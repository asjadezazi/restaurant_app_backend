const normalizeDiscount = (discount) => {
  if (!discount) {
    return {
      type: null,
      value: 0,
      active: false,
    };
  }

  // Ensure type is either "flat", "percentage", or null
  const discountType = discount.type === "flat" || discount.type === "percentage" 
    ? discount.type 
    : null;

  // Parse value safely
  let discountValue = 0;
  if (discount.value !== undefined && discount.value !== null) {
    const parsed = Number(discount.value);
    discountValue = isNaN(parsed) ? 0 : parsed;
  }

  // Check if discount is active
  const isActive = Boolean(discount.active) && discountValue >= 0;

  return {
    type: discountType,
    value: discountValue,
    active: isActive,
  };
};

module.exports = normalizeDiscount;