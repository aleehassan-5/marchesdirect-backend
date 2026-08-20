import { Router, Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { uploadCompanyFile, validateUpload, UploadValidationError } from '../services/storageService';
import { logger } from '../utils/logger';

const router = Router();

// Memory storage: files are validated and streamed to S3/disk in the handler,
// never trusted to disk unvalidated first.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// POST /api/uploads - upload a single file, returns the URL to store on a
// company_documents / company_certifications record.
router.post('/', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided (expected multipart field "file")' });
    }

    validateUpload(req.file);

    const { url, sizeBytes } = await uploadCompanyFile(
      req.user!.companyId,
      req.file.originalname,
      req.file.mimetype,
      req.file.buffer
    );

    res.status(201).json({ url, sizeBytes, mimeType: req.file.mimetype, originalName: req.file.originalname });
  } catch (err: any) {
    if (err instanceof UploadValidationError) {
      return res.status(400).json({ error: err.message });
    }
    logger.error('File upload error:', err);
    res.status(500).json({ error: "Échec de l'envoi du fichier" });
  }
});

export default router;
