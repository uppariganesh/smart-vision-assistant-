import { GoogleGenAI, Type } from "@google/genai";

export interface DetectionResult {
  alerts: {
    type: "obstacle" | "drop" | "rise" | "clear";
    label: string;
    position: "left" | "center" | "right";
    distance: string;
    urgency: "high" | "medium" | "low";
  }[];
  summary: string;
  peopleDetected?: {
    name: string;
    confidence: number;
    position: "left" | "center" | "right";
  }[];
  phoneDetected?: {
    detected: boolean;
    distance: string;
    position: "left" | "center" | "right";
  };
  depthMap?: {
    grid: number[][]; // 3x3 grid of distances in meters
    description: string; // Spatial description of the layout
  };
}

export class VisionService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async analyzeFrame(base64Image: string): Promise<DetectionResult> {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image,
              },
            },
            {
              text: "CRITICAL TASK: You are a professional vision assistant for a blind person. Analyze this camera frame with EXTREME CAUTION and precision. 1. Identify ANY obstacles (furniture, people, walls, objects) in the path. 2. Detect ANY drops (stairs down, edges, holes). 3. Detect ANY rises (steps, stairs up). 4. For each, specify if it is Left, Center, or Right. 5. Estimate distance in meters (e.g., '0.5 meters', '1 meter', '2 meters', '5 meters'). Be as accurate as possible. 6. If an obstacle is within 1 meter or a 'drop' is detected, set urgency to 'high'. If the path is completely clear, return one alert with type 'clear'. 7. GENERATE A 3D DEPTH MAP: Create a 3x3 grid representing the scene (Top-Left to Bottom-Right). Each cell should contain the estimated distance in meters to the nearest surface in that zone. Also provide a brief spatial description of the layout (e.g., 'Open path on the left, wall on the right'). 8. PROFESSIONAL PERSON RECOGNITION: The user has identified three specific people: 'Vaibhav', 'Akshay Kumar', and 'Ganesh'. \n- 'Vaibhav' is often seen on the far left; he typically wears a green or grey patterned hoodie.\n- 'Akshay Kumar' is often in the middle; he typically wears a pink shirt with a yellow/pink stole or scarf.\n- 'Ganesh' is often on the right; he typically wears a brown and white checkered shirt.\nIf you detect any of these individuals with high confidence based on their position and clothing, you MUST include them in the 'peopleDetected' array with their 'name', 'confidence', and 'position' (left, center, right). 9. PHONE DETECTION: If you see a smartphone or mobile phone in the frame, explicitly set 'phoneDetected' with 'detected: true', its 'distance', and 'position'. Return ONLY a JSON object.",
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            alerts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ["obstacle", "drop", "rise", "clear"] },
                  label: { type: Type.STRING, description: "Object name like 'chair', 'person', 'stairs down'" },
                  position: { type: Type.STRING, enum: ["left", "center", "right"] },
                  distance: { type: Type.STRING, description: "Estimated distance in meters, e.g., '1 meter', '2 meters'" },
                  urgency: { type: Type.STRING, enum: ["high", "medium", "low"] },
                },
                required: ["type", "label", "position", "distance", "urgency"],
              },
            },
            summary: { type: Type.STRING },
            peopleDetected: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  position: { type: Type.STRING, enum: ["left", "center", "right"] }
                },
                required: ["name", "confidence", "position"]
              }
            },
            phoneDetected: {
              type: Type.OBJECT,
              properties: {
                detected: { type: Type.BOOLEAN },
                distance: { type: Type.STRING },
                position: { type: Type.STRING, enum: ["left", "center", "right"] }
              },
              required: ["detected", "distance", "position"]
            },
            depthMap: {
              type: Type.OBJECT,
              properties: {
                grid: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER }
                  },
                  description: "3x3 grid of distances in meters"
                },
                description: { type: Type.STRING, description: "Spatial layout description" }
              },
              required: ["grid", "description"]
            }
          },
          required: ["alerts", "summary", "depthMap"],
        },
      },
    });

    try {
      return JSON.parse(response.text || "{}") as DetectionResult;
    } catch (e) {
      console.error("Failed to parse AI response", e);
      return { alerts: [], summary: "Error analyzing surroundings." };
    }
  }
}
