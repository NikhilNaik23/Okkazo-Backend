const { cloudinary } = require('../config/cloudinary');
const logger = require('../utils/logger');
const fs = require('fs');

/**
 * Allowed image MIME types for event banners
 */
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Min / Max file sizes for event banners
 */
const MIN_FILE_SIZE = 5 * 1024;        // 5 KB (reasonable min for an image)
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Upload an event banner image to Cloudinary
 * @param {Object} file - Multer file object
 * @param {string} subfolder - Subfolder within the configured Cloudinary folder
 * @returns {{ url: string, publicId: string, format: string, sizeBytes: number, mimeType: string }}
 */
const uploadBanner = async (file, subfolder = 'banners') => {
  try {
    // Validate file type
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed for event banners');
    }

    // Validate file size
    if (file.size < MIN_FILE_SIZE) {
      throw new Error('File is too small. Minimum size is 5 KB');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('File size exceeds maximum limit of 50 MB');
    }

    // Upload to Cloudinary with image-specific optimizations
    const result = await cloudinary.uploader.upload(file.path, {
      folder: `${process.env.CLOUDINARY_FOLDER || 'okkazo/events'}/${subfolder}`,
      resource_type: 'image',
      quality: 'auto',
      fetch_format: 'auto',
      transformation: [
        { width: 1920, crop: 'limit' }, // Cap width at 1920px, preserve aspect ratio
      ],
    });

    logger.info('Event banner uploaded to Cloudinary', {
      publicId: result.public_id,
      url: result.secure_url,
      format: result.format,
      bytes: result.bytes,
    });

    // Clean up temp file
    cleanupTempFile(file.path);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      sizeBytes: file.size,
      mimeType: file.mimetype,
    };
  } catch (error) {
    // Clean up temp file on error too
    cleanupTempFile(file.path);
    logger.error('Error uploading event banner to Cloudinary:', error);
    throw error;
  }
};

/**
 * Delete an event banner from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 */
const deleteBanner = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    logger.info('Event banner deleted from Cloudinary', { publicId });
    return result;
  } catch (error) {
    logger.error('Error deleting event banner from Cloudinary:', error);
    throw error;
  }
};

/**
 * Remove temporary file from disk
 */
const cleanupTempFile = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.warn('Failed to clean up temp file:', err.message);
  }
};

module.exports = {
  uploadBanner,
  deleteBanner,
};
