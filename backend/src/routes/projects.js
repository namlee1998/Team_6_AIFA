const express = require('express');
const ProjectController = require('../controllers/ProjectController');

const router = express.Router();

router.get('/', ProjectController.list.bind(ProjectController));
router.post('/', ProjectController.create.bind(ProjectController));
router.patch('/:id', ProjectController.rename.bind(ProjectController));
router.delete('/:id', ProjectController.delete.bind(ProjectController));

module.exports = router;
