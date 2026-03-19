const { cloudinary } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { isValidFileType, isValidFileSize, getFileExtension } = require('../utils/helpers');
const fs = require('fs');

/**
 * Upload file to Cloudinary
 */
const uploadFile = async (file, folder = 'vendor-documents') => {
  try {
    // Validate file type
    if (!isValidFileType(file.mimetype)) {
      throw new Error('Invalid file type. Only PDF, JPEG, and PNG files are allowed');
    }

    // Validate file size
    if (!isValidFileSize(file.size)) {
      throw new Error('File size exceeds maximum limit of 5MB');
    }

    // Determine if file is a PDF - PDFs need resource_type: 'raw'
    const isPdf = file.mimetype === 'application/pdf';
    
    // Upload to Cloudinary with appropriate options
    const uploadOptions = {
      folder: `${process.env.CLOUDINARY_FOLDER || 'okkazo'}/${folder}`,
      resource_type: isPdf ? 'raw' : 'image',
    };
    
    // Only apply image-specific optimizations for non-PDF files
    if (!isPdf) {
      uploadOptions.quality = 'auto';
      uploadOptions.fetch_format = 'auto';
    }
    
    const result = await cloudinary.uploader.upload(file.path, uploadOptions);

    logger.info('File uploaded to Cloudinary', {
      publicId: result.public_id,
      url: result.secure_url,
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
    };
  } catch (error) {
    logger.error('Error uploading file to Cloudinary:', error);
    throw error;
  } finally {
    // Best-effort cleanup of local temp file saved by multer
    try {
      if (file?.path) {
        await fs.promises.unlink(file.path);
      }
    } catch {
      // ignore
    }
  }
};

/**
 * Delete file from Cloudinary
 */
const deleteFile = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    logger.info('File deleted from Cloudinary', { publicId });
    return result;
  } catch (error) {
    logger.error('Error deleting file from Cloudinary:', error);
    throw error;
  }
};

module.exports = {
  uploadFile,
  deleteFile,
};
