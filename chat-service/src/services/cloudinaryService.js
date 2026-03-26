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

const extractPublicIdFromUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (!/res\.cloudinary\.com$/i.test(parsed.hostname)) return null;

    const pathname = parsed.pathname || '';
    const uploadIdx = pathname.indexOf('/upload/');
    if (uploadIdx === -1) return null;

    const tail = pathname.slice(uploadIdx + '/upload/'.length);
    const parts = tail.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    // Remove optional version segment like v1712345678
    const withoutVersion = /^v\d+$/.test(parts[0]) ? parts.slice(1) : parts;
    if (withoutVersion.length === 0) return null;

    const joined = withoutVersion.join('/');
    const ext = joined.lastIndexOf('.');
    return ext > 0 ? joined.slice(0, ext) : joined;
  } catch {
    return null;
  }
};

const deleteCloudinaryAsset = async ({ publicId, url }) => {
  if (!ensureConfigured()) return { success: false, reason: 'not-configured' };

  const resolvedPublicId = String(publicId || '').trim() || extractPublicIdFromUrl(url);
  if (!resolvedPublicId) return { success: false, reason: 'no-public-id' };

  await cloudinary.uploader.destroy(resolvedPublicId, { resource_type: 'image', invalidate: true }).catch(() =>
    cloudinary.uploader.destroy(resolvedPublicId, { resource_type: 'video', invalidate: true })
  ).catch(() => cloudinary.uploader.destroy(resolvedPublicId, { resource_type: 'raw', invalidate: true }));

  return { success: true, publicId: resolvedPublicId };
};

module.exports = {
  isCloudinaryEnabled,
  uploadLocalFileToCloudinary,
  deleteCloudinaryAsset,
};
