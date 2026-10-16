
import { GoogleGenAI } from "@google/genai";

export interface InterpretedPrompt {
  searchQuery: string;
  keywords: string[];
  objectType: string;
  appearance: string[];
  style: string[];
}

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  return new GoogleGenAI({ apiKey });
}

export async function interpretPrompt(
  prompt: string,
): Promise<InterpretedPrompt> {
  const response = await getAIClient().models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Understand this 3D asset search request.
Return ONLY a JSON object with these fields:
- searchQuery: a concise search query for a 3D asset library
- keywords: an array of useful synonyms and search terms
- objectType: the main object being requested
- appearance: an array of visual requirements
- style: an array of style requirements

Do not invent technical properties that the user did not request.
User request: ${prompt}`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          searchQuery: { type: "STRING" },
          keywords: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
          objectType: { type: "STRING" },
          appearance: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
          style: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
        },
        required: [
          "searchQuery",
          "keywords",
          "objectType",
          "appearance",
          "style",
        ],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return JSON.parse(text) as InterpretedPrompt;
}
