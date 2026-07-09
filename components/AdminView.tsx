import React, { useEffect, useRef, useState } from 'react';
import { getPhotos, deletePhoto, subscribeToUpdates, subscribeToDelete, downloadAllPhotos, getWallSettings, saveWallSettings, subscribeToSettings } from '../services/storageService';
import { PhotoEntry, WallSettings, WALL_SETTINGS_DEFAULTS, WALL_SETTINGS_BOUNDS } from '../types';
import { useToast } from '../context/ToastContext';

const AdminView: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const { showToast } = useToast();
  const [settings, setSettings] = useState<WallSettings>(WALL_SETTINGS_DEFAULTS);
  const saveTimer = useRef<number>();

  // Simple hardcoded password for demo purposes
  const ADMIN_PASSWORD = "admin"; 

  useEffect(() => {
    if (isAuthenticated) {
      loadPhotos();

      const unsubscribeUpdates = subscribeToUpdates((newPhoto) => {
        setPhotos(prev => [newPhoto, ...prev]);
      });

      const unsubscribeDelete = subscribeToDelete((deletedId) => {
        setPhotos(prev => prev.filter(p => p.id !== deletedId));
      });

      return () => {
        unsubscribeUpdates();
        unsubscribeDelete();
      };
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    getWallSettings().then(setSettings);
    const unsubscribe = subscribeToSettings(setSettings);
    return unsubscribe;
  }, [isAuthenticated]);

  const persistSettings = (next: WallSettings) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveWallSettings(next);
    }, 300);
  };

  const updateSettings = (patch: Partial<WallSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      persistSettings(next);
      return next;
    });
  };

  const handleResetSettings = () => {
    window.clearTimeout(saveTimer.current);
    setSettings(WALL_SETTINGS_DEFAULTS);
    saveWallSettings(WALL_SETTINGS_DEFAULTS);
  };

  const loadPhotos = async () => {
    const loadedPhotos = await getPhotos();
    setPhotos(loadedPhotos);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      showToast("Invalid password", "error");
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this submission?")) {
      const success = await deletePhoto(id);
      if (success) {
        showToast("Photo deleted", "success");
        // Optimistic update is handled by socket subscription, but we can do it here too to be safe
        setPhotos(prev => prev.filter(p => p.id !== id));
      } else {
        showToast("Failed to delete photo", "error");
      }
    }
  };

  const handleDownloadAll = async () => {
    setIsDownloading(true);
    const result = await downloadAllPhotos();
    setIsDownloading(false);

    if (!result.success) {
      showToast(result.error || 'Failed to download photos', 'error');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-zinc-900 p-8 rounded-xl shadow-xl w-full max-w-md border border-zinc-800">
          <h1 className="text-2xl font-bold text-white mb-6 text-center">Admin Login</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            className="w-full bg-zinc-950 text-white border border-zinc-700 rounded-lg p-3 mb-4 focus:border-blue-500 outline-none"
          />
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <header className="mb-8 flex justify-between items-center max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <div className="flex items-center gap-4">
          <div className="text-zinc-400 text-sm">{photos.length} submissions</div>
          <button
            type="button"
            onClick={handleDownloadAll}
            disabled={photos.length === 0 || isDownloading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {isDownloading ? 'Preparing ZIP...' : 'Download All Photos'}
          </button>
        </div>
      </header>

      <section className="max-w-6xl mx-auto mb-8 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Wall-6 Display Settings</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-zinc-400">Columns (max): {settings.maxColumns}</span>
            <input
              type="number"
              min={WALL_SETTINGS_BOUNDS.maxColumns.min}
              max={WALL_SETTINGS_BOUNDS.maxColumns.max}
              value={settings.maxColumns}
              onChange={(e) => updateSettings({ maxColumns: Number(e.target.value) })}
              className="mt-2 w-full bg-zinc-950 text-white border border-zinc-700 rounded-lg p-2 focus:border-blue-500 outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm text-zinc-400">Polaroid size: {settings.polaroidWidth}px</span>
            <input
              type="range"
              min={WALL_SETTINGS_BOUNDS.polaroidWidth.min}
              max={WALL_SETTINGS_BOUNDS.polaroidWidth.max}
              value={settings.polaroidWidth}
              onChange={(e) => updateSettings({ polaroidWidth: Number(e.target.value) })}
              className="mt-4 w-full accent-blue-600"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={handleResetSettings}
          className="mt-4 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          Reset to defaults
        </button>
      </section>

      <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {photos.map((photo) => {
          const previewImage = photo.imageUrl || (photo.images && photo.images[0]) || '';
          return (
          <div key={photo.id} className="bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 group relative">
            {previewImage ? (
              <div className="aspect-square relative">
                 <img 
                  src={previewImage} 
                  alt="Submission" 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                        onClick={() => handleDelete(photo.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transform scale-95 hover:scale-105 transition-all"
                    >
                        Delete
                    </button>
                </div>
              </div>
            ) : (
               <div className="aspect-square relative flex items-center justify-center bg-zinc-800 p-4">
                  <p className="text-zinc-300 text-center font-marker text-lg break-words w-full">
                     {photo.caption}
                  </p>
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                        onClick={() => handleDelete(photo.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transform scale-95 hover:scale-105 transition-all"
                    >
                        Delete
                    </button>
                </div>
               </div>
            )}
            <div className="p-4">
              <p className="text-zinc-300 text-sm mb-2 line-clamp-2 font-marker">
                {photo.caption}
              </p>
              <p className="text-zinc-500 text-xs">
                {new Date(photo.timestamp).toLocaleString()}
              </p>
            </div>
            </div>
        )})}
      </div>
    </div>
  );
};

export default AdminView;

