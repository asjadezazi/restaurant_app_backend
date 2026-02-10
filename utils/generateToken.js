const jwt = require("jsonwebtoken");

const generateToken = (id, role, restaurantId = null, createdBy = null) => {
  return jwt.sign(
    { id, role, restaurantId, createdBy },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
};

module.exports = generateToken;