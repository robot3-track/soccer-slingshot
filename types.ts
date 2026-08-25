/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface Point {
  x: number;
  y: number;
}

export interface Vector {
  vx: number;
  vy: number;
}

export type BallColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

export interface ShotStyleConfig {
  hex: string;
  points: number;
  label: string;
  technique: string;
  powerMultiplier: number;
  curveFactor: number;
  description: string;
}

export interface ObstacleBall {
  id: string;
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  type: 'defender' | 'keeper' | 'bumper' | 'cone' | 'shield';
  color: string;
  label?: string;
  patrolMinX?: number;
  patrolMaxX?: number;
  active: boolean;
  pulsePhase?: number;
  hitCount?: number;
}

export interface GoalPocket {
  id: string;
  name: string;
  col: number; // For tactical grid matching
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  points: number;
  color: BallColor;
  label: string;
  description: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size?: number;
  type?: 'confetti' | 'spark' | 'smoke' | 'star';
}

export interface StrategicHint {
  message: string;
  rationale?: string;
  targetX?: number;
  targetY?: number;
  targetRow?: number;
  targetCol?: number;
  recommendedColor?: BallColor;
  recommendedTechnique?: string;
}

export interface DebugInfo {
  latency: number;
  screenshotBase64?: string;
  promptContext: string;
  rawResponse: string;
  parsedResponse?: any;
  error?: string;
  timestamp: string;
}

export interface AiResponse {
  hint: StrategicHint;
  debug: DebugInfo;
}

// MediaPipe Type Definitions (Augmenting window)
declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
  }
}
