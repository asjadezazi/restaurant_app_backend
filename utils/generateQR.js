const QRCode = require("qrcode");
const { createCanvas, loadImage } = require("canvas");
const { uploadToCloudinary } = require("../utils/cloudinary");

const generateAndUploadQR = async (
  domain,
  logoPath,
  unitName = null,
  unitType = null
) => {
  if (!domain) {
    throw new Error("Domain is required");
  }

  const qrSize = 1000;
  const labelHeight = unitName ? 120 : 0;

  // Final canvas (QR + label area)
  const canvas = createCanvas(
    qrSize,
    qrSize + labelHeight
  );

  const ctx = canvas.getContext("2d");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  // Generate QR on separate canvas
  const qrCanvas = createCanvas(
    qrSize,
    qrSize
  );

  await QRCode.toCanvas(
    qrCanvas,
    domain.startsWith("http")
      ? domain
      : `https://${domain}`,
    {
      errorCorrectionLevel: "H",
      width: qrSize,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    }
  );

  // Draw QR into top section
  ctx.drawImage(
    qrCanvas,
    0,
    0
  );

  // Draw Logo
  if (logoPath) {
    const logo = await loadImage(logoPath);

    const aspectRatio =
      logo.width / logo.height;

    const maxLogoSize = qrSize * 0.2;

    let drawWidth;
    let drawHeight;

    if (logo.width > logo.height) {
      drawWidth = maxLogoSize;
      drawHeight =
        maxLogoSize / aspectRatio;
    } else {
      drawHeight = maxLogoSize;
      drawWidth =
        maxLogoSize * aspectRatio;
    }

    const x =
      (qrSize - drawWidth) / 2;

    const y =
      (qrSize - drawHeight) / 2;

    const padding = 20;

    const radius =
      Math.max(drawWidth, drawHeight) / 2 +
      padding;

    const centerX = qrSize / 2;
    const centerY = qrSize / 2;

    // White circular background
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(
      centerX,
      centerY,
      radius,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Draw logo
    ctx.drawImage(
      logo,
      x,
      y,
      drawWidth,
      drawHeight
    );
  }

  // Draw Unit Name / Type
  if (unitName) {
    // Label background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      0,
      qrSize,
      qrSize,
      labelHeight
    );

    // Separator line
    ctx.strokeStyle = "#cccccc";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(0, qrSize);
    ctx.lineTo(qrSize, qrSize);
    ctx.stroke();

    // Text
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 72px Arial";

    const label = unitType
      ? `${unitType} - ${unitName}`
      : unitName;

    ctx.fillText(
      label,
      qrSize / 2,
      qrSize + labelHeight / 2
    );
  }

  const buffer = canvas.toBuffer(
    "image/png"
  );

  const uploadResult =
    await uploadToCloudinary(buffer);

  return {
    url: uploadResult.secure_url,
    public_id: uploadResult.public_id,
  };
};

module.exports = generateAndUploadQR;