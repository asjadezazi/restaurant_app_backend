function normalizeDiscount(discount) {
  if (!discount || discount.active === false) {
    return { type: null, value: 0, active: false };
  }

  // Validate type & value
  const type = ["percentage", "flat"].includes(discount.type)
    ? discount.type
    : null;
  const value = typeof discount.value === "number" && discount.value > 0 ? discount.value : 0;

  return { type, value, active: true };
}
module.exports = normalizeDiscount