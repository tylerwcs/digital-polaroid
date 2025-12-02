import { GoogleGenAI, Type } from "@google/genai";

// For Vite apps, use a VITE_ env var so it can be injected at build time.
// In production (Render), set VITE_GEMINI_API_KEY on the Static Site.
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

// Initialize client safely
let aiClient: GoogleGenAI | null = null;
if (API_KEY) {
  aiClient = new GoogleGenAI({ apiKey: API_KEY });
}

export const validateCaption = async (text: string): Promise<{ isValid: boolean; reason?: string }> => {
  if (!text.trim()) return { isValid: true };
  
  if (!aiClient) {
    // Fail open if no API key is configured
    return { isValid: true };
  }

  try {
    const response = await aiClient.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `
        Analyze the following text strictly for:
        1. Profanity or curse words.
        2. Hate speech or offensive language.
        3. Gibberish (random meaningless characters like "asdfghj", ".....", or keyboard smashing).
        4. Dirty words, insults or inappropriate sexual references.

        If the text contains any of the above, set isValid to false.

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
