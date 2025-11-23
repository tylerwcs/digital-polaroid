
export interface PhotoEntry {
  id: string;
  images: string[]; // Changed to support multiple images (Base64)
  caption: string;
  timestamp: number;
  author?: string;
  rotation: number; // Random rotation for visual interest
}

export interface GeminiResponse {
  caption: string;
}
