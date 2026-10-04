import { Router } from 'express';
import {
  getAllBranches,
  createBranch,
  updateBranch,
  getAllUsers,
  updateUserStatus,
  getAuditLogs,
  getAllConfigs,
  updateConfig,
} from '../controllers/adminController';

const router = Router();

// 1. Branch Management
router.get('/branches', getAllBranches);
router.post('/branches', createBranch);
router.patch('/branches/:id', updateBranch);

// 2. User Account Management
router.get('/users', getAllUsers);
router.patch('/users/:id/status', updateUserStatus);

// 3. Audit Review Screen
router.get('/audit-logs', getAuditLogs);

// 4. Policy & Billing Configuration Screens
router.get('/configs', getAllConfigs);
router.put('/configs/:key', updateConfig);

export default router;