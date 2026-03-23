const { v2: cloudinary } = require('cloudinary');

const getCloudinaryConfig = () => {
  const cloudinaryUrl = String(process.env.CLOUDINARY_URL || '').trim();
  if (cloudinaryUrl) {
    return { cloudinaryUrl };
  }

  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();

  if (cloudName && apiKey && apiSecret) {
    return { cloudName, apiKey, apiSecret };
  }

  return null;
};

let configured = false;
const ensureConfigured = () => {
  if (configured) return true;

  const cfg = getCloudinaryConfig();
  if (!cfg) return false;

  if (cfg.cloudinaryUrl) {
    cloudinary.config({ cloudinary_url: cfg.cloudinaryUrl });
  } else {
    cloudinary.config({
      cloud_name: cfg.cloudName,
      api_key: cfg.apiKey,
      api_secret: cfg.apiSecret,
      secure: true,
    });
  }

  configured = true;
  return true;
};

const isCloudinaryEnabled = () => {
  return ensureConfigured();
};

const uploadLocalFileToCloudinary = async ({ filePath, folder, originalName }) => {
  if (!ensureConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  const resolvedFolder = String(folder || process.env.CLOUDINARY_FOLDER || 'okkazo/chat-attachments');
  const displayName = String(originalName || '').trim();

  const result = await cloudinary.uploader.upload(filePath, {
    folder: resolvedFolder,
    resource_type: 'auto',
    use_filename: Boolean(displayName),
    filename_override: displayName || undefined,
    unique_filename: true,
  });

  return {
    url: result?.secure_url || result?.url,
    publicId: result?.public_id,
  };
};

module.exports = {
  isCloudinaryEnabled,
  uploadLocalFileToCloudinary,
};
