import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { compressImage, savePhoto } from '../services/storageService';
import { validateCaption } from '../services/geminiService';
import { PhotoEntry } from '../types';
import { useToast } from '../context/ToastContext';

const UploadView: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  
  // Store single base64 string
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      try {
        const compressedResult = await compressImage(file);
        setSelectedImage(compressedResult);
      } catch (error) {
        console.error("Error processing image", error);
        showToast("Could not process image. Please try another.", "error");
      }
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = () => {
    setSelectedImage(null);
  };

  const handleSubmit = async () => {
    // Require either an image OR a caption
    if (!selectedImage && !caption.trim()) return;

    setIsUploading(true);

    // AI Validation
    if (caption.trim()) {
      try {
        const validation = await validateCaption(caption);
        if (!validation.isValid) {
          setIsUploading(false);
          showToast(validation.reason || "This message cannot be posted.", "error");
          return;
        }
      } catch (e) {
        console.error("Validation error", e);
        // Continue if validation fails (fail open logic handled in service, but safety catch here)
      }
    }
    
    const newPhoto: PhotoEntry = {
      id: Date.now().toString(),
      images: selectedImage ? [selectedImage] : [], // Empty array if no image
      caption: caption || (selectedImage ? "Happy 50th Anniversary to HTT!" : "Just saying hi!"),
      timestamp: Date.now(),
      rotation: Math.random() * 6 - 3,
    };

    savePhoto(newPhoto);
    
    setTimeout(() => {
      setIsUploading(false);
      setSelectedImage(null);
      setCaption('');
      showToast("Posted to the wall!", "success");
    }, 500);
  };

  const triggerCamera = () => {
    fileInputRef.current?.click();
  };

  const canSubmit = (selectedImage || caption.trim().length > 0) && !isUploading;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 flex flex-col max-w-md mx-auto font-sans">
      <header className="mb-6 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          SnapWall
        </h1>
        <button 
          onClick={() => navigate('/wall')}
          className="text-xs text-zinc-500 hover:text-white underline transition-colors"
        >
          View Wall
        </button>
      </header>

      <main className="flex-grow flex flex-col gap-6">
        {/* Image Preview Area */}
        <div className="flex flex-col gap-4">
          <div 
            onClick={!selectedImage ? triggerCamera : undefined}
            className={`
              relative w-full rounded-2xl border-2 border-dashed 
              flex flex-col items-center justify-center transition-all overflow-hidden group
              ${selectedImage ? 'border-transparent' : 'aspect-[4/5] border-zinc-700 hover:border-zinc-500 bg-zinc-900/50 cursor-pointer'}
            `}
          >
            {selectedImage ? (
              <>
                <img 
                  src={selectedImage} 
                  alt="Preview" 
                  className="w-full h-auto block" 
                />
                <button
                  onClick={(e) => { e.stopPropagation(); removeImage(); }}
                  className="absolute top-4 right-4 bg-zinc-900/80 text-white p-2 rounded-full hover:bg-red-500/80 transition-colors shadow-lg backdrop-blur-sm"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </>
            ) : (
              <div className="text-center p-6">
                <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-zinc-700 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-zinc-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                  </svg>
                </div>
                <p className="text-zinc-300 font-medium">Tap to take a photo</p>
                <p className="text-xs text-zinc-500 mt-2">(Optional)</p>
              </div>
            )}
            
            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
              className="hidden" 
              multiple={false}
            />
          </div>
        </div>

        {/* Caption Area */}
        <div className="space-y-4">
          <div className="relative">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={selectedImage ? "Write a caption..." : "Write a message..."}
              maxLength={selectedImage ? 60 : 100} 
              className="w-full bg-zinc-900 text-white rounded-xl p-4 pr-12 focus:ring-2 focus:ring-white/50 border border-transparent focus:border-zinc-700 outline-none resize-none h-24 font-marker text-2xl placeholder:text-zinc-600 transition-all"
            />
            <div className="absolute bottom-3 right-3 text-xs text-zinc-600">
              {caption.length}/{selectedImage ? 60 : 100}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`
              w-full bg-white text-zinc-950 rounded-xl py-3 font-bold shadow-lg shadow-zinc-900/20
              disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200 transition-all hover:shadow-white/10
            `}
          >
            {isUploading ? 'Posting...' : 'Post to Wall'}
          </button>
        </div>
      </main>
    </div>
  );
};

export default UploadView;