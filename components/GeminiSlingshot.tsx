/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getStrategicHint, TargetCandidate, ObstacleInfo } from '../services/geminiService';
import { Point, BallColor, ShotStyleConfig, ObstacleBall, GoalPocket, Particle, DebugInfo } from '../types';
import { soundFx } from '../utils/soundEffects';
import { Loader2, Trophy, BrainCircuit, Play, MousePointerClick, Eye, Terminal, AlertTriangle, Target, Lightbulb, Monitor, Flame, Volume2, VolumeX, Sparkles } from 'lucide-react';

const PINCH_THRESHOLD = 0.065;
const GRAVITY = 0.04;
const FRICTION = 0.995;
const BALL_RADIUS = 24;
const MAX_DEFENDERS_MOBILE = 3;
const MAX_DEFENDERS_DESKTOP = 5;
const SLINGSHOT_BOTTOM_OFFSET = 200;
const MAX_DRAG_DIST = 170;
const MIN_FORCE_MULT = 0.16;
const MAX_FORCE_MULT = 0.46;

// Colors and shot technique configurations
const COLOR_CONFIG: Record<BallColor, ShotStyleConfig> = {
  red:    { hex: '#ef5350', points: 100, label: 'Power Blast', technique: 'Direct Strike', powerMultiplier: 1.35, curveFactor: 0.0, description: 'Blasts straight past obstacle balls with extreme velocity' },
  blue:   { hex: '#42a5f5', points: 150, label: 'Finesse Curler', technique: 'Corner Placement', powerMultiplier: 1.05, curveFactor: 0.18, description: 'Pinpoint accuracy into top and bottom goal corners' },
  green:  { hex: '#66bb6a', points: 200, label: 'Banana Curve', technique: 'Defensive Bypass', powerMultiplier: 1.0, curveFactor: 0.35, description: 'Curls smoothly around defender obstacle balls' },
  yellow: { hex: '#ffee58', points: 250, label: 'Golden Chip', technique: 'Overhead Lob', powerMultiplier: 0.95, curveFactor: -0.15, description: 'Floats over low obstacles into the back of the net' },
  purple: { hex: '#ab47bc', points: 300, label: 'Trivela Spin', technique: 'Outside Swerve', powerMultiplier: 1.15, curveFactor: -0.32, description: 'Deceptive outside-of-the-boot swerve past the keeper' },
  orange: { hex: '#ffa726', points: 500, label: 'Fireball Rocket', technique: 'Unstoppable Cannon', powerMultiplier: 1.45, curveFactor: 0.08, description: 'High multiplier strike that smashes through obstacles' }
};

const COLOR_KEYS: BallColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

// Color Helper for Gradients
const adjustColor = (color: string, amount: number) => {
  const hex = color.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
  
  const componentToHex = (c: number) => {
    const h = c.toString(16);
    return h.length === 1 ? "0" + h : h;
  };
  
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

const GeminiSlingshot: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  
  // Game Physics State Refs
  const ballPos = useRef<Point>({ x: 0, y: 0 });
  const ballVel = useRef<Point>({ x: 0, y: 0 });
  const ballSpin = useRef<number>(0);
  const ballRotation = useRef<number>(0);
  const anchorPos = useRef<Point>({ x: 0, y: 0 });
  
  // Webcam Hand Motion & Touch / Pointer Dragging
  const isPinching = useRef<boolean>(false);
  const isPointerDragging = useRef<boolean>(false);
  const isFlying = useRef<boolean>(false);
  const flightStartTime = useRef<number>(0);
  
  // Hand Tracking Data Ref (Webcam Landmark Feed)
  const handTrackerRef = useRef<{
    landmarks: any[] | null;
    pos: Point | null;
    pinchDist: number;
    lastUpdated: number;
  }>({
    landmarks: null,
    pos: null,
    pinchDist: 1.0,
    lastUpdated: 0
  });

  // Obstacles & Defenders (Starts with 1 defender, increases overtime)
  const obstacles = useRef<ObstacleBall[]>([]);
  const defenderLevelRef = useRef<number>(1);
  const lastDefenderSpawnTimeRef = useRef<number>(0);
  const totalDefendersAllowedRef = useRef<number>(1);
  const ballRadiusRef = useRef<number>(22);
  const goalDimensionsRef = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 55,
    width: 500,
    height: 120
  });

  const goalkeeper = useRef<ObstacleBall>({
    id: 'keeper',
    x: 0,
    y: 0,
    radius: 30,
    vx: 2.4,
    vy: 0,
    type: 'keeper',
    color: '#ffca28',
    active: true,
    label: 'GK'
  });
  
  const goalPockets = useRef<GoalPocket[]>([]);
  const particles = useRef<Particle[]>([]);
  const scoreRef = useRef<number>(0);
  const streakRef = useRef<number>(0);
  const goalNetRipple = useRef<number>(0);
  const celebrationBanner = useRef<{ active: boolean; text: string; subtext: string; timer: number; color: string }>({
    active: false,
    text: '',
    subtext: '',
    timer: 0,
    color: '#ffd54f'
  });

  const aimTargetRef = useRef<Point | null>(null);
  const isAiThinkingRef = useRef<boolean>(false);
  const captureRequestRef = useRef<boolean>(false);
  const selectedColorRef = useRef<BallColor>('orange');
  const isProcessingHandFrame = useRef<boolean>(false);
  const geminiHelpEnabledRef = useRef<boolean>(false);
  
  // React State
  const [loading, setLoading] = useState(true);
  const [geminiHelpEnabled, setGeminiHelpEnabled] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [aiHint, setAiHint] = useState<string | null>("Gemini Strategy Assistance is disabled. Toggle AI ON above to receive live tactical hints & aim guides.");
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [aimTarget, setAimTarget] = useState<Point | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedColor, setSelectedColor] = useState<BallColor>('orange');
  const [availableColors] = useState<BallColor[]>(COLOR_KEYS);
  const [aiRecommendedColor, setAiRecommendedColor] = useState<BallColor | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Sync state to refs
  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  useEffect(() => {
    aimTargetRef.current = aimTarget;
  }, [aimTarget]);

  useEffect(() => {
    isAiThinkingRef.current = isAiThinking;
  }, [isAiThinking]);

  useEffect(() => {
    geminiHelpEnabledRef.current = geminiHelpEnabled;
  }, [geminiHelpEnabled]);

  const handleToggleGeminiHelp = useCallback(() => {
    setGeminiHelpEnabled(prev => {
      const next = !prev;
      geminiHelpEnabledRef.current = next;
      soundFx.playToggle(next);

      if (!next) {
        setAimTarget(null);
        aimTargetRef.current = null;
        setIsAiThinking(false);
        isAiThinkingRef.current = false;
        setAiRationale(null);
        setAiRecommendedColor(null);
      } else {
        setAiHint("Analyzing goal openings & defensive lanes...");
        captureRequestRef.current = true;
      }
      return next;
    });
  }, []);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      soundFx.setMuted(!next);
      soundFx.playToggle(next);
      return next;
    });
  }, []);

  // Generate soccer goal & field layout with responsive defender sizing and limits
  const initPitch = useCallback((width: number, height: number) => {
    const isMobile = width < 768 || height < 550 || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

    const goalWidth = Math.min(width * (isMobile ? 0.72 : 0.58), 540);
    const goalHeight = isMobile ? Math.min(Math.max(68, height * 0.25), 92) : 120;
    const goalX = (width - goalWidth) / 2;
    const goalY = isMobile ? Math.max(12, height * 0.06) : 55;

    goalDimensionsRef.current = { x: goalX, y: goalY, width: goalWidth, height: goalHeight };

    // Responsive ball and obstacle sizing
    // Defenders & obstacles are scaled smaller on mobile/Android to provide clear shot lanes and realistic pitch geometry
    const ballRadius = isMobile 
      ? Math.max(14, Math.min(18, width * 0.038)) 
      : 24;
    ballRadiusRef.current = ballRadius;

    const defRadius = isMobile 
      ? Math.max(12, Math.min(16, width * 0.034)) 
      : Math.min(27, Math.max(20, width * 0.04));

    const keeperRadius = isMobile 
      ? Math.max(13, Math.min(17, goalHeight * 0.22)) 
      : Math.min(28, goalHeight * 0.25);

    // 5 Strategic Goal Scoring Pockets
    const pocketW = Math.min(isMobile ? 56 : 80, goalWidth * 0.22);
    const pocketH = Math.min(isMobile ? 36 : 50, goalHeight * 0.42);

    const pockets: GoalPocket[] = [
      {
        id: 'top-left',
        name: 'Top-Left 90',
        col: 0,
        row: 0,
        x: goalX + pocketW * 0.55,
        y: goalY + pocketH * 0.6,
        width: pocketW,
        height: pocketH,
        points: 500,
        color: 'orange',
        label: 'TOP 90',
        description: 'Upper left corner pocket'
      },
      {
        id: 'top-right',
        name: 'Top-Right 90',
        col: 4,
        row: 0,
        x: goalX + goalWidth - pocketW * 0.55,
        y: goalY + pocketH * 0.6,
        width: pocketW,
        height: pocketH,
        points: 500,
        color: 'purple',
        label: 'TOP 90',
        description: 'Upper right corner pocket'
      },
      {
        id: 'bottom-left',
        name: 'Bottom-Left Corner',
        col: 1,
        row: 1,
        x: goalX + pocketW * 0.68,
        y: goalY + goalHeight - pocketH * 0.55,
        width: pocketW,
        height: pocketH * 0.9,
        points: 300,
        color: 'blue',
        label: 'LOW CORNER',
        description: 'Low driven corner shot'
      },
      {
        id: 'bottom-right',
        name: 'Bottom-Right Corner',
        col: 3,
        row: 1,
        x: goalX + goalWidth - pocketW * 0.68,
        y: goalY + goalHeight - pocketH * 0.55,
        width: pocketW,
        height: pocketH * 0.9,
        points: 300,
        color: 'green',
        label: 'LOW CORNER',
        description: 'Low driven corner shot'
      },
      {
        id: 'center-roof',
        name: 'Roof Center Net',
        col: 2,
        row: 0,
        x: goalX + goalWidth / 2,
        y: goalY + pocketH * 0.7,
        width: pocketW * 1.25,
        height: pocketH * 0.9,
        points: 200,
        color: 'red',
        label: 'ROOF NET',
        description: 'Blasted high into center net'
      }
    ];
    goalPockets.current = pockets;

    // Goalkeeper positioning along goal line
    const keeperPatrolMin = goalX + (isMobile ? 25 : 50);
    const keeperPatrolMax = goalX + goalWidth - (isMobile ? 25 : 50);
    const prevKeeperVx = goalkeeper.current?.vx ?? 2.6;
    const keeperSpeed = isMobile ? 1.8 : 2.6;

    goalkeeper.current = {
      id: 'keeper',
      x: goalkeeper.current?.x ? Math.max(keeperPatrolMin, Math.min(keeperPatrolMax, goalkeeper.current.x)) : goalX + goalWidth / 2,
      y: goalY + goalHeight - (isMobile ? 12 : 18),
      radius: keeperRadius,
      vx: prevKeeperVx >= 0 ? keeperSpeed : -keeperSpeed,
      vy: 0,
      type: 'keeper',
      color: '#ffca28',
      patrolMinX: keeperPatrolMin,
      patrolMaxX: keeperPatrolMax,
      active: true,
      label: 'GK'
    };

    const def1Y = goalY + (isMobile ? Math.min(110, height * 0.28) : Math.min(190, height * 0.38));
    const def23Y = goalY + (isMobile ? Math.min(85, height * 0.22) : Math.min(160, height * 0.32));
    const bumperY = goalY + (isMobile ? Math.min(145, height * 0.38) : Math.min(260, height * 0.52));
    const coneY = goalY + (isMobile ? Math.min(125, height * 0.33) : Math.min(230, height * 0.46));

    // If defenders already exist in the active session, PRESERVE their count and active state
    // while resizing their radius, orientation, and patrol bounds for the new screen dimensions
    if (obstacles.current && obstacles.current.length > 0) {
      obstacles.current.forEach(obs => {
        obs.radius = obs.type === 'bumper' 
          ? defRadius * 1.05 
          : (obs.type === 'cone' ? defRadius * 0.85 : defRadius);

        if (obs.id === 'def-1') {
          obs.y = def1Y;
          obs.patrolMinX = width / 2 - Math.min(isMobile ? 70 : 130, width * 0.28);
          obs.patrolMaxX = width / 2 + Math.min(isMobile ? 70 : 130, width * 0.28);
          const spd = isMobile ? 1.4 : 1.8;
          obs.vx = obs.vx >= 0 ? spd : -spd;
        } else if (obs.id === 'def-2') {
          obs.y = def23Y;
          obs.patrolMinX = width / 2 + Math.min(isMobile ? 18 : 40, width * 0.08);
          obs.patrolMaxX = width / 2 + Math.min(isMobile ? 100 : 200, width * 0.36);
          const spd = isMobile ? 1.3 : 1.6;
          obs.vx = obs.vx >= 0 ? spd : -spd;
        } else if (obs.id === 'def-3') {
          obs.y = def23Y;
          obs.patrolMinX = width / 2 - Math.min(isMobile ? 100 : 200, width * 0.36);
          obs.patrolMaxX = width / 2 - Math.min(isMobile ? 18 : 40, width * 0.08);
          const spd = isMobile ? 1.3 : 1.6;
          obs.vx = obs.vx >= 0 ? spd : -spd;
        } else if (obs.id === 'def-bumper') {
          obs.y = bumperY;
          obs.patrolMinX = width / 2 - Math.min(isMobile ? 45 : 90, width * 0.2);
          obs.patrolMaxX = width / 2 + Math.min(isMobile ? 45 : 90, width * 0.2);
          const spd = isMobile ? 1.0 : 1.2;
          obs.vx = obs.vx >= 0 ? spd : -spd;
        } else if (obs.id === 'def-cone-left') {
          obs.y = coneY;
          obs.x = width / 2 - Math.min(isMobile ? 100 : 220, width * 0.38);
        } else {
          // Additional custom spawned defenders
          obs.patrolMinX = width * (isMobile ? 0.15 : 0.2);
          obs.patrolMaxX = width * (isMobile ? 0.85 : 0.8);
          obs.y = goalY + (isMobile ? Math.min(height * 0.35, 120) : Math.min(height * 0.45, 220));
          const spd = isMobile ? 1.3 : 1.7;
          obs.vx = obs.vx >= 0 ? spd : -spd;
        }

        // Keep defenders within newly scaled patrol bounds
        if (obs.patrolMinX !== undefined && obs.patrolMaxX !== undefined) {
          if (obs.x < obs.patrolMinX || obs.x > obs.patrolMaxX) {
            obs.x = Math.max(obs.patrolMinX, Math.min(obs.patrolMaxX, obs.x));
          }
        }
      });
      return;
    }

    // Full Obstacle Initial Roster (Fresh session starts with ONLY ONE ACTIVE DEFENDER)
    defenderLevelRef.current = 1;
    totalDefendersAllowedRef.current = 1;
    lastDefenderSpawnTimeRef.current = performance.now();

    const roster: ObstacleBall[] = [
      // Defender 1: Central patrol defender (STARTING DEFENDER)
      {
        id: 'def-1',
        x: width / 2,
        y: def1Y,
        radius: defRadius,
        vx: isMobile ? 1.4 : 1.8,
        vy: 0,
        patrolMinX: width / 2 - Math.min(isMobile ? 70 : 130, width * 0.28),
        patrolMaxX: width / 2 + Math.min(isMobile ? 70 : 130, width * 0.28),
        type: 'defender',
        color: '#e53935',
        active: true, // Only 1 active initially!
        label: 'DEF 1'
      },
      // Defender 2: Right-wing sweeping defender (Unlocks overtime)
      {
        id: 'def-2',
        x: width / 2 + Math.min(isMobile ? 65 : 140, width * 0.25),
        y: def23Y,
        radius: defRadius,
        vx: isMobile ? -1.3 : -1.6,
        vy: 0,
        patrolMinX: width / 2 + Math.min(isMobile ? 18 : 40, width * 0.08),
        patrolMaxX: width / 2 + Math.min(isMobile ? 100 : 200, width * 0.36),
        type: 'defender',
        color: '#e53935',
        active: false,
        label: 'DEF 2'
      },
      // Defender 3: Left-wing sweeping defender (Unlocks overtime)
      {
        id: 'def-3',
        x: width / 2 - Math.min(isMobile ? 65 : 140, width * 0.25),
        y: def23Y,
        radius: defRadius,
        vx: isMobile ? 1.3 : 1.6,
        vy: 0,
        patrolMinX: width / 2 - Math.min(isMobile ? 100 : 200, width * 0.36),
        patrolMaxX: width / 2 - Math.min(isMobile ? 18 : 40, width * 0.08),
        type: 'defender',
        color: '#e53935',
        active: false,
        label: 'DEF 3'
      },
      // Defender 4 / Stopper: Midfield Energy Bumper (Unlocks overtime)
      {
        id: 'def-bumper',
        x: width / 2,
        y: bumperY,
        radius: defRadius * 1.05,
        vx: isMobile ? 1.0 : 1.2,
        vy: 0,
        patrolMinX: width / 2 - Math.min(isMobile ? 45 : 90, width * 0.2),
        patrolMaxX: width / 2 + Math.min(isMobile ? 45 : 90, width * 0.2),
        type: 'bumper',
        color: '#8e24aa',
        active: false,
        label: 'BUMPER'
      },
      // Defender 5: Outer Wing Barrier Cone (Unlocks overtime)
      {
        id: 'def-cone-left',
        x: width / 2 - Math.min(isMobile ? 100 : 220, width * 0.38),
        y: coneY,
        radius: defRadius * 0.85,
        vx: 0,
        vy: 0,
        type: 'cone',
        color: '#ffa000',
        active: false,
        label: 'BARRIER'
      }
    ];
    obstacles.current = roster;

    // Initial tactical analysis if enabled
    if (geminiHelpEnabledRef.current) {
      setTimeout(() => {
        captureRequestRef.current = true;
      }, 1000);
    }
  }, []);

  // Dynamically add a defender when user scores a goal, strictly capped by defender limits
  const addDefenderOnScore = useCallback((canvasWidth: number) => {
    const isMobile = canvasWidth < 768 || (typeof window !== 'undefined' && window.innerWidth < 768) || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    const maxAllowed = isMobile ? MAX_DEFENDERS_MOBILE : MAX_DEFENDERS_DESKTOP;
    
    const activeObstacles = obstacles.current.filter(o => o.active);
    
    // Check if defender limit has been reached
    if (activeObstacles.length >= maxAllowed) {
      // Cap reached: do NOT spawn or activate more defenders
      // Apply slight challenge bonus to defender speed instead (safely clamped)
      activeObstacles.forEach(obs => {
        if (Math.abs(obs.vx) < (isMobile ? 2.4 : 3.2) && obs.type !== 'cone') {
          obs.vx *= 1.04;
        }
      });
      return `MAX DEFENDERS (${activeObstacles.length}/${maxAllowed})`;
    }

    const inactiveObstacles = obstacles.current.filter(o => !o.active);
    let addedLabel = '';

    if (inactiveObstacles.length > 0) {
      const nextDefender = inactiveObstacles[0];
      nextDefender.active = true;
      totalDefendersAllowedRef.current += 1;
      defenderLevelRef.current += 1;
      const currentActiveCount = obstacles.current.filter(o => o.active).length;
      addedLabel = `${nextDefender.label || `DEF ${currentActiveCount}`} (${currentActiveCount}/${maxAllowed})`;
    } else if (obstacles.current.length < maxAllowed) {
      // Safety fallback to add up to maxAllowed if needed
      const count = obstacles.current.length + 1;
      const defRadius = isMobile 
        ? Math.max(12, Math.min(16, canvasWidth * 0.034)) 
        : Math.min(27, Math.max(20, canvasWidth * 0.04));
      
      const newDef: ObstacleBall = {
        id: `def-${count}`,
        x: canvasWidth * (0.28 + Math.random() * 0.44),
        y: (goalDimensionsRef.current.y || 50) + (isMobile ? 75 + Math.random() * 55 : 130 + Math.random() * 140),
        radius: defRadius,
        vx: (Math.random() > 0.5 ? 1 : -1) * (isMobile ? 1.3 : 1.7),
        vy: 0,
        patrolMinX: canvasWidth * (isMobile ? 0.15 : 0.2),
        patrolMaxX: canvasWidth * (isMobile ? 0.85 : 0.8),
        type: 'defender',
        color: '#e53935',
        active: true,
        label: `DEF ${count}`
      };
      obstacles.current.push(newDef);
      totalDefendersAllowedRef.current += 1;
      defenderLevelRef.current += 1;
      addedLabel = `${newDef.label} (${count}/${maxAllowed})`;
    }
    return addedLabel;
  }, []);

  const createGoalExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 45; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 12;
      particles.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1.0,
        color: i % 2 === 0 ? color : '#ffffff',
        size: 3 + Math.random() * 6,
        type: 'confetti'
      });
    }
  };

  const createRicochetParticles = (x: number, y: number, color: string) => {
    for (let i = 0; i < 14; i++) {
      particles.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        life: 0.8,
        color,
        size: 2 + Math.random() * 4,
        type: 'spark'
      });
    }
  };

  const checkPathClearToPocket = (pocket: GoalPocket) => {
    if (!anchorPos.current) return { isClear: false, minDist: 0 };
    const startX = anchorPos.current.x;
    const startY = anchorPos.current.y;
    const endX = pocket.x;
    const endY = pocket.y;

    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(distance / 15);
    let minObstacleDist = Infinity;

    const allObstacles = [...obstacles.current.filter(o => o.active), goalkeeper.current];
    const ballR = ballRadiusRef.current || 20;

    for (let i = 1; i < steps - 1; i++) {
      const t = i / steps;
      const cx = startX + dx * t;
      const cy = startY + dy * t;

      for (const obs of allObstacles) {
        const d = Math.sqrt(Math.pow(cx - obs.x, 2) + Math.pow(cy - obs.y, 2));
        if (d < minObstacleDist) minObstacleDist = d;
        if (d < obs.radius + ballR * 0.8) {
          return { isClear: false, minDist: d };
        }
      }
    }
    return { isClear: true, minDist: minObstacleDist };
  };

  const performAiAnalysis = async (screenshot: string) => {
    if (!geminiHelpEnabledRef.current) {
      isAiThinkingRef.current = false;
      setIsAiThinking(false);
      return;
    }

    isAiThinkingRef.current = true;
    setIsAiThinking(true);
    const activeDefCount = obstacles.current.filter(o => o.active).length;
    setAiHint(`Analyzing goal openings past ${activeDefCount} active defender${activeDefCount > 1 ? 's' : ''}...`);
    setAiRationale(null);

    const candidates: TargetCandidate[] = goalPockets.current.map(p => {
      const pathCheck = checkPathClearToPocket(p);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        row: p.row,
        col: p.col,
        x: p.x,
        y: p.y,
        points: p.points,
        description: p.description,
        isClearPath: pathCheck.isClear,
        distanceToObstacle: Math.round(pathCheck.minDist)
      };
    });

    const obsInfo: ObstacleInfo[] = obstacles.current.filter(o => o.active).map(o => {
      let lane = "Center";
      if (o.x < (canvasRef.current?.width || 800) * 0.4) lane = "Left Flank";
      else if (o.x > (canvasRef.current?.width || 800) * 0.6) lane = "Right Flank";
      return {
        type: o.type,
        x: o.x,
        y: o.y,
        radius: o.radius,
        lane
      };
    });

    const keeper = goalkeeper.current;
    const keeperDirection = keeper.vx > 0 ? "Rightward" : "Leftward";

    getStrategicHint(screenshot, candidates, obsInfo, {
      x: keeper.x,
      y: keeper.y,
      direction: keeperDirection
    }).then(aiResponse => {
      if (!geminiHelpEnabledRef.current) {
        isAiThinkingRef.current = false;
        setIsAiThinking(false);
        return;
      }

      const { hint, debug } = aiResponse;
      setDebugInfo(debug);
      setAiHint(hint.message);
      setAiRationale(hint.rationale || null);

      if (hint.recommendedColor) {
        setAiRecommendedColor(hint.recommendedColor);
        setSelectedColor(hint.recommendedColor);
      }

      // Find matching target coordinates
      if (typeof hint.targetX === 'number' && typeof hint.targetY === 'number') {
        setAimTarget({ x: hint.targetX, y: hint.targetY });
      } else if (typeof hint.targetRow === 'number' && typeof hint.targetCol === 'number') {
        const found = goalPockets.current.find(p => p.row === hint.targetRow && p.col === hint.targetCol);
        if (found) {
          setAimTarget({ x: found.x, y: found.y });
        }
      } else {
        const best = candidates.find(c => c.isClearPath) || candidates[0];
        if (best) setAimTarget({ x: best.x, y: best.y });
      }

      isAiThinkingRef.current = false;
      setIsAiThinking(false);
    });
  };

  // --- Rendering Helpers ---

  // Draw Realistic 3D Canvas Soccer Ball
  const drawSoccerBall = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    rotation: number,
    colorKey: BallColor,
    isGlowing: boolean = false
  ) => {
    const config = COLOR_CONFIG[colorKey];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    // Ball Drop Shadow on Field
    ctx.save();
    ctx.scale(1, 0.4);
    ctx.beginPath();
    ctx.arc(0, radius * 1.8, radius * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    ctx.restore();

    // Outer Glow if special shot equipped
    if (isGlowing) {
      ctx.shadowBlur = 18;
      ctx.shadowColor = config.hex;
    }

    // Main Sphere Gradient (Spherical 3D shading)
    const baseGrad = ctx.createRadialGradient(-radius * 0.35, -radius * 0.35, radius * 0.1, 0, 0, radius);
    baseGrad.addColorStop(0, '#ffffff');
    baseGrad.addColorStop(0.65, '#e0e0e0');
    baseGrad.addColorStop(0.95, '#9e9e9e');
    baseGrad.addColorStop(1, '#616161');

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();

    // Seam Border
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.7)';
    ctx.stroke();

    // Classic Pentagon Pattern
    const drawPentagon = (px: number, py: number, pRadius: number, pAngle: number, fill: string) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(pAngle);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const vx = Math.cos(a) * pRadius;
        const vy = Math.sin(a) * pRadius;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 30, 30, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    };

    // Center Pentagon
    const pentagonColor = '#212121';
    drawPentagon(0, 0, radius * 0.38, 0, pentagonColor);

    // 5 Outer Pentagons with connecting seam lines
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const cornerX = Math.cos(a) * radius * 0.38;
      const cornerY = Math.sin(a) * radius * 0.38;

      const outerX = Math.cos(a) * radius * 0.85;
      const outerY = Math.sin(a) * radius * 0.85;

      ctx.beginPath();
      ctx.moveTo(cornerX, cornerY);
      ctx.lineTo(outerX, outerY);
      ctx.strokeStyle = 'rgba(40, 40, 40, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      drawPentagon(outerX, outerY, radius * 0.28, a + Math.PI, pentagonColor);
    }

    // Technique Color Tint Trim
    ctx.beginPath();
    ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
    ctx.strokeStyle = config.hex;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Specular Highlight
    ctx.beginPath();
    ctx.ellipse(-radius * 0.35, -radius * 0.4, radius * 0.3, radius * 0.18, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fill();

    ctx.restore();
  };

  // Draw Obstacle Balls (Defenders, Goalkeeper, Bumpers)
  const drawObstacle = (ctx: CanvasRenderingContext2D, obs: ObstacleBall) => {
    ctx.save();
    const r = obs.radius;
    const x = obs.x;
    const y = obs.y;
    const isSmall = r < 18;

    // Shadow
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.9, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    if (obs.type === 'keeper') {
      // Goalkeeper Ball Styling
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grad.addColorStop(0, '#fff59d');
      grad.addColorStop(0.3, '#fbc02d');
      grad.addColorStop(0.9, '#f57f17');
      grad.addColorStop(1, '#b78103');

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = isSmall ? 1.5 : 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Goalkeeper Glove Badges (scaled)
      const gloveR = Math.max(3.5, r * 0.25);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x - r * 0.85, y, gloveR, 0, Math.PI * 2);
      ctx.arc(x + r * 0.85, y, gloveR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f57f17';
      ctx.lineWidth = 1;
      ctx.stroke();

      const fontSize = Math.max(7.5, Math.min(12, r * 0.52));
      ctx.fillStyle = '#212121';
      ctx.font = `bold ${fontSize}px Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GK', x, y);
    } else if (obs.type === 'defender') {
      // Defender Ball (Striped Team Jersey Style)
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grad.addColorStop(0, '#ff8a80');
      grad.addColorStop(0.4, '#e53935');
      grad.addColorStop(1, '#b71c1c');

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = isSmall ? 1.5 : 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();

      // Jersey Stripes
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      const stripeW = Math.max(3, r * 0.35);
      ctx.fillRect(x - stripeW / 2, y - r, stripeW, r * 2);
      ctx.restore();

      // Label
      const fontSize = Math.max(7, Math.min(10, r * 0.46));
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${fontSize}px Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(obs.label || 'DEF', x, y);
    } else if (obs.type === 'bumper') {
      // High-Bounce Energy Bumper
      const grad = ctx.createRadialGradient(x, y, 2, x, y, r);
      grad.addColorStop(0, '#e1bee7');
      grad.addColorStop(0.5, '#ab47bc');
      grad.addColorStop(1, '#4a148c');

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = '#ce93d8';
      ctx.lineWidth = isSmall ? 1.5 : 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.65, 0, Math.PI * 2);
      ctx.stroke();

      const fontSize = Math.max(6.5, Math.min(9, r * 0.42));
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${fontSize}px Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BUMP', x, y);
    } else {
      // Barrier Cone
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
      grad.addColorStop(0, '#ffe082');
      grad.addColorStop(0.5, '#ffa000');
      grad.addColorStop(1, '#ff6f00');

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = isSmall ? 1.5 : 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    ctx.restore();
  };

  // Draw Soccer Goal Structure & Net
  const drawSoccerGoal = (ctx: CanvasRenderingContext2D, width: number) => {
    const { x: goalX, y: goalY, width: goalWidth, height: goalHeight } = goalDimensionsRef.current;
    const postRadius = Math.max(4, Math.min(7, goalHeight * 0.07));

    ctx.save();

    // Goal Shadow on Pitch
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(goalX - 10, goalY + goalHeight - 5, goalWidth + 20, 15);

    // Goal Net Backing
    ctx.fillStyle = 'rgba(25, 35, 45, 0.65)';
    ctx.beginPath();
    ctx.moveTo(goalX, goalY);
    ctx.lineTo(goalX + 25, goalY - 25);
    ctx.lineTo(goalX + goalWidth - 25, goalY - 25);
    ctx.lineTo(goalX + goalWidth, goalY);
    ctx.lineTo(goalX + goalWidth, goalY + goalHeight);
    ctx.lineTo(goalX, goalY + goalHeight);
    ctx.closePath();
    ctx.fill();

    // Diamond Net Mesh with Ripple Distortion
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    const gridSize = 16;
    const ripple = goalNetRipple.current;

    for (let x = goalX; x <= goalX + goalWidth; x += gridSize) {
      const offsetX = Math.sin((x / goalWidth) * Math.PI) * ripple * 15;
      ctx.beginPath();
      ctx.moveTo(x + offsetX, goalY);
      ctx.lineTo(x + offsetX * 0.5, goalY + goalHeight);
      ctx.stroke();
    }
    for (let y = goalY; y <= goalY + goalHeight; y += gridSize) {
      const offsetY = Math.sin((y / goalHeight) * Math.PI) * ripple * 10;
      ctx.beginPath();
      ctx.moveTo(goalX, y + offsetY);
      ctx.lineTo(goalX + goalWidth, y + offsetY);
      ctx.stroke();
    }

    // Goal Line on Pitch
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(goalX - 25, goalY + goalHeight);
    ctx.lineTo(goalX + goalWidth + 25, goalY + goalHeight);
    ctx.stroke();

    // Penalty Arc & Box Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(goalX - 45, goalY, goalWidth + 90, goalHeight + 110);

    // Goal Target Pockets (Target Indicator Rings)
    goalPockets.current.forEach(pocket => {
      const isTarget = aimTargetRef.current && 
        Math.abs(aimTargetRef.current.x - pocket.x) < 40 &&
        Math.abs(aimTargetRef.current.y - pocket.y) < 30;
      
      const config = COLOR_CONFIG[pocket.color];

      ctx.save();
      ctx.translate(pocket.x, pocket.y);

      // Target Ring
      ctx.beginPath();
      ctx.arc(0, 0, isTarget ? 24 : 18, 0, Math.PI * 2);
      ctx.strokeStyle = isTarget ? config.hex : 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = isTarget ? 3 : 1.5;
      if (isTarget) {
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -(performance.now() / 30) % 20;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fill();
      }
      ctx.stroke();

      // Points Badge
      ctx.fillStyle = isTarget ? config.hex : 'rgba(255, 255, 255, 0.7)';
      ctx.font = 'bold 10px Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${pocket.points}`, 0, isTarget ? -28 : -22);

      ctx.restore();
    });

    // 3D White Tubular Goal Posts & Crossbar
    const drawPost = (px1: number, py1: number, px2: number, py2: number) => {
      const grad = ctx.createLinearGradient(px1 - postRadius, py1, px1 + postRadius, py1);
      grad.addColorStop(0, '#9e9e9e');
      grad.addColorStop(0.3, '#ffffff');
      grad.addColorStop(0.7, '#f5f5f5');
      grad.addColorStop(1, '#757575');

      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py2);
      ctx.strokeStyle = grad;
      ctx.lineWidth = postRadius * 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    };

    drawPost(goalX, goalY, goalX, goalY + goalHeight);
    drawPost(goalX + goalWidth, goalY, goalX + goalWidth, goalY + goalHeight);
    drawPost(goalX - postRadius, goalY, goalX + goalWidth + postRadius, goalY);

    ctx.restore();
  };

  // Native Pointer & Touch Controls for Slingshot (Mobile & Desktop)
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isAiThinkingRef.current || isFlying.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const distToBall = Math.hypot(px - ballPos.current.x, py - ballPos.current.y);
    const distToAnchor = Math.hypot(px - anchorPos.current.x, py - anchorPos.current.y);

    if (distToBall < 75 || distToAnchor < 90) {
      isPointerDragging.current = true;
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch (err) {}

      const dragDx = px - anchorPos.current.x;
      const dragDy = py - anchorPos.current.y;
      const dragDist = Math.hypot(dragDx, dragDy);

      if (dragDist > MAX_DRAG_DIST) {
        const angle = Math.atan2(dragDy, dragDx);
        ballPos.current.x = anchorPos.current.x + Math.cos(angle) * MAX_DRAG_DIST;
        ballPos.current.y = anchorPos.current.y + Math.sin(angle) * MAX_DRAG_DIST;
      } else {
        ballPos.current.x = px;
        ballPos.current.y = py;
      }
      ballRotation.current = (ballPos.current.x - anchorPos.current.x) * 0.03;
      soundFx.playStretch(Math.min(dragDist / MAX_DRAG_DIST, 1.0));
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDragging.current || isFlying.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const dragDx = px - anchorPos.current.x;
    const dragDy = py - anchorPos.current.y;
    const dragDist = Math.hypot(dragDx, dragDy);

    if (dragDist > MAX_DRAG_DIST) {
      const angle = Math.atan2(dragDy, dragDx);
      ballPos.current.x = anchorPos.current.x + Math.cos(angle) * MAX_DRAG_DIST;
      ballPos.current.y = anchorPos.current.y + Math.sin(angle) * MAX_DRAG_DIST;
    } else {
      ballPos.current.x = px;
      ballPos.current.y = py;
    }
    ballRotation.current = (ballPos.current.x - anchorPos.current.x) * 0.03;
    soundFx.playStretch(Math.min(dragDist / MAX_DRAG_DIST, 1.0));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDragging.current) return;
    isPointerDragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (isAiThinkingRef.current) {
      ballPos.current = { ...anchorPos.current };
      return;
    }

    const dx = anchorPos.current.x - ballPos.current.x;
    const dy = anchorPos.current.y - ballPos.current.y;
    const stretchDist = Math.hypot(dx, dy);

    if (stretchDist > 25) {
      isFlying.current = true;
      flightStartTime.current = performance.now();
      const config = COLOR_CONFIG[selectedColorRef.current];
      const powerRatio = Math.min(stretchDist / MAX_DRAG_DIST, 1.0);
      const velocityMultiplier = (MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio)) * config.powerMultiplier;

      ballVel.current = {
        x: dx * velocityMultiplier,
        y: dy * velocityMultiplier
      };
      ballSpin.current = config.curveFactor * 2.5;

      // Play sound and particle burst
      soundFx.playKick(powerRatio);
      createRicochetParticles(ballPos.current.x, ballPos.current.y, config.hex);
    } else {
      ballPos.current = { ...anchorPos.current };
    }
  }, [createRicochetParticles]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPointerDragging.current) {
      isPointerDragging.current = false;
      ballPos.current = { ...anchorPos.current };
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  }, []);

  // --- Main Webcam Hand Tracking & 60 FPS Game Loop ---

  useEffect(() => {
    if (!canvasRef.current || !gameContainerRef.current) return;

    const canvas = canvasRef.current;
    const container = gameContainerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const initialBottomOffset = Math.min(130, Math.max(65, canvas.height * 0.22));
    anchorPos.current = { x: canvas.width / 2, y: canvas.height - initialBottomOffset };
    ballPos.current = { ...anchorPos.current };

    initPitch(canvas.width, canvas.height);

    let animationFrameId: number;
    let handsInstance: any = null;
    let cameraInstance: any = null;
    let cameraStream: MediaStream | null = null;
    let isComponentMounted = true;

    // Safety fallback so loading spinner never blocks the user
    const safetyLoadingTimer = setTimeout(() => {
      if (isComponentMounted) {
        setLoading(false);
      }
    }, 2500);

    // Setup Webcam & MediaPipe Hands
    const setupWebcamAndHandTracker = async () => {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && videoRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user'
            },
            audio: false
          });

          if (!isComponentMounted) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }

          cameraStream = stream;
          videoRef.current.srcObject = stream;
          await videoRef.current.play();

          // Initialize MediaPipe Hands
          if (window.Hands) {
            try {
              handsInstance = new window.Hands({
                locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
              });

              handsInstance.setOptions({
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
              });

              handsInstance.onResults((results: any) => {
                if (!isComponentMounted) return;
                setLoading(false);

                if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                  const landmarks = results.multiHandLandmarks[0];
                  const idxTip = landmarks[8];
                  const thumbTip = landmarks[4];

                  // Mirrored webcam coordinates for intuitive user experience
                  const pos: Point = {
                    x: (1 - (idxTip.x + thumbTip.x) / 2) * canvas.width,
                    y: ((idxTip.y + thumbTip.y) / 2) * canvas.height
                  };

                  const dx = idxTip.x - thumbTip.x;
                  const dy = idxTip.y - thumbTip.y;
                  const pDist = Math.sqrt(dx * dx + dy * dy);

                  handTrackerRef.current = {
                    landmarks,
                    pos,
                    pinchDist: pDist,
                    lastUpdated: performance.now()
                  };
                } else {
                  handTrackerRef.current = {
                    landmarks: null,
                    pos: null,
                    pinchDist: 1.0,
                    lastUpdated: performance.now()
                  };
                }
              });

              // Use stable frame loop to feed webcam video to MediaPipe Hands
              const processFrame = async () => {
                if (!isComponentMounted) return;
                if (
                  handsInstance &&
                  videoRef.current &&
                  videoRef.current.readyState >= 2 &&
                  !isProcessingHandFrame.current
                ) {
                  isProcessingHandFrame.current = true;
                  try {
                    await handsInstance.send({ image: videoRef.current });
                  } catch (e) {
                    // Prevent unhandled rejections
                  } finally {
                    isProcessingHandFrame.current = false;
                  }
                }
                if (isComponentMounted) {
                  setTimeout(processFrame, 33); // ~30fps vision detection
                }
              };
              processFrame();
            } catch (err) {
              console.warn("MediaPipe Hands initialization error:", err);
              setLoading(false);
            }
          }
        }
      } catch (camErr) {
        console.warn("Webcam access error:", camErr);
        setLoading(false);
      } finally {
        setLoading(false);
      }
    };

    setupWebcamAndHandTracker();

    // Continuous 60 FPS Game Physics & Render Loop
    const renderGame = () => {
      if (!isComponentMounted) return;
      const now = performance.now();

      if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        const bottomOffset = Math.min(130, Math.max(65, canvas.height * 0.22));
        anchorPos.current = { x: canvas.width / 2, y: canvas.height - bottomOffset };
        if (!isFlying.current && !isPinching.current && !isPointerDragging.current) {
          ballPos.current = { ...anchorPos.current };
        }
        initPitch(canvas.width, canvas.height);
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Mirrored Webcam Video Background
      if (videoRef.current && videoRef.current.readyState >= 2) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      // Pitch Turf & Stadium Overlay
      const pitchGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      pitchGrad.addColorStop(0, 'rgba(10, 20, 15, 0.88)');
      pitchGrad.addColorStop(0.5, 'rgba(14, 25, 18, 0.85)');
      pitchGrad.addColorStop(1, 'rgba(18, 18, 18, 0.92)');
      ctx.fillStyle = pitchGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Turf Grass Stripes
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 40;
      for (let y = 0; y < canvas.height; y += 80) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // --- Draw MediaPipe Hand Skeleton from Hand Tracker ---
      const handData = handTrackerRef.current;
      const isHandActive = handData.landmarks && (now - handData.lastUpdated < 350);

      if (isHandActive && handData.landmarks) {
        if (window.drawConnectors && window.drawLandmarks && window.HAND_CONNECTIONS) {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.translate(-canvas.width, 0);
          window.drawConnectors(ctx, handData.landmarks, window.HAND_CONNECTIONS, { color: '#42a5f5', lineWidth: 2 });
          window.drawLandmarks(ctx, handData.landmarks, { color: '#a8c7fa', lineWidth: 1.5, radius: 3 });
          ctx.restore();
        }

        if (handData.pos) {
          ctx.beginPath();
          ctx.arc(handData.pos.x, handData.pos.y, 22, 0, Math.PI * 2);
          ctx.strokeStyle = handData.pinchDist < PINCH_THRESHOLD ? '#66bb6a' : '#42a5f5';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // --- WEBCAM HAND GESTURE SLINGSHOT DRAG & SHOOT LOGIC ---
      const isLocked = isAiThinkingRef.current;
      const handPos = isHandActive ? handData.pos : null;
      const pinchDist = isHandActive ? handData.pinchDist : 1.0;

      if (!isLocked && handPos && pinchDist < PINCH_THRESHOLD && !isFlying.current) {
        // User is pinching their fingers
        const distToBall = Math.sqrt(Math.pow(handPos.x - ballPos.current.x, 2) + Math.pow(handPos.y - ballPos.current.y, 2));
        const distToAnchor = Math.sqrt(Math.pow(handPos.x - anchorPos.current.x, 2) + Math.pow(handPos.y - anchorPos.current.y, 2));

        if (!isPinching.current && (distToBall < 110 || distToAnchor < 140)) {
          isPinching.current = true;
        }

        if (isPinching.current) {
          // Drag ball with hand motion
          const dragDx = handPos.x - anchorPos.current.x;
          const dragDy = handPos.y - anchorPos.current.y;
          const dragDist = Math.sqrt(dragDx * dragDx + dragDy * dragDy);

          if (dragDist > MAX_DRAG_DIST) {
            const angle = Math.atan2(dragDy, dragDx);
            ballPos.current.x = anchorPos.current.x + Math.cos(angle) * MAX_DRAG_DIST;
            ballPos.current.y = anchorPos.current.y + Math.sin(angle) * MAX_DRAG_DIST;
          } else {
            ballPos.current.x = handPos.x;
            ballPos.current.y = handPos.y;
          }
          ballRotation.current = (ballPos.current.x - anchorPos.current.x) * 0.03;

          // Sound effect: tension stretch
          soundFx.playStretch(Math.min(dragDist / MAX_DRAG_DIST, 1.0));
        }
      } else if (isPinching.current && (!handPos || pinchDist >= PINCH_THRESHOLD || isLocked)) {
        // User released pinch gesture -> Launch the shot!
        isPinching.current = false;
        if (isLocked) {
          ballPos.current = { ...anchorPos.current };
        } else {
          const dx = anchorPos.current.x - ballPos.current.x;
          const dy = anchorPos.current.y - ballPos.current.y;
          const stretchDist = Math.sqrt(dx * dx + dy * dy);

          if (stretchDist > 30) {
            isFlying.current = true;
            flightStartTime.current = now;
            const config = COLOR_CONFIG[selectedColorRef.current];
            const powerRatio = Math.min(stretchDist / MAX_DRAG_DIST, 1.0);
            const velocityMultiplier = (MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio)) * config.powerMultiplier;

            ballVel.current = {
              x: dx * velocityMultiplier,
              y: dy * velocityMultiplier
            };
            ballSpin.current = config.curveFactor * 2.5;

            // Launch kick sound & sparks
            soundFx.playKick(powerRatio);
            createRicochetParticles(ballPos.current.x, ballPos.current.y, config.hex);
          } else {
            ballPos.current = { ...anchorPos.current };
          }
        }
      } else if (!isFlying.current && !isPinching.current) {
        // Smoothly spring ball back to resting anchor
        const dx = anchorPos.current.x - ballPos.current.x;
        const dy = anchorPos.current.y - ballPos.current.y;
        ballPos.current.x += dx * 0.18;
        ballPos.current.y += dy * 0.18;
        ballRotation.current *= 0.85;
      }

      // --- Obstacle Patrol & Movement ---
      const keeper = goalkeeper.current;
      keeper.x += keeper.vx;
      if (keeper.patrolMinX && keeper.x < keeper.patrolMinX) {
        keeper.x = keeper.patrolMinX;
        keeper.vx = Math.abs(keeper.vx);
      } else if (keeper.patrolMaxX && keeper.x > keeper.patrolMaxX) {
        keeper.x = keeper.patrolMaxX;
        keeper.vx = -Math.abs(keeper.vx);
      }

      obstacles.current.forEach(obs => {
        if (!obs.active) return;
        if (obs.vx !== 0) {
          obs.x += obs.vx;
          if (obs.patrolMinX && obs.x < obs.patrolMinX) {
            obs.x = obs.patrolMinX;
            obs.vx = Math.abs(obs.vx);
          } else if (obs.patrolMaxX && obs.x > obs.patrolMaxX) {
            obs.x = obs.patrolMaxX;
            obs.vx = -Math.abs(obs.vx);
          }
        }
      });

      // --- Ball Flight Physics & Collision ---
      if (isFlying.current) {
        if (now - flightStartTime.current > 4500) {
          isFlying.current = false;
          ballPos.current = { ...anchorPos.current };
          ballVel.current = { x: 0, y: 0 };
        } else {
          // Ball Swerve & Curve Physics
          const config = COLOR_CONFIG[selectedColorRef.current];
          ballVel.current.x += ballSpin.current;
          ballVel.current.y += GRAVITY;
          ballVel.current.x *= FRICTION;
          ballVel.current.y *= FRICTION;

          ballPos.current.x += ballVel.current.x;
          ballPos.current.y += ballVel.current.y;
          ballRotation.current += (ballVel.current.x + ballVel.current.y) * 0.04;

          const currentBallRadius = ballRadiusRef.current || 20;

          // Wall Bounces
          if (ballPos.current.x < currentBallRadius) {
            ballPos.current.x = currentBallRadius;
            ballVel.current.x *= -0.85;
            soundFx.playBounce('wall');
            createRicochetParticles(ballPos.current.x, ballPos.current.y, config.hex);
          } else if (ballPos.current.x > canvas.width - currentBallRadius) {
            ballPos.current.x = canvas.width - currentBallRadius;
            ballVel.current.x *= -0.85;
            soundFx.playBounce('wall');
            createRicochetParticles(ballPos.current.x, ballPos.current.y, config.hex);
          }

          // Check Collision with ACTIVE Obstacle Balls (Defenders, Goalkeeper, Bumpers)
          const allActiveObstacles = [...obstacles.current.filter(o => o.active), goalkeeper.current];
          for (const obs of allActiveObstacles) {
            const dist = Math.sqrt(Math.pow(ballPos.current.x - obs.x, 2) + Math.pow(ballPos.current.y - obs.y, 2));
            if (dist < currentBallRadius + obs.radius) {
              const angle = Math.atan2(ballPos.current.y - obs.y, ballPos.current.x - obs.x);
              const speed = Math.sqrt(ballVel.current.x ** 2 + ballVel.current.y ** 2);
              const bounceFactor = obs.type === 'bumper' ? 1.25 : 0.9;

              ballVel.current.x = Math.cos(angle) * speed * bounceFactor;
              ballVel.current.y = Math.sin(angle) * speed * bounceFactor;
              ballPos.current.x = obs.x + Math.cos(angle) * (currentBallRadius + obs.radius + 3);
              ballPos.current.y = obs.y + Math.sin(angle) * (currentBallRadius + obs.radius + 3);

              soundFx.playBounce(obs.type as any);
              createRicochetParticles(ballPos.current.x, ballPos.current.y, obs.color);
              break;
            }
          }

          // Check Goal Scoring Detection using dynamic goal dimensions
          const { x: goalX, y: goalY, width: goalWidth, height: goalHeight } = goalDimensionsRef.current;

          if (
            ballPos.current.y <= goalY + goalHeight &&
            ballPos.current.y >= goalY &&
            ballPos.current.x >= goalX + 12 &&
            ballPos.current.x <= goalX + goalWidth - 12
          ) {
            let matchedPocket = goalPockets.current.find(p => {
              return (
                Math.abs(ballPos.current.x - p.x) < p.width / 2 + 10 &&
                Math.abs(ballPos.current.y - p.y) < p.height / 2 + 10
              );
            });

            if (!matchedPocket) {
              matchedPocket = goalPockets.current[4] || goalPockets.current[0];
            }

            const pointsScored = (matchedPocket?.points || 200) + config.points;
            scoreRef.current += pointsScored;
            streakRef.current += 1;
            setScore(scoreRef.current);
            setStreak(streakRef.current);

            // Add defender ONLY when user scores, respecting strict defender limits
            const newDefenderLabel = addDefenderOnScore(canvas.width);

            // Goal Effects & Sound
            soundFx.playGoal(streakRef.current);
            goalNetRipple.current = 1.0;
            celebrationBanner.current = {
              active: true,
              text: matchedPocket?.label === 'TOP 90' ? 'GOAL! UPPER 90 STRIKE!' : 'GOAL! CLEAN FINISH!',
              subtext: newDefenderLabel 
                ? `+${pointsScored} PTS • ${newDefenderLabel}`
                : `+${pointsScored} POINTS (${config.label})`,
              timer: 2.0,
              color: '#ffd54f'
            };
            createGoalExplosion(ballPos.current.x, ballPos.current.y, config.hex);

            // Reset Shot
            isFlying.current = false;
            ballPos.current = { ...anchorPos.current };
            ballVel.current = { x: 0, y: 0 };

            // Request fresh AI analysis if enabled
            if (geminiHelpEnabledRef.current) {
              setTimeout(() => {
                captureRequestRef.current = true;
              }, 600);
            }
          }

          // Out of Bounds
          if (ballPos.current.y < 20 || ballPos.current.y > canvas.height + 40) {
            isFlying.current = false;
            ballPos.current = { ...anchorPos.current };
            ballVel.current = { x: 0, y: 0 };
            streakRef.current = 0;
            setStreak(0);
          }
        }
      }

      // Net Ripple Decay
      if (goalNetRipple.current > 0) {
        goalNetRipple.current -= 0.03;
      }

      // --- Drawing Scene ---

      // Draw Goal & Field Markings
      drawSoccerGoal(ctx, canvas.width);

      // Draw ACTIVE Obstacle Balls
      obstacles.current.forEach(obs => {
        if (obs.active) drawObstacle(ctx, obs);
      });
      drawObstacle(ctx, goalkeeper.current);

      // Laser Sight & Tactical Guide (Only when Gemini Strategy Help is enabled)
      const currentAimTarget = aimTargetRef.current;
      const thinking = isAiThinkingRef.current;
      const currentSelected = selectedColorRef.current;
      const activeHex = COLOR_CONFIG[currentSelected].hex;

      if (!isFlying.current && geminiHelpEnabledRef.current && (currentAimTarget || thinking)) {
        ctx.save();
        const highlightColor = thinking ? '#a8c7fa' : activeHex;
        ctx.shadowBlur = 15;
        ctx.shadowColor = highlightColor;

        ctx.beginPath();
        ctx.moveTo(anchorPos.current.x, anchorPos.current.y);

        if (currentAimTarget) {
          const midX = (anchorPos.current.x + currentAimTarget.x) / 2 + COLOR_CONFIG[currentSelected].curveFactor * 120;
          const midY = (anchorPos.current.y + currentAimTarget.y) / 2;
          ctx.quadraticCurveTo(midX, midY, currentAimTarget.x, currentAimTarget.y);
        } else {
          ctx.lineTo(anchorPos.current.x, anchorPos.current.y - 240);
        }

        const time = performance.now();
        const dashOffset = (time / 15) % 30;
        ctx.setLineDash([18, 12]);
        ctx.lineDashOffset = -dashOffset;
        ctx.strokeStyle = thinking ? 'rgba(168, 199, 250, 0.5)' : highlightColor;
        ctx.lineWidth = 3.5;
        ctx.stroke();

        if (currentAimTarget && !thinking) {
          ctx.beginPath();
          ctx.arc(currentAimTarget.x, currentAimTarget.y, 22, 0, Math.PI * 2);
          ctx.strokeStyle = highlightColor;
          ctx.setLineDash([5, 5]);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // Responsive Slingshot Dimensions
      const isMobileScreen = canvas.width < 768;
      const slingArmOffset = isMobileScreen ? 34 : 45;
      const slingPedestalW = isMobileScreen ? 36 : 50;
      const slingLineWidth = isMobileScreen ? 8 : 12;
      const activeBallRadius = ballRadiusRef.current || 20;

      // Slingshot Elastic Bands (Back)
      const bandColor = (isPinching.current || isPointerDragging.current) ? '#fdd835' : 'rgba(255,255,255,0.5)';
      if (!isFlying.current) {
        ctx.beginPath();
        ctx.moveTo(anchorPos.current.x - slingArmOffset, anchorPos.current.y + 10);
        ctx.lineTo(ballPos.current.x, ballPos.current.y);
        ctx.lineWidth = isMobileScreen ? 4.5 : 6;
        ctx.strokeStyle = bandColor;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Draw Slingshot Soccer Ball
      ctx.save();
      if (isLocked && !isFlying.current) {
        ctx.globalAlpha = 0.5;
      }
      drawSoccerBall(
        ctx,
        ballPos.current.x,
        ballPos.current.y,
        activeBallRadius,
        ballRotation.current,
        selectedColorRef.current,
        isFlying.current || isPinching.current || isPointerDragging.current
      );
      ctx.restore();

      // Slingshot Elastic Bands (Front)
      if (!isFlying.current) {
        ctx.beginPath();
        ctx.moveTo(ballPos.current.x, ballPos.current.y);
        ctx.lineTo(anchorPos.current.x + slingArmOffset, anchorPos.current.y + 10);
        ctx.lineWidth = isMobileScreen ? 4.5 : 6;
        ctx.strokeStyle = bandColor;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Slingshot Turf Launch Pedestal
      ctx.beginPath();
      ctx.moveTo(anchorPos.current.x, canvas.height);
      ctx.lineTo(anchorPos.current.x, anchorPos.current.y + (isMobileScreen ? 40 : 55));
      ctx.lineTo(anchorPos.current.x - slingPedestalW, anchorPos.current.y + 10);
      ctx.moveTo(anchorPos.current.x, anchorPos.current.y + (isMobileScreen ? 40 : 55));
      ctx.lineTo(anchorPos.current.x + slingPedestalW, anchorPos.current.y + 10);
      ctx.lineWidth = slingLineWidth;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#424242';
      ctx.stroke();

      // Launch Spot Circle on Turf
      ctx.beginPath();
      ctx.ellipse(anchorPos.current.x, anchorPos.current.y + (isMobileScreen ? 38 : 50), isMobileScreen ? 30 : 40, isMobileScreen ? 12 : 16, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fill();

      // Particles (Confetti & Sparks)
      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.025;
        if (p.life <= 0) {
          particles.current.splice(i, 1);
        } else {
          ctx.save();
          ctx.globalAlpha = p.life;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          if (p.type === 'confetti') {
            ctx.rect(p.x, p.y, p.size || 5, (p.size || 5) * 1.5);
          } else {
            ctx.arc(p.x, p.y, p.size || 3, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.restore();
        }
      }

      // In-Game Celebration / Notification Banner (Responsive)
      if (celebrationBanner.current.active) {
        celebrationBanner.current.timer -= 0.02;
        if (celebrationBanner.current.timer <= 0) {
          celebrationBanner.current.active = false;
        } else {
          const bannerW = Math.min(isMobileScreen ? 340 : 460, canvas.width * 0.92);
          const bannerH = isMobileScreen ? 68 : 90;
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height * (isMobileScreen ? 0.32 : 0.35));
          ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
          ctx.fillRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH);
          ctx.strokeStyle = celebrationBanner.current.color;
          ctx.lineWidth = isMobileScreen ? 2 : 3;
          ctx.strokeRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH);

          ctx.fillStyle = celebrationBanner.current.color;
          ctx.font = isMobileScreen ? '900 17px Roboto, sans-serif' : '900 26px Roboto, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(celebrationBanner.current.text, 0, isMobileScreen ? -10 : -12);

          ctx.fillStyle = '#ffffff';
          ctx.font = isMobileScreen ? 'bold 11px Roboto, sans-serif' : 'bold 15px Roboto, sans-serif';
          ctx.fillText(celebrationBanner.current.subtext, 0, isMobileScreen ? 14 : 20);
          ctx.restore();
        }
      }

      ctx.restore();

      // Screenshot capture for field analysis
      if (captureRequestRef.current && geminiHelpEnabledRef.current) {
        captureRequestRef.current = false;
        const offscreen = document.createElement('canvas');
        const targetWidth = 480;
        const scale = Math.min(1, targetWidth / canvas.width);

        offscreen.width = canvas.width * scale;
        offscreen.height = canvas.height * scale;

        const oCtx = offscreen.getContext('2d');
        if (oCtx) {
          oCtx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
          const screenshot = offscreen.toDataURL('image/jpeg', 0.6);
          setTimeout(() => performAiAnalysis(screenshot), 0);
        }
      } else if (captureRequestRef.current && !geminiHelpEnabledRef.current) {
        captureRequestRef.current = false;
      }

      animationFrameId = requestAnimationFrame(renderGame);
    };

    animationFrameId = requestAnimationFrame(renderGame);

    return () => {
      isComponentMounted = false;
      cancelAnimationFrame(animationFrameId);
      if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
      }
      if (cameraInstance && typeof cameraInstance.stop === 'function') {
        try {
          cameraInstance.stop();
        } catch (e) {}
      }
      if (handsInstance && typeof handsInstance.close === 'function') {
        try {
          handsInstance.close();
        } catch (e) {}
      }
    };
  }, [initPitch, addDefenderOnScore]);

  const recColorConfig = aiRecommendedColor ? COLOR_CONFIG[aiRecommendedColor] : null;
  const borderColor = recColorConfig ? recColorConfig.hex : '#444746';

  return (
    <div className="flex flex-col md:flex-row w-full h-screen bg-[#121212] overflow-hidden font-roboto text-[#e3e3e3]">

      {/* UPPER HALF (MOBILE) / LEFT MAIN (DESKTOP): Game Area */}
      <div ref={gameContainerRef} className="h-1/2 md:h-full w-full md:flex-1 relative overflow-hidden select-none touch-none border-b md:border-b-0 border-[#444746]">
        <video ref={videoRef} className="absolute hidden" playsInline />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#121212] z-50">
            <div className="flex flex-col items-center">
              <Loader2 className="w-10 h-10 md:w-12 md:h-12 text-[#42a5f5] animate-spin mb-3" />
              <p className="text-[#e3e3e3] text-sm md:text-lg font-medium">Starting Stadium & Hand Tracker...</p>
            </div>
          </div>
        )}

        {/* Analyzing Overlay - positioned at Slingshot Anchor */}
        {isAiThinking && (
          <div 
            className="absolute left-1/2 -translate-x-1/2 z-50 flex flex-col items-center justify-center pointer-events-none"
            style={{ bottom: '35%', transform: 'translate(-50%, 50%)' }}
          >
            <div className="w-12 h-12 md:w-[72px] md:h-[72px] rounded-full border-4 border-t-[#a8c7fa] border-r-[#a8c7fa] border-b-transparent border-l-transparent animate-spin" />
            <p className="mt-2 md:mt-4 text-[#a8c7fa] font-bold text-[10px] md:text-xs tracking-widest animate-pulse">ANALYZING PITCH...</p>
          </div>
        )}

        {/* HUD: Score Card & Streak Tracker */}
        <div className="absolute top-2.5 left-2.5 md:top-6 md:left-6 z-40 flex items-center gap-2 md:gap-3">
          <div className="bg-[#1e1e1e]/95 p-2.5 md:p-5 rounded-2xl md:rounded-[28px] border border-[#444746] shadow-2xl flex items-center gap-2.5 md:gap-4 min-w-[110px] md:min-w-[180px] backdrop-blur-sm">
            <div className="bg-[#42a5f5]/20 p-2 md:p-3 rounded-full">
              <Trophy className="w-4 h-4 md:w-6 md:h-6 text-[#42a5f5]" />
            </div>
            <div>
              <p className="text-[10px] md:text-xs text-[#c4c7c5] uppercase tracking-wider font-medium">Score</p>
              <p className="text-xl md:text-3xl font-bold text-white leading-none md:leading-normal">{score.toLocaleString()}</p>
            </div>
          </div>

          {streak > 1 && (
            <div className="bg-[#1e1e1e]/95 px-2.5 py-1.5 md:px-4 md:py-3 rounded-xl md:rounded-[24px] border border-[#ffa726] shadow-xl flex items-center gap-1.5 md:gap-2 animate-bounce backdrop-blur-sm">
              <Flame className="w-4 h-4 md:w-5 md:h-5 text-[#ffa726]" />
              <div>
                <p className="text-[8px] md:text-[10px] text-[#ffa726] font-bold uppercase tracking-wider">Streak</p>
                <p className="text-sm md:text-lg font-black text-white leading-none">{streak}x</p>
              </div>
            </div>
          )}
        </div>

        {/* HUD: Ball Style & Technique Picker */}
        <div className="absolute bottom-2 md:bottom-6 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-[#1e1e1e]/95 px-2.5 py-1.5 md:px-6 md:py-4 rounded-full md:rounded-[32px] border border-[#444746] shadow-2xl flex items-center gap-2 md:gap-4 backdrop-blur-sm">
            <div className="hidden md:block mr-2">
              <p className="text-xs text-[#c4c7c5] uppercase font-bold tracking-wider">Ball Technique</p>
              <p className="text-[11px] text-gray-400">{COLOR_CONFIG[selectedColor].technique}</p>
            </div>

            {COLOR_KEYS.filter(c => availableColors.includes(c)).map(color => {
              const isSelected = selectedColor === color;
              const isRecommended = aiRecommendedColor === color;
              const config = COLOR_CONFIG[color];
              
              return (
                <button
                  key={color}
                  onClick={() => {
                    setSelectedColor(color);
                    soundFx.playClick(520);
                  }}
                  title={`${config.label} - ${config.description}`}
                  className={`relative w-8 h-8 md:w-14 md:h-14 rounded-full transition-all duration-300 transform flex items-center justify-center
                    ${isSelected ? 'scale-110 ring-2 md:ring-4 ring-white/60 z-10' : 'opacity-80 hover:opacity-100 hover:scale-105'}
                  `}
                  style={{ 
                    background: `radial-gradient(circle at 35% 35%, ${config.hex}, ${adjustColor(config.hex, -60)})`,
                    boxShadow: isSelected 
                      ? `0 0 16px ${config.hex}, inset 0 -3px 3px rgba(0,0,0,0.3)`
                      : '0 2px 4px rgba(0,0,0,0.3), inset 0 -3px 3px rgba(0,0,0,0.3)'
                  }}
                >
                  {/* Soccer ball seam icon graphic on button */}
                  <div className="w-3.5 h-3.5 md:w-5 md:h-5 rounded-full border border-black/40 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 md:w-2.5 md:h-2.5 bg-black/50 rounded-sm transform rotate-45" />
                  </div>

                  {/* Glossy highlight */}
                  <div className="absolute top-1 left-2 md:top-2 md:left-3 w-2.5 md:w-4 h-1.5 md:h-2 bg-white/40 rounded-full transform -rotate-45 filter blur-[1px]" />
                  
                  {isRecommended && !isSelected && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-white text-black text-[8px] md:text-[10px] font-bold flex items-center justify-center rounded-full animate-bounce shadow-md">!</span>
                  )}
                  {isSelected && (
                    <MousePointerClick className="w-3.5 h-3.5 md:w-6 md:h-6 text-white/90 drop-shadow-md absolute" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom Gesture Guidance Tip */}
        {!isPinching.current && !isPointerDragging.current && !isFlying.current && !isAiThinking && (
          <div className="absolute bottom-12 md:bottom-28 left-1/2 -translate-x-1/2 z-30 pointer-events-none opacity-85">
            <div className="flex items-center gap-1.5 md:gap-2 bg-[#1e1e1e]/95 px-3 py-1 md:px-5 md:py-2.5 rounded-full border border-[#444746] backdrop-blur-sm shadow-xl">
              <Play className="w-3 md:w-3.5 h-3 md:h-3.5 text-[#42a5f5] fill-current" />
              <p className="text-[#e3e3e3] text-[10px] md:text-xs font-semibold whitespace-nowrap">Drag Ball or Pinch Fingers to Shoot</p>
            </div>
          </div>
        )}
      </div>

      {/* LOWER HALF (MOBILE) / RIGHT SIDEBAR (DESKTOP): Flash Strategy & Debug Panel */}
      <div className="h-1/2 md:h-full w-full md:w-[380px] bg-[#1e1e1e] md:border-l border-[#444746] flex flex-col overflow-hidden shadow-2xl z-20">
        
        {/* FLASH STRATEGY SECTION */}
        <div 
          className="p-3.5 md:p-5 border-b-2 md:border-b-4 transition-colors duration-500 flex flex-col gap-2 shrink-0"
          style={{ 
            backgroundColor: '#252525',
            borderColor: geminiHelpEnabled ? borderColor : '#444746'
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 md:w-5 md:h-5" style={{ color: geminiHelpEnabled ? borderColor : '#757575' }} />
              <h2 className="font-bold text-xs md:text-sm tracking-widest uppercase" style={{ color: geminiHelpEnabled ? borderColor : '#c4c7c5' }}>
                Flash Strategy
              </h2>
            </div>
            
            <div className="flex items-center gap-2">
              {isAiThinking && <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin text-white/50" />}
              
              {/* Gemini Help Toggle */}
              <button
                onClick={handleToggleGeminiHelp}
                className={`px-2.5 py-1 rounded-full text-[10px] md:text-[11px] font-bold tracking-wider flex items-center gap-1.5 transition-all border ${
                  geminiHelpEnabled 
                    ? 'bg-[#a8c7fa]/20 border-[#a8c7fa]/50 text-[#a8c7fa] hover:bg-[#a8c7fa]/30' 
                    : 'bg-[#303030] border-[#555] text-gray-400 hover:text-white'
                }`}
                title="Toggle Gemini Strategy Guidance"
              >
                <Sparkles className="w-3 h-3" />
                <span>{geminiHelpEnabled ? 'AI ON' : 'AI OFF'}</span>
              </button>

              {/* Sound Mute/Unmute Toggle */}
              <button
                onClick={handleToggleSound}
                className={`p-1.5 rounded-full transition-colors ${soundEnabled ? 'text-[#42a5f5] hover:text-[#90caf9]' : 'text-gray-500 hover:text-gray-300'}`}
                title={soundEnabled ? 'Mute Sound Effects' : 'Unmute Sound Effects'}
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>
          </div>
          
          <p className="text-[#e3e3e3] text-xs md:text-sm leading-relaxed font-bold">
            {geminiHelpEnabled ? aiHint : 'Gemini Strategy Assistance is disabled. Toggle AI ON above to receive live tactical hints & aim guides.'}
          </p>
          
          {geminiHelpEnabled && aiRationale && (
            <div className="flex gap-1.5 md:gap-2 mt-0.5">
              <Lightbulb className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#a8c7fa] shrink-0 mt-0.5" />
              <p className="text-[#a8c7fa] text-[11px] md:text-xs italic opacity-90 leading-tight">
                {aiRationale}
              </p>
            </div>
          )}
          
          {geminiHelpEnabled && aiRecommendedColor && (
            <div className="flex items-center gap-2 mt-1.5 bg-black/20 p-1.5 md:p-2 rounded">
              <Target className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-400" />
              <span className="text-[10px] md:text-xs text-gray-400 uppercase tracking-wide">Rec. Technique:</span>
              <span className="text-[10px] md:text-xs font-bold uppercase" style={{ color: COLOR_CONFIG[aiRecommendedColor].hex }}>
                {COLOR_CONFIG[aiRecommendedColor].label}
              </span>
            </div>
          )}
        </div>

        {/* DEBUG HEADER */}
        <div className="p-2 md:p-3 border-b border-[#444746] bg-[#1e1e1e] flex items-center gap-2 text-[#757575] shrink-0">
          <Terminal className="w-3.5 h-3.5 md:w-4 md:h-4" />
          <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider">Debugger & Tactical Stream</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 md:space-y-6">
          
          {/* Status Section */}
          <div>
            <div className="flex items-center gap-2 mb-1.5 text-[#c4c7c5] text-[10px] md:text-xs font-bold uppercase tracking-wider">
              <BrainCircuit className="w-3 h-3" /> Status
            </div>
            <div className={`p-2.5 md:p-3 rounded-lg border ${isAiThinking ? 'bg-[#a8c7fa]/10 border-[#a8c7fa]/30 text-[#a8c7fa]' : 'bg-[#444746]/20 border-[#444746]/50 text-[#c4c7c5]'}`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isAiThinking ? 'bg-[#a8c7fa] animate-pulse' : 'bg-[#66bb6a]'}`} />
                <span className="text-xs md:text-sm font-mono">{isAiThinking ? 'Processing Vision...' : 'Tactical Vision Ready'}</span>
              </div>
            </div>
          </div>

          {/* Vision Input */}
          {debugInfo?.screenshotBase64 && (
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-[#c4c7c5] text-[10px] md:text-xs font-bold uppercase tracking-wider">
                <Eye className="w-3 h-3" /> Vision Input
              </div>
              <div className="rounded-lg overflow-hidden border border-[#444746] bg-black/50 relative group max-w-[280px]">
                <img src={debugInfo.screenshotBase64} alt="AI Vision" className="w-full h-auto opacity-80 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-[9px] text-center text-gray-400 font-mono">
                  Sent to gemini-3.7-flash
                </div>
              </div>
            </div>
          )}

          {/* Prompt Context */}
          {debugInfo?.promptContext && (
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-[#c4c7c5] text-[10px] md:text-xs font-bold uppercase tracking-wider">
                <Terminal className="w-3 h-3" /> Tactical Context
              </div>
              <div className="bg-[#121212] p-2.5 md:p-3 rounded-lg border border-[#444746] font-mono text-[9px] md:text-[10px] text-gray-400 h-24 md:h-32 overflow-y-auto whitespace-pre-wrap leading-tight">
                {debugInfo.promptContext}
              </div>
            </div>
          )}

          {/* AI Output Stats */}
          {debugInfo && (
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-[#c4c7c5] text-[10px] md:text-xs font-bold uppercase tracking-wider">
                <BrainCircuit className="w-3 h-3" /> AI Output
              </div>
              
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-[#2a2a2a] p-2 rounded border border-[#444746]">
                  <p className="text-[9px] text-gray-500 mb-0.5">Latency</p>
                  <div className="flex items-center gap-1 text-[#a8c7fa] font-mono font-bold text-xs md:text-sm">
                    {debugInfo.latency}ms
                  </div>
                </div>
                <div className="bg-[#2a2a2a] p-2 rounded border border-[#444746]">
                  <p className="text-[9px] text-gray-500 mb-0.5">Rec. Technique</p>
                  <div className="flex items-center gap-1 text-[#e3e3e3] font-mono font-bold capitalize text-xs md:text-sm">
                    {debugInfo.parsedResponse?.recommendedColor || '--'}
                  </div>
                </div>
              </div>

              {debugInfo.error && (
                <div className="bg-[#ef5350]/10 border border-[#ef5350]/30 p-2.5 rounded-lg mb-3">
                  <div className="flex items-start gap-2 text-[#ef5350]">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] font-bold">PARSE ERROR DETAILS</p>
                      <p className="text-[9px] font-mono mt-0.5 break-all">{debugInfo.error}</p>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[9px] text-gray-500 mb-1">Raw Response Text</p>
              <div className="bg-[#121212] p-2.5 rounded-lg border border-[#444746] font-mono text-[10px] text-[#66bb6a] max-h-32 md:max-h-40 overflow-y-auto whitespace-pre-wrap mb-3 border-l-2 border-l-[#66bb6a]">
                {debugInfo.rawResponse}
              </div>

              <p className="text-[9px] text-gray-500 mb-1">Parsed JSON</p>
              <div className="bg-[#121212] p-2.5 rounded-lg border border-[#444746] font-mono text-[9px] text-[#a8c7fa] overflow-x-auto">
                <pre>{JSON.stringify(debugInfo.parsedResponse || { error: "Local engine active" }, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-2 md:p-3 bg-[#252525] border-t border-[#444746] text-center shrink-0">
          <p className="text-[9px] md:text-[10px] text-gray-500 font-medium">Powered by Google Gemini 3 Flash</p>
        </div>
      </div>
    </div>
  );
};

export default GeminiSlingshot;
