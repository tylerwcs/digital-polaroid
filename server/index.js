import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_PHOTO_HISTORY = parseInt(process.env.MAX_PHOTO_HISTORY || '150', 10);
const MAX_CONCURRENT_UPLOADS = parseInt(process.env.MAX_CONCURRENT_UPLOADS || '8', 10);
const MAX_IMAGE_MB = parseFloat(process.env.MAX_IMAGE_MB || '3');
const JSON_BODY_LIMIT_MB = parseFloat(process.env.JSON_BODY_LIMIT_MB || '5');
const SAVE_DEBOUNCE_MS = parseInt(process.env.SAVE_DEBOUNCE_MS || '1000', 10);
const ENABLE_DISK_CACHE = (process.env.ENABLE_DISK_CACHE || 'false').toLowerCase() === 'true';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const rawUploadPrefix = process.env.UPLOAD_URL_PREFIX || '/uploads';
const UPLOAD_URL_PREFIX = rawUploadPrefix.startsWith('/') ? rawUploadPrefix : `/${rawUploadPrefix}`;
const UPLOAD_URL_BASE = UPLOAD_URL_PREFIX !== '/' && UPLOAD_URL_PREFIX.endsWith('/')
  ? UPLOAD_URL_PREFIX.slice(0, -1)
  : UPLOAD_URL_PREFIX;

const MAX_IMAGE_BYTES = Math.floor(MAX_IMAGE_MB * 1024 * 1024);
const JSON_BODY_LIMIT = `${JSON_BODY_LIMIT_MB}mb`;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins for now (easier for mobile testing)
    methods: ["GET", "POST", "DELETE"]
  }
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'photos.json');

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(UPLOAD_URL_BASE, express.static(UPLOAD_DIR, {
  maxAge: 1000 * 60 * 5,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=300, immutable');
  }
}));

// In-memory cache
let photos = [];
let activeUploads = 0;
let saveTimer = null;
let savePending = false;
let shuttingDown = false;

const sanitizePhoto = (photo) => ({
  id: photo.id,
  caption: photo.caption,
  timestamp: photo.timestamp,
  rotation: photo.rotation,
  author: photo.author,
  imageUrl: photo.imageUrl,
  images: [],
});

const approxBytesFromDataUri = (dataUri = '') => {
  const [, base64 = ''] = dataUri.split(',');
  return Math.ceil((base64.length * 3) / 4);
};

const decodeBase64Image = (dataUri = '') => {
  const matches = dataUri.match(/^data:(.+);base64,(.+)$/);
  if (!matches) return null;
  const [, mime, base64] = matches;
  return {
    mime,
    buffer: Buffer.from(base64, 'base64'),
  };
};

const fullImagePath = (fileName) => path.join(UPLOAD_DIR, fileName);
const buildImageUrl = (fileName) => path.posix.join(UPLOAD_URL_BASE, fileName);

const deleteFileIfExists = async (fileName) => {
  if (!fileName) return;
  try {
    await fs.unlink(fullImagePath(fileName));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to remove file ${fileName}:`, error);
    }
  }
};

const trimPhotoHistory = async () => {
  if (photos.length <= MAX_PHOTO_HISTORY) return;
  const removed = photos.slice(MAX_PHOTO_HISTORY);
  photos = photos.slice(0, MAX_PHOTO_HISTORY);
  await Promise.all(removed.map((photo) => deleteFileIfExists(photo.storageFile)));
};

const normalizePhotoRecord = async (entry) => {
  if (!entry || typeof entry.id !== 'string') {
    return null;
  }

  let storageFile = entry.storageFile || null;

  if (!storageFile && Array.isArray(entry.images) && entry.images[0]) {
    const decoded = decodeBase64Image(entry.images[0]);
    if (decoded) {
      const extension = decoded.mime === 'image/png' ? 'png' : 'jpg';
      storageFile = `${entry.id}.${extension}`;
      try {
        await fs.writeFile(fullImagePath(storageFile), decoded.buffer);
      } catch (error) {
        console.error(`Failed to migrate inline image for ${entry.id}:`, error);
        storageFile = null;
      }
    }
  }

  return {
    id: entry.id,
    caption: typeof entry.caption === 'string' ? entry.caption : '',
    timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    rotation: typeof entry.rotation === 'number' ? entry.rotation : 0,
    author: entry.author,
    imageUrl: storageFile ? buildImageUrl(storageFile) : undefined,
    storageFile,
  };
};

const ensureUploadDir = async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to ensure upload directory exists:', error);
    throw error;
  }
};

// Load photos from disk (optional)
async function loadPhotos() {
  if (!ENABLE_DISK_CACHE) {
    photos = [];
    return;
  }

  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    const entries = Array.isArray(parsed) ? parsed : [];
    photos = [];

    for (const entry of entries) {
      const normalized = await normalizePhotoRecord(entry);
      if (normalized) {
        photos.push(normalized);
      }
    }

    await trimPhotoHistory();
    console.log(`Loaded ${photos.length} photos`);
  } catch (error) {
    console.log('No existing photos found, starting fresh');
    photos = [];
  }
}

// Save photos to disk (optional)
async function savePhotosToDisk() {
  if (!ENABLE_DISK_CACHE) return;
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(photos, null, 2));
  } catch (error) {
    console.error('Failed to save photos:', error);
  }
}

const scheduleSave = () => {
  if (!ENABLE_DISK_CACHE) return;
  savePending = true;
  if (saveTimer) return;

  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!savePending) return;
    savePending = false;
    await savePhotosToDisk();
  }, SAVE_DEBOUNCE_MS);
};

const flushPendingSaves = async () => {
  if (!ENABLE_DISK_CACHE) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (savePending) {
    savePending = false;
    await savePhotosToDisk();
  }
};

const gracefulShutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (ENABLE_DISK_CACHE) {
    console.log('Shutting down, flushing pending photo writes...');
    await flushPendingSaves();
  }
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

const validatePhotoPayload = (photo) => {
  if (!photo || typeof photo.id !== 'string') {
    return 'Invalid photo payload';
  }
  const images = Array.isArray(photo.images) ? photo.images : [];
  const [primaryImage] = images;
  if (primaryImage) {
    if (typeof primaryImage !== 'string' || !primaryImage.startsWith('data:image')) {
      return 'Unsupported image format';
    }

    const approxBytes = approxBytesFromDataUri(primaryImage);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return `Image exceeds ${MAX_IMAGE_MB}MB limit`;
    }
  }

  return null;
};

// API Routes
app.get('/api/photos', (req, res) => {
  res.json(photos.map(sanitizePhoto));
});

app.post('/api/photos', async (req, res) => {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    return res.status(429).json({ error: 'Server is busy. Please retry shortly.' });
  }

  activeUploads += 1;
  let storageFileName = null;

  try {
    const incomingPhoto = req.body;
    const validationError = validatePhotoPayload(incomingPhoto);
    
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const images = Array.isArray(incomingPhoto.images) ? incomingPhoto.images : [];
    const [primaryImage] = images;

    if (primaryImage) {
      const decodedImage = decodeBase64Image(primaryImage);
      if (!decodedImage) {
        return res.status(400).json({ error: 'Malformed image data' });
      }

      const extension = decodedImage.mime === 'image/png' ? 'png' : 'jpg';
      storageFileName = `${incomingPhoto.id}.${extension}`;
      await fs.writeFile(fullImagePath(storageFileName), decodedImage.buffer);
    }

    const storedPhoto = {
      id: incomingPhoto.id,
      caption: typeof incomingPhoto.caption === 'string' ? incomingPhoto.caption : '',
      timestamp: typeof incomingPhoto.timestamp === 'number' ? incomingPhoto.timestamp : Date.now(),
      rotation: typeof incomingPhoto.rotation === 'number' ? incomingPhoto.rotation : (Math.random() * 6 - 3),
      author: incomingPhoto.author,
      imageUrl: storageFileName ? buildImageUrl(storageFileName) : undefined,
      storageFile: storageFileName,
    };

    photos.unshift(storedPhoto);
    await trimPhotoHistory();

    // Save (debounced) and Broadcast
    scheduleSave();
    const publicPhoto = sanitizePhoto(storedPhoto);
    io.emit('new_photo', publicPhoto);
    
    return res.status(201).json({ success: true, photo: publicPhoto });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (storageFileName && photos.every((p) => p.storageFile !== storageFileName)) {
      // If we failed before storing reference, clean up the file
      await deleteFileIfExists(storageFileName);
    }
    activeUploads = Math.max(activeUploads - 1, 0);
  }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const photoToDelete = photos.find(p => p.id === id);
    if (!photoToDelete) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    photos = photos.filter(p => p.id !== id);
    await deleteFileIfExists(photoToDelete.storageFile);

    scheduleSave();
    io.emit('delete_photo', id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start server
await ensureUploadDir();
await loadPhotos();
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
