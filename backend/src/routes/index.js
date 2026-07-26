const express = require('express');
const documentRoutes = require('./documents');
const projectRoutes = require('./projects');
const folderRoutes = require('./folders');
const treeRoutes = require('./tree');
const sdlcRoutes = require('./sdlc');
const sessionRoutes = require('./sessions');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Protected routes
router.use('/documents',   authMiddleware, documentRoutes);
router.use('/projects',    authMiddleware, projectRoutes);
router.use('/folders',     authMiddleware, folderRoutes);
router.use('/tree',        authMiddleware, treeRoutes);
router.use('/sdlc',        authMiddleware, sdlcRoutes);     // ← AIDLC routes
router.use('/sessions',    authMiddleware, sessionRoutes);

module.exports = router;
