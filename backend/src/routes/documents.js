const express = require('express');
const multer = require('multer');
const DocumentController = require('../controllers/DocumentController');

const router = express.Router();

// Configure multer for memory storage (files handled in service)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// Routes
router.post('/upload', upload.single('file'), DocumentController.upload.bind(DocumentController));
router.get('/', DocumentController.list.bind(DocumentController));
router.patch('/:id/move', DocumentController.move.bind(DocumentController));
router.patch('/:id', DocumentController.rename.bind(DocumentController));
router.get('/:id/preview', DocumentController.getPreviewUrl.bind(DocumentController));
router.get('/:id/download', DocumentController.download.bind(DocumentController));
router.get('/:id/content', DocumentController.getContent.bind(DocumentController));
router.get('/:id', DocumentController.getById.bind(DocumentController));
router.delete('/:id', DocumentController.delete.bind(DocumentController));

module.exports = router;
