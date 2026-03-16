const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─── Shared uploads directory ─────────────────────────────────────────────────

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// ─── File filter — images only ────────────────────────────────────────────────

const imageFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extOk = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = /^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype);

  if (extOk && mimeOk) return cb(null, true);
  cb(new Error('Only JPEG, PNG, and WebP image files are allowed'));
};

// ─── Planning: single banner upload ──────────────────────────────────────────

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: imageFileFilter,
});

// ─── Promote: banner + multiple authenticity proof images ────────────────────

const promoteUpload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB per file
    files: 11, // 1 banner + up to 10 proofs
  },
  fileFilter: imageFileFilter,
}).fields([
  { name: 'eventBanner', maxCount: 1 },
  { name: 'authProofs', maxCount: 10 },
]);

module.exports = { upload, promoteUpload };
