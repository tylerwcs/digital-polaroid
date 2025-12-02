import React, { useEffect, useState } from 'react';
import { getPhotos, deletePhoto, subscribeToUpdates, subscribeToDelete } from '../services/storageService';
import { PhotoEntry } from '../types';
import { useToast } from '../context/ToastContext';

const AdminView: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const { showToast } = useToast();

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
        <div className="text-zinc-400 text-sm">{photos.length} submissions</div>
      </header>

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

