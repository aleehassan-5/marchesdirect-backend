import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import {
  registerCompanyAndUser,
  loginUser,
  refreshAccessToken,
  requestPasswordReset,
  resetPassword,
  enableMFA,
  verifyMFASetup,
  verifyMFALogin,
} from '../services/authService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// POST /api/auth/register
router.post(
  '/register',
  [
    body('companyName').notEmpty().trim(),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const result = await registerCompanyAndUser(req.body);
      res.status(201).json(result);
    } catch (err: any) {
      logger.error('Register route error:', err);
      res.status(400).json({ error: err.message || 'Registration failed' });
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const result = await loginUser(req.body.email, req.body.password);
      res.json(result);
    } catch (err: any) {
      logger.error('Login route error:', err);
      res.status(401).json({ error: err.message || 'Login failed' });
    }
  }
);

// POST /api/auth/mfa/verify-login
router.post('/mfa/verify-login', async (req: Request, res: Response) => {
  try {
    const { userId, mfaToken } = req.body;
    const result = await verifyMFALogin(userId, mfaToken);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'MFA verification failed' });
  }
});

// POST /api/auth/mfa/enable (requires auth)
router.post('/mfa/enable', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await enableMFA(req.user!.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'MFA setup failed' });
  }
});

// POST /api/auth/mfa/confirm (requires auth)
router.post('/mfa/confirm', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await verifyMFASetup(req.user!.id, req.body.mfaToken);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'MFA confirmation failed' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const result = await refreshAccessToken(req.body.refreshToken);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Token refresh failed' });
  }
});

// POST /api/auth/password-reset/request
router.post('/password-reset/request', [body('email').isEmail()], async (req: Request, res: Response) => {
  try {
    const result = await requestPasswordReset(req.body.email);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Password reset request failed' });
  }
});

// POST /api/auth/password-reset/confirm (requires auth after reset link click flow)
router.post('/password-reset/confirm', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await resetPassword(req.user!.id, req.body.newPassword);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Password reset failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  res.json({ user: req.user, company: req.company });
});

export default router;
