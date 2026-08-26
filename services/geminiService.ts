/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI } from "@google/genai";
import { StrategicHint, AiResponse, DebugInfo, BallColor } from "../types";

// Client initialization
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

const MODEL_NAME = "gemini-3.7-flash";

export interface TargetCandidate {
  id: string;
  name: string;
  color: BallColor;
  row: number;
  col: number;
  x: number;
  y: number;
  points: number;
  description: string;
  isClearPath: boolean;
  distanceToObstacle: number;
}

export interface ObstacleInfo {
  type: string;
  x: number;
  y: number;
  radius: number;
  lane: string;
}

export const getStrategicHint = async (
  imageBase64: string,
  validTargets: TargetCandidate[],
  obstacles: ObstacleInfo[],
  keeperPos: { x: number; y: number; direction: string }
): Promise<AiResponse> => {
  const startTime = performance.now();
  
  const debug: DebugInfo = {
    latency: 0,
    screenshotBase64: imageBase64,
    promptContext: "",
    rawResponse: "",
    timestamp: new Date().toLocaleTimeString()
  };

  // Fallback heuristic calculations
  const getBestLocalTarget = (msg: string = "Aim for the open goal corner!"): StrategicHint => {
    if (validTargets.length > 0) {
      // Find open pocket furthest from keeper and with clear path
      const clearTargets = validTargets.filter(t => t.isClearPath);
      const candidates = clearTargets.length > 0 ? clearTargets : validTargets;

      // Sort by points and distance to nearest obstacle
      const best = [...candidates].sort((a, b) => {
        const distFromKeeperA = Math.abs(a.x - keeperPos.x);
        const distFromKeeperB = Math.abs(b.x - keeperPos.x);
        return (b.points + distFromKeeperB) - (a.points + distFromKeeperA);
      })[0];
      
      return {
        message: `Strike ${best.name} with ${best.color.toUpperCase()} Ball`,
        rationale: `Goalkeeper is guarding the ${keeperPos.direction} side; the ${best.name} pocket is vulnerable.`,
        targetRow: best.row,
        targetCol: best.col,
        targetX: best.x,
        targetY: best.y,
        recommendedColor: best.color
      };
    }
    return { 
      message: msg, 
      rationale: "Look for an opening past the obstacle balls and release with high velocity.",
      recommendedColor: 'orange'
    };
  };

  if (!ai) {
    const fallback = getBestLocalTarget("Tactical Copilot: Aim for Top Corner!");
    return {
      hint: fallback,
      debug: { 
        ...debug, 
        promptContext: "Local Tactical Engine active (API Key configured in environment).",
        rawResponse: JSON.stringify(fallback, null, 2)
      }
    };
  }

  const targetListStr = validTargets.map(t => 
    `- Pocket [${t.name}] at (x:${Math.round(t.x)}, y:${Math.round(t.y)}) [Row ${t.row}, Col ${t.col}]: ${t.points} pts. Clear Path: ${t.isClearPath ? 'YES' : 'BLOCKED BY OBSTACLES'}. Dist from Keeper: ${Math.round(Math.abs(t.x - keeperPos.x))}px.`
  ).join("\n");

  const obstacleListStr = obstacles.map((o, idx) => 
    `- Obstacle Ball #${idx + 1} (${o.type}) at (${Math.round(o.x)}, ${Math.round(o.y)}), Lane: ${o.lane}`
  ).join("\n");

  const prompt = `
You are an elite soccer coach & tactical AI co-pilot in an augmented-reality slingshot soccer game.
The player uses a slingshot to shoot a soccer ball past obstacle balls (defenders/bumpers/patrolling goalkeeper) to score in the goal at the top of the pitch.

### CURRENT PITCH SITUATION:
- Goalkeeper Ball Position: (x:${Math.round(keeperPos.x)}, y:${Math.round(keeperPos.y)}), Moving: ${keeperPos.direction}
- Obstacle Balls on Field:
${obstacleListStr || 'No static obstacles'}

### GOAL TARGET POCKETS:
${targetListStr}

### BALL SHOT TECHNIQUES & STYLES:
- 'red': Power Strike (100 pts) - high speed direct blast
- 'blue': Finesse Placement (150 pts) - precision corner placement
- 'green': Banana Curve (200 pts) - curls around obstacle balls
- 'yellow': Golden Chip (250 pts) - lobs over low defenders
- 'purple': Trivela Spin (300 pts) - deceptive outside spin
- 'orange': Fireball Strike (500 pts) - maximum power & high score multiplier

### YOUR TACTICAL MISSION:
1. Analyze the field screenshot, goalkeeper movement, and obstacle ball positions.
2. Select the optimal Goal Pocket and Ball Technique to score cleanly.
3. Prioritize high-scoring corners (Top 90s) while avoiding goalkeeper saves and obstacle ball collisions.

### OUTPUT JSON FORMAT (strictly raw JSON, no markdown, no code fences):
{
  "message": "Short tactical directive (e.g. 'Curl Banana Shot into Top-Right 90')",
  "rationale": "One concise sentence explaining why (e.g. 'Goalkeeper is caught on the left post while defender ball #2 leaves the right upper 90 completely open.')",
  "recommendedColor": "red" | "blue" | "green" | "yellow" | "purple" | "orange",
  "targetRow": integer,
  "targetCol": integer,
  "targetX": number,
  "targetY": number
}
`;

  debug.promptContext = `Pockets:\n${targetListStr}\n\nObstacles:\n${obstacleListStr}`;

  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { 
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64
            } 
          }
        ]
      },
      config: {
        maxOutputTokens: 1024,
        temperature: 0.3,
        responseMimeType: "application/json"
      }
    });

    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    
    let text = response.text || "{}";
    debug.rawResponse = text;
    
    // Extract JSON substring
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1);
    } 

    try {
      const json = JSON.parse(text);
      debug.parsedResponse = json;
      
      const r = Number(json.targetRow);
      const c = Number(json.targetCol);
      const validColor = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'].includes(json.recommendedColor?.toLowerCase())
        ? (json.recommendedColor.toLowerCase() as BallColor)
        : 'orange';
      
      return {
        hint: {
          message: json.message || "Shoot for the goal opening!",
          rationale: json.rationale || "Clear lane to goal detected.",
          targetRow: !isNaN(r) ? r : undefined,
          targetCol: !isNaN(c) ? c : undefined,
          targetX: typeof json.targetX === 'number' ? json.targetX : undefined,
          targetY: typeof json.targetY === 'number' ? json.targetY : undefined,
          recommendedColor: validColor
        },
        debug
      };
    } catch (e: any) {
      console.warn("Failed to parse Gemini JSON:", text);
      return {
        hint: getBestLocalTarget("Tactical analysis ready"),
        debug: { ...debug, error: `JSON Parse Error: ${e.message}` }
      };
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    return {
      hint: getBestLocalTarget("Tactical analysis ready"),
      debug: { ...debug, error: error.message || "Unknown API Error" }
    };
  }
};
