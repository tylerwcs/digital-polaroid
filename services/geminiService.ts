import { GoogleGenAI, Type } from "@google/genai";

// For Vite apps, use a VITE_ env var so it can be injected at build time.
// In production (Render), set VITE_GEMINI_API_KEY on the Static Site.
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

// Initialize client safely
let aiClient: GoogleGenAI | null = null;
if (API_KEY) {
  aiClient = new GoogleGenAI({ apiKey: API_KEY });
}

export const generateCreativeCaption = async (
  images: string[], // Array of Base64 strings (might be empty)
  userContext: string
): Promise<string> => {
  if (!aiClient) {
    console.warn("No API Key found");
    return userContext || "Captured Moment";
  }

  try {
    const hasImages = images && images.length > 0;
    
    // Prepare prompt based on whether there is an image or just text
    let prompt = "";
    let parts: any[] = [];

    if (hasImages) {
        // Prepare image parts
        const imageParts = images.map(img => {
          const base64Data = img.split(',')[1] || img;
          return {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Data
            }
          };
        });
        
        prompt = `
          You are a witty and creative writer for a Polaroid photo wall. 
          The user has uploaded a photo and provided this context: "${userContext}".
          
          1. Analyze the image.
          2. If the user provided context, enhance it to be punchier, funnier, or more poetic.
          3. If no context is provided, write a short, fun 1-sentence caption based on what you see.
          4. The style should be handwritten note style (informal, warm, maybe a bit cheeky).
          5. MAX 15 words. Do not use hashtags. Do not use quotes.
        `;

        parts = [...imageParts, { text: prompt }];

    } else {
        // Text only mode
        prompt = `
          You are a witty writer for a community message board.
          The user posted this message: "${userContext}".

          1. Enhance the message to be punchier, funnier, or more poetic.
          2. Keep the original meaning but make it sound like a cool handwritten note.
          3. The style should be informal, warm, and fun.
          4. MAX 15 words. Do not use hashtags. Do not use quotes.
        `;

        parts = [{ text: prompt }];
    }

    const response = await aiClient.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: parts
      }
    });

    return response.text?.trim() || userContext;
  } catch (error) {
    console.error("Gemini generation failed", error);
    return userContext || "Snap!";
  }
};

export const validateCaption = async (text: string): Promise<{ isValid: boolean; reason?: string }> => {
  if (!text.trim()) return { isValid: true };
  
  if (!aiClient) {
    // Fail open if no API key is configured
    return { isValid: true };
  }

  try {
    const response = await aiClient.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
        Analyze the following text for:
        1. Profanity or curse words.
        2. Hate speech or offensive language.
        3. Gibberish (random meaningless characters like "asdfghj", ".....", or keyboard smashing).
        4. Dirty words or inappropriate sexual references.

        Text to analyze: "${text}"
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isValid: {
              type: Type.BOOLEAN,
              description: "True if the text is clean, meaningful, and safe to post. False otherwise.",
            },
            reason: {
              type: Type.STRING,
              description: "A short, user-friendly explanation of why it was rejected (e.g., 'Contains profanity', 'Looks like gibberish').",
            },
          },
        },
      },
    });

    const resultText = response.text;
    if (!resultText) return { isValid: true };

    const result = JSON.parse(resultText);
    return {
      isValid: result.isValid,
      reason: result.reason
    };
  } catch (error) {
    console.error("Validation failed", error);
    // Fail open on error to not block users if AI is down
    return { isValid: true };
  }
};