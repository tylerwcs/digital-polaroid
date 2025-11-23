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

    const success = await savePhoto(newPhoto);
    
    if (success) {
      setTimeout(() => {
        setIsUploading(false);
        setSelectedImage(null);
        setCaption('');
        showToast("Posted to the wall!", "success");
      }, 500);
    } else {
      setIsUploading(false);
      showToast("Could not save photo. Check connection.", "error");
    }
  };

  const triggerCamera = () => {
    fileInputRef.current?.click();
  };

  const canSubmit = (selectedImage || caption.trim().length > 0) && !isUploading;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 flex flex-col max-w-md mx-auto font-sans">
      <header className="mb-6 flex justify-between items-center">
        <h1 className="text-xl font-bold text-white tracking-tight">
          SnapWall
        </h1>
      </header>

      <main className="flex-grow flex flex-col gap-6">
        {/* Intro / Guide */}
        <div className="text-center space-y-1 px-4">
          <p className="text-zinc-300 font-medium"> 🌟 Share your moment 🌟</p>
          <p className="text-sm text-zinc-500">
            Upload a photo or leave a message for everyone to see.
          </p>
        </div>

        {/* Image Preview Area */}
        <div className="flex flex-col gap-3 items-center">
          <div 
            onClick={!selectedImage ? triggerCamera : undefined}
            className={`
              relative w-64 rounded-xl border-2 border-dashed 
              flex flex-col items-center justify-center transition-all overflow-hidden group
              ${selectedImage ? 'border-transparent' : 'aspect-square border-zinc-700 hover:border-zinc-500 bg-zinc-900/50 cursor-pointer'}
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
              <div className="text-center p-4">
                <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:bg-zinc-700 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-zinc-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                  </svg>
                </div>
                <p className="text-zinc-300 text-sm font-medium">Upload a photo</p>
                <p className="text-xs text-zinc-500 mt-1">(Optional)</p>
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
        <div className="space-y-6 flex flex-col items-center">
          <div className="relative w-80">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={selectedImage ? "Write a caption..." : "Write a message..."}
              maxLength={selectedImage ? 60 : 100} 
              className="w-full bg-zinc-900 text-white rounded-xl p-3 pr-12 focus:ring-2 focus:ring-white/50 border border-transparent focus:border-zinc-700 outline-none resize-none h-20 font-marker text-xl placeholder:text-zinc-600 transition-all"
            />
            <div className="absolute bottom-2 right-3 text-xs text-zinc-600">
              {caption.length}/{selectedImage ? 60 : 100}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`
              w-48 bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white rounded-xl py-3 font-bold shadow-lg shadow-red-900/20
              disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-all hover:shadow-red-500/20 transform hover:-translate-y-1
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