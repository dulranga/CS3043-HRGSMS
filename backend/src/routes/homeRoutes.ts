import express from 'express';
import { getStatus } from '../controllers/homeController';

const router = express.Router();

router.get('/', getStatus);

export default router;
