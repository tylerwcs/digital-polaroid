import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images

// In-memory cache
let photos = [];

// Load photos from disk
async function loadPhotos() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    photos = JSON.parse(data);
    console.log(`Loaded ${photos.length} photos`);
  } catch (error) {
    console.log('No existing photos found, starting fresh');
    photos = [];
  }
}

// Save photos to disk
async function savePhotosToDisk() {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(photos, null, 2));
  } catch (error) {
    console.error('Failed to save photos:', error);
  }
}

// API Routes
app.get('/api/photos', (req, res) => {
  res.json(photos);
});

app.post('/api/photos', async (req, res) => {
  try {
    const newPhoto = req.body;
    
    // Basic validation
    if (!newPhoto || !newPhoto.id) {
      return res.status(400).json({ error: 'Invalid photo data' });
    }

    // Add to beginning of array
    photos.unshift(newPhoto);
    
    // Keep only last 50
    if (photos.length > 50) {
      photos = photos.slice(0, 50);
    }

    // Save and Broadcast
    await savePhotosToDisk();
    io.emit('new_photo', newPhoto);
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const initialLength = photos.length;
    photos = photos.filter(p => p.id !== id);

    if (photos.length === initialLength) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    await savePhotosToDisk();
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
await loadPhotos();
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
