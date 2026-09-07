const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/socialFeedController');
const { verifyToken } = require('../middlewares/auth');

const router = express.Router();
const feedWriteLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'تم تجاوز محاولات جدار التواصل، حاول لاحقاً' } });

router.use(verifyToken);
router.get('/', controller.listPosts);
router.post('/', feedWriteLimit, controller.createPost);
router.post('/upload-image', feedWriteLimit, controller.uploadImage);
router.post('/:postId/like', feedWriteLimit, controller.toggleLike);
router.post('/:postId/save', feedWriteLimit, controller.toggleSave);
router.post('/:postId/share', feedWriteLimit, controller.sharePost);
router.post('/:postId/pin', feedWriteLimit, controller.togglePin);
router.post('/:postId/comments', feedWriteLimit, controller.addComment);
router.put('/:postId', feedWriteLimit, controller.updatePost);
router.delete('/:postId', feedWriteLimit, controller.deletePost);
router.post('/:postId/report', feedWriteLimit, controller.reportPost);

module.exports = router;