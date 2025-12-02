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
  const [stage, setStage] = useState<'idle' | 'ejecting' | 'spotlight'>('idle');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      try {
        const compressedResult = await compressImage(file);
        setSelectedImage(compressedResult);
        setStage('ejecting');
        
        // Transition to spotlight after eject animation
        setTimeout(() => {
          setStage('spotlight');
        }, 1200);

      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not process image. Please try another.";
        console.error("Error processing image", error);
        showToast(message, "error");
      }
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = () => {
    setSelectedImage(null);
    setStage('idle');
    setCaption('');
  };

  const handleSubmit = async () => {
    // Require either an image OR a caption
    if (!selectedImage && !caption.trim()) {
       showToast("Take a photo or write a note first!", "error");
       return;
    }

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
      images: selectedImage ? [selectedImage] : [], 
      caption: caption || (selectedImage ? "Happy 50th Anniversary to HTT!" : "Just saying hi!"),
      timestamp: Date.now(),
      rotation: Math.random() * 6 - 3,
    };

    const result = await savePhoto(newPhoto);
    
    if (result.success) {
      setTimeout(() => {
        setIsUploading(false);
        setSelectedImage(null);
        setCaption('');
        setStage('idle');
        showToast("Posted to the wall!", "success");
      }, 500);
    } else {
      setIsUploading(false);
      showToast(result.error || "Could not save photo. Check connection.", "error");
    }
  };

  const triggerCamera = () => {
    fileInputRef.current?.click();
  };

  const canSubmit = (selectedImage || caption.trim().length > 0) && !isUploading;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 to-zinc-950 opacity-50 pointer-events-none" />
      
      {/* Spotlight Overlay */}
      <div 
        className={`fixed inset-0 bg-black/60 backdrop-blur-md z-40 transition-all duration-1000 pointer-events-none ${
          stage === 'spotlight' ? 'opacity-100' : 'opacity-0'
        }`} 
      />

      <div className={`relative z-10 flex flex-col items-center justify-center w-full max-w-lg h-screen transition-all duration-500 ${stage === 'spotlight' ? 'z-50' : ''}`}>
        
        {/* INTRO TEXT - Fades out when not idle */}
        <div className={`
           text-center mb-24 transition-all duration-700
           ${stage === 'idle' ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-10 pointer-events-none absolute'}
        `}>
           <h2 className="text-4xl font-marker text-white mb-2 tracking-wider transform -rotate-2">
             Share the Moments!
           </h2>
           <p className="text-zinc-400 text-sm max-w-xs mx-auto leading-relaxed">
             Upload all the photos taken today to the digital wall for everyone to see!
           </p>
        </div>

        {/* Camera & Photo Wrapper to keep them anchored together */}
        <div className="relative w-[320px] flex flex-col items-center">

          {/* GUIDANCE HINT - Only visible in idle */}
          <div className={`
            absolute -top-20 right-4 z-40 flex flex-col items-center
            transition-all duration-700 delay-300
            ${stage === 'idle' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}
          `}>
            <p className="font-marker text-2xl text-white -rotate-6 mb-[-10px] mr-0">
              Tap lens to snap!
            </p>
            <svg 
              className="w-16 h-16 text-white transform rotate-12 drop-shadow-md" 
              viewBox="0 0 100 100" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="3" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              {/* Hand-drawn style arrow pointing down-left towards the lens */}
              <path d="M80,10 C60,40 90,60 40,80" />
              <path d="M45,70 L40,80 L55,85" />
            </svg>
          </div>

          {/* CAMERA BODY */}
          <div className={`
              relative w-full bg-[#f3f3f3] rounded-[40px] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] pt-8 pb-12 px-6 flex flex-col items-center border-b-8 border-gray-300 z-30 
              transition-all duration-1000 ease-in-out transform origin-center
              ${stage === 'spotlight' ? 'scale-90 blur-sm grayscale brightness-50' : 'scale-100 blur-0 grayscale-0 brightness-100'}
          `}>
            
            {/* Top Row: Flash & Viewfinder */}
            <div className="w-full flex justify-between items-start mb-6 px-2">
              {/* Flash */}
              <div className={`
                w-24 h-12 bg-gray-800 rounded-xl border-2 border-gray-600 relative overflow-hidden
                ${isUploading ? 'animate-pulse bg-yellow-100/80' : ''}
              `}>
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent" />
                <div className="absolute inset-0 grid grid-cols-6 gap-0.5 opacity-30">
                  {[...Array(12)].map((_, i) => <div key={i} className="bg-white/20 rounded-sm" />)}
                </div>
              </div>
              
              {/* Viewfinder */}
              <div className="w-12 h-12 bg-[#1a1a1a] rounded-xl border-2 border-gray-700 flex items-center justify-center">
                  <div className="w-4 h-4 bg-black/50 rounded-full blur-sm" />
              </div>
            </div>

            {/* Main Feature Row */}
            <div className="relative w-full flex justify-center items-center">
              
              {/* Rainbow Stripe */}
              <div className="absolute left-1/2 -translate-x-1/2 top-full h-16 w-6 flex z-0">
                <div className="flex-1 bg-[#FF3B30]" /> {/* Red */}
                <div className="flex-1 bg-[#FF9500]" /> {/* Orange */}
                <div className="flex-1 bg-[#FFCC00]" /> {/* Yellow */}
                <div className="flex-1 bg-[#4CD964]" /> {/* Green */}
                <div className="flex-1 bg-[#5AC8FA]" /> {/* Blue */}
              </div>

            {/* LENS ASSEMBLY (Trigger) */}
            <div 
              onClick={triggerCamera}
              className="relative w-40 h-40 rounded-full bg-[#1a1a1a] border-[6px] border-[#2a2a2a] flex items-center justify-center cursor-pointer shadow-xl z-10 group active:scale-95 transition-transform animate-pulse-subtle"
            >
                {/* Lens Details */}
                <div className="w-32 h-32 rounded-full bg-black border border-gray-800 flex items-center justify-center relative overflow-hidden">
                    {/* Reflections */}
                    <div className="absolute top-6 right-6 w-8 h-4 bg-white/10 rounded-full rotate-45 blur-md" />
                    <div className="absolute bottom-8 left-8 w-4 h-2 bg-white/5 rounded-full rotate-45 blur-sm" />
                    
                    <div className="w-24 h-24 rounded-full bg-[#0a0a0a] border border-gray-800 flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-[#151515] shadow-inner" />
                    </div>
                    
                    {/* Hover Text */}
                    <div className="absolute inset-0 flex items-center justify-center transition-opacity opacity-100">
                      <span className="text-white text-xs font-medium tracking-wider animate-pulse">UPLOAD</span>
                    </div>
                </div>
              </div>

              {/* SHUTTER BUTTON (Decor only now) */}
              <div
                className={`
                  absolute right-2 bottom-0 translate-y-1/2
                  w-16 h-16 rounded-full bg-[#ff3b30] border-[6px] border-white shadow-lg
                  flex items-center justify-center
                  z-20 opacity-90
                `}
              >
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-transparent to-black/10" />
              </div>
            </div>

          {/* Bottom Slot - Increased Z-index to cover photo during ejection */}
          <div className="w-[290px] h-4 bg-[#1a1a1a] rounded-lg mt-12 shadow-inner relative z-30 border-b border-zinc-700" />

        </div>

          {/* POLAROID PHOTO (Preview) */}
          <div className={`
            absolute top-0 left-0 w-full flex flex-col items-center pointer-events-none
            transition-all duration-1000 ease-[cubic-bezier(0.34,1.56,0.64,1)]
            ${stage === 'idle' ? 'translate-y-12 opacity-0 z-10 scale-95' : ''}
            ${stage === 'ejecting' ? 'translate-y-[350px] opacity-100 z-20 scale-100' : ''}
            ${stage === 'spotlight' ? '-translate-y-24 z-50 scale-90 pointer-events-auto' : ''}
          `}>
            {/* Polaroid Card */}
            <div className="bg-white w-[280px] p-3 pb-12 shadow-2xl rotate-[-2deg] hover:rotate-0 transition-transform duration-300">
            {/* Photo Area */}
            <div className="w-full mb-4 bg-zinc-100 border border-gray-200 flex flex-col items-center justify-center relative overflow-hidden group">
              {selectedImage && (
                <>
                  <img src={selectedImage} alt="Preview" className="w-full h-auto block" />
                  <button 
                    onClick={removeImage}
                    className="absolute top-2 right-2 bg-black/50 hover:bg-red-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </>
              )}
            </div>

              {/* Caption Line */}
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write a note..."
                disabled={stage !== 'spotlight'}
                autoFocus={stage === 'spotlight'}
                className="w-full bg-transparent border-none focus:ring-0 outline-none text-gray-800 font-marker text-3xl text-center resize-none h-20 leading-tight placeholder:text-gray-300"
                maxLength={60}
              />
            </div>

            {/* Submit Button - Only visible in spotlight */}
            <div className={`
                mt-8 transition-all duration-500 delay-300
                ${stage === 'spotlight' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}
            `}>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white px-8 py-3 rounded-full font-bold text-lg shadow-lg hover:shadow-xl hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                  {isUploading ? 'Posting...' : 'Post to Wall'}
              </button>
            </div>
          </div>
          
        </div>
      
      </div>

      {/* Hidden Input */}
      <input 
        type="file" 
        accept="image/*" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        className="hidden" 
      />
    </div>
  );
};

export default UploadView;
