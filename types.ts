
export interface PhotoEntry {
  id: string;
  images?: string[]; // Optional: only present on client before upload
  imageUrl?: string; // Resolved URL served by backend
  caption: string;
  timestamp: number;
  author?: string;
  signature?: string; // Optional base64 signature
  rotation: number; // Random rotation for visual interest
}

export interface GeminiResponse {
  caption: string;
}
