const QRCode = require("qrcode");
const { createCanvas, loadImage } = require("canvas");
const { uploadToCloudinary } = require("../utils/cloudinary"); // adjust path

const generateAndUploadQR = async (domain, logoPath) => {
  if (!domain) throw new Error("Domain is required");

  const size = 1000;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Generate QR
  await QRCode.toCanvas(canvas, `https://${domain}`, {
    errorCorrectionLevel: "H",
    width: size,
  });

  const logo = await loadImage(logoPath);

  // Maintain aspect ratio
  const aspectRatio = logo.width / logo.height;
  const maxLogoSize = size * 0.2;

  let drawWidth, drawHeight;

  if (logo.width > logo.height) {
    drawWidth = maxLogoSize;
    drawHeight = maxLogoSize / aspectRatio;
  } else {
    drawHeight = maxLogoSize;
    drawWidth = maxLogoSize * aspectRatio;
  }
  
  // Center position
  const x = (size - drawWidth) / 2;
  const y = (size - drawHeight) / 2;

  //Circular white background
  const padding = 20;
  const radius = Math.max(drawWidth, drawHeight) / 2 + padding;
  const centerX = size / 2;
  const centerY = size / 2;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();

  // Draw logo (no distortion)
  ctx.drawImage(logo, x, y, drawWidth, drawHeight);

  //Convert canvas → buffer
  const buffer = canvas.toBuffer("image/png");

  //Upload to cloudinary
  const uploadResult = await uploadToCloudinary(buffer);

  return {
    url: uploadResult.secure_url,
    public_id: uploadResult.public_id,
  };
};

module.exports = generateAndUploadQR;
