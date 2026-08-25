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
const SLINGSHOT_BOTTOM_OFFSET = 200;
const MAX_DRAG_DIST = 170;
const MIN_FORCE_MULT = 0.16;
const MAX_FORCE_MULT = 0.46;

// Material Design Colors & Shot Technique Strategy
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
  
  // Webcam Hand Motion Dragging
  const isPinching = useRef<boolean>(false);
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
  const geminiHelpEnabledRef = useRef<boolean>(true);
  
  // React State
  const [loading, setLoading] = useState(true);
  const [geminiHelpEnabled, setGeminiHelpEnabled] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [aiHint, setAiHint] = useState<string | null>("Analyzing goal openings & single defender lane...");
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [aimTarget, setAimTarget] = useState<Point | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedColor, setSelectedColor] = useState<BallColor>('orange');
  const [availableColors] = useState<BallColor[]>(COLOR_KEYS);
  const [aiRecommendedColor, setAiRecommendedColor] = useState<BallColor | null>('orange');
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

  // Generate soccer goal & field layout with ONLY 1 INITIAL DEFENDER
  const initPitch = useCallback((width: number, height: number) => {
    const goalWidth = Math.min(width * 0.58, 540);
    const goalHeight = 120;
    const goalX = (width - goalWidth) / 2;
    const goalY = 55;

    // 5 Strategic Goal Scoring Pockets
    const pockets: GoalPocket[] = [
      {
        id: 'top-left',
        name: 'Top-Left 90',
        col: 0,
        row: 0,
        x: goalX + 45,
        y: goalY + 30,
        width: 80,
        height: 50,
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
        x: goalX + goalWidth - 45,
        y: goalY + 30,
        width: 80,
        height: 50,
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
        x: goalX + 55,
        y: goalY + goalHeight - 25,
        width: 80,
        height: 45,
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
        x: goalX + goalWidth - 55,
        y: goalY + goalHeight - 25,
        width: 80,
        height: 45,
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
        y: goalY + 35,
        width: 100,
        height: 45,
        points: 200,
        color: 'red',
        label: 'ROOF NET',
        description: 'Blasted high into center net'
      }
    ];
    goalPockets.current = pockets;

    // Goalkeeper positioning along goal line
    goalkeeper.current = {
      id: 'keeper',
      x: goalX + goalWidth / 2,
      y: goalY + goalHeight - 20,
      radius: 28,
      vx: 2.6,
      vy: 0,
      type: 'keeper',
      color: '#ffca28',
      patrolMinX: goalX + 60,
      patrolMaxX: goalX + goalWidth - 60,
      active: true,
      label: 'GK'
    };

    // Full Obstacle Roster (Starts with ONLY ONE ACTIVE DEFENDER)
    defenderLevelRef.current = 1;
    totalDefendersAllowedRef.current = 1;
    lastDefenderSpawnTimeRef.current = performance.now();

    const roster: ObstacleBall[] = [
      // Defender 1: Central patrol defender (STARTING DEFENDER)
      {
        id: 'def-1',
        x: width / 2,
        y: goalY + 190,
        radius: 27,
        vx: 1.8,
        vy: 0,
        patrolMinX: width / 2 - 130,
        patrolMaxX: width / 2 + 130,
        type: 'defender',
        color: '#e53935',
        active: true, // Only 1 active initially!
        label: 'DEF 1'
      },
      // Defender 2: Right-wing sweeping defender (Unlocks overtime)
      {
        id: 'def-2',
        x: width / 2 + 140,
        y: goalY + 160,
        radius: 26,
        vx: -1.6,
        vy: 0,
        patrolMinX: width / 2 + 40,
        patrolMaxX: width / 2 + 200,
        type: 'defender',
        color: '#e53935',
        active: false,
        label: 'DEF 2'
      },
      // Defender 3: Left-wing sweeping defender (Unlocks overtime)
      {
        id: 'def-3',
        x: width / 2 - 140,
        y: goalY + 160,
        radius: 26,
        vx: 1.6,
        vy: 0,
        patrolMinX: width / 2 - 200,
        patrolMaxX: width / 2 - 40,
        type: 'defender',
        color: '#e53935',
        active: false,
        label: 'DEF 3'
      },
      // Defender 4 / Stopper: Midfield Energy Bumper (Unlocks overtime)
      {
        id: 'def-bumper',
        x: width / 2,
        y: goalY + 260,
        radius: 28,
        vx: 1.2,
        vy: 0,
        patrolMinX: width / 2 - 90,
        patrolMaxX: width / 2 + 90,
        type: 'bumper',
        color: '#8e24aa',
        active: false,
        label: 'BUMPER'
      },
      // Defender 5: Outer Wing Barrier Cone (Unlocks overtime)
      {
        id: 'def-cone-left',
        x: width / 2 - 220,
        y: goalY + 230,
        radius: 22,
        vx: 0,
        vy: 0,
        type: 'cone',
        color: '#ffa000',
        active: false,
        label: 'BARRIER'
      }
    ];
    obstacles.current = roster;

    // Initial AI analysis (if Gemini help is enabled)
    if (geminiHelpEnabledRef.current) {
      setTimeout(() => {
        captureRequestRef.current = true;
      }, 1000);
    }
  }, []);

  // Dynamically add a defender strictly when user scores a goal
  const addDefenderOnScore = useCallback((canvasWidth: number) => {
    const inactiveObstacles = obstacles.current.filter(o => !o.active);
    let addedLabel = '';

    if (inactiveObstacles.length > 0) {
      const nextDefender = inactiveObstacles[0];
      nextDefender.active = true;
      totalDefendersAllowedRef.current += 1;
      defenderLevelRef.current += 1;
      addedLabel = nextDefender.label || `DEF ${totalDefendersAllowedRef.current}`;
    } else {
      // If all initial defenders are active, spawn an additional roving defender
      const count = obstacles.current.length + 1;
      const newDef: ObstacleBall = {
        id: `def-${count}`,
        x: canvasWidth * (0.25 + Math.random() * 0.5),
        y: 55 + 130 + Math.random() * 140,
        radius: 26,
        vx: (Math.random() > 0.5 ? 1 : -1) * (1.6 + Math.random() * 0.6),
        vy: 0,
        patrolMinX: canvasWidth * 0.2,
        patrolMaxX: canvasWidth * 0.8,
        type: 'defender',
        color: '#e53935',
        active: true,
        label: `DEF ${count}`
      };
      obstacles.current.push(newDef);
      totalDefendersAllowedRef.current += 1;
      defenderLevelRef.current += 1;
      addedLabel = newDef.label;
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

    for (let i = 1; i < steps - 1; i++) {
      const t = i / steps;
      const cx = startX + dx * t;
      const cy = startY + dy * t;

      for (const obs of allObstacles) {
        const d = Math.sqrt(Math.pow(cx - obs.x, 2) + Math.pow(cy - obs.y, 2));
        if (d < minObstacleDist) minObstacleDist = d;
        if (d < obs.radius + BALL_RADIUS * 0.8) {
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
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Goalkeeper Glove Badges
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x - r * 0.85, y, 7, 0, Math.PI * 2);
      ctx.arc(x + r * 0.85, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f57f17';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#212121';
      ctx.font = 'bold 12px Roboto, sans-serif';
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
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();

      // Jersey Stripes
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 5, y - r, 10, r * 2);
      ctx.restore();

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Roboto, sans-serif';
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
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.65, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px Roboto, sans-serif';
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
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    ctx.restore();
  };

  // Draw Soccer Goal Structure & Net
  const drawSoccerGoal = (ctx: CanvasRenderingContext2D, width: number) => {
    const goalWidth = Math.min(width * 0.58, 540);
    const goalHeight = 120;
    const goalX = (width - goalWidth) / 2;
    const goalY = 55;
    const postRadius = 7;

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

  // --- Main Webcam Hand Tracking & 60 FPS Game Loop ---

  useEffect(() => {
    if (!canvasRef.current || !gameContainerRef.current) return;

    const canvas = canvasRef.current;
    const container = gameContainerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    anchorPos.current = { x: canvas.width / 2, y: canvas.height - SLINGSHOT_BOTTOM_OFFSET };
    ballPos.current = { ...anchorPos.current };

    initPitch(canvas.width, canvas.height);

    let animationFrameId: number;
    let handsInstance: any = null;
    let cameraInstance: any = null;
    let cameraStream: MediaStream | null = null;
    let isComponentMounted = true;

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
        anchorPos.current = { x: canvas.width / 2, y: canvas.height - SLINGSHOT_BOTTOM_OFFSET };
        if (!isFlying.current && !isPinching.current) {
          ballPos.current = { ...anchorPos.current };
        }
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

          // Wall Bounces
          if (ballPos.current.x < BALL_RADIUS) {
            ballPos.current.x = BALL_RADIUS;
            ballVel.current.x *= -0.85;
            soundFx.playBounce('wall');
            createRicochetParticles(ballPos.current.x, ballPos.current.y, config.hex);
          } else if (ballPos.current.x > canvas.width - BALL_RADIUS) {
            ballPos.current.x = canvas.width - BALL_RADIUS;
            ballVel.current.x *= -0.85;
            soundFx.playBounce('wall');
            createRicochetParticles(ballPos.current.x, ballPos.current.y, config.hex);
          }

          // Check Collision with ACTIVE Obstacle Balls (Defenders, Goalkeeper, Bumpers)
          const allActiveObstacles = [...obstacles.current.filter(o => o.active), goalkeeper.current];
          for (const obs of allActiveObstacles) {
            const dist = Math.sqrt(Math.pow(ballPos.current.x - obs.x, 2) + Math.pow(ballPos.current.y - obs.y, 2));
            if (dist < BALL_RADIUS + obs.radius) {
              const angle = Math.atan2(ballPos.current.y - obs.y, ballPos.current.x - obs.x);
              const speed = Math.sqrt(ballVel.current.x ** 2 + ballVel.current.y ** 2);
              const bounceFactor = obs.type === 'bumper' ? 1.25 : 0.9;

              ballVel.current.x = Math.cos(angle) * speed * bounceFactor;
              ballVel.current.y = Math.sin(angle) * speed * bounceFactor;
              ballPos.current.x = obs.x + Math.cos(angle) * (BALL_RADIUS + obs.radius + 3);
              ballPos.current.y = obs.y + Math.sin(angle) * (BALL_RADIUS + obs.radius + 3);

              soundFx.playBounce(obs.type as any);
              createRicochetParticles(ballPos.current.x, ballPos.current.y, obs.color);
              break;
            }
          }

          // Check Goal Scoring Detection
          const goalWidth = Math.min(canvas.width * 0.58, 540);
          const goalHeight = 120;
          const goalX = (canvas.width - goalWidth) / 2;
          const goalY = 55;

          if (
            ballPos.current.y <= goalY + goalHeight &&
            ballPos.current.y >= goalY &&
            ballPos.current.x >= goalX + 15 &&
            ballPos.current.x <= goalX + goalWidth - 15
          ) {
            let matchedPocket = goalPockets.current.find(p => {
              return (
                Math.abs(ballPos.current.x - p.x) < p.width / 2 + 10 &&
                Math.abs(ballPos.current.y - p.y) < p.height / 2 + 10
              );
            });

            if (!matchedPocket) {
              matchedPocket = goalPockets.current[4];
            }

            const pointsScored = matchedPocket.points + config.points;
            scoreRef.current += pointsScored;
            streakRef.current += 1;
            setScore(scoreRef.current);
            setStreak(streakRef.current);

            // Add defender ONLY when user scores!
            const newDefenderLabel = addDefenderOnScore(canvas.width);

            // Goal Effects & Sound
            soundFx.playGoal(streakRef.current);
            goalNetRipple.current = 1.0;
            celebrationBanner.current = {
              active: true,
              text: matchedPocket.label === 'TOP 90' ? 'GOAL! UPPER 90 STRIKE!' : 'GOAL! CLEAN FINISH!',
              subtext: newDefenderLabel 
                ? `+${pointsScored} PTS • DEFENDER ADDED (${newDefenderLabel})`
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
          if (ballPos.current.y < 30 || ballPos.current.y > canvas.height + 40) {
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

      // Slingshot Elastic Bands (Back)
      const bandColor = isPinching.current ? '#fdd835' : 'rgba(255,255,255,0.5)';
      if (!isFlying.current) {
        ctx.beginPath();
        ctx.moveTo(anchorPos.current.x - 45, anchorPos.current.y + 10);
        ctx.lineTo(ballPos.current.x, ballPos.current.y);
        ctx.lineWidth = 6;
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
        BALL_RADIUS,
        ballRotation.current,
        selectedColorRef.current,
        isFlying.current || isPinching.current
      );
      ctx.restore();

      // Slingshot Elastic Bands (Front)
      if (!isFlying.current) {
        ctx.beginPath();
        ctx.moveTo(ballPos.current.x, ballPos.current.y);
        ctx.lineTo(anchorPos.current.x + 45, anchorPos.current.y + 10);
        ctx.lineWidth = 6;
        ctx.strokeStyle = bandColor;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Slingshot Turf Launch Pedestal
      ctx.beginPath();
      ctx.moveTo(anchorPos.current.x, canvas.height);
      ctx.lineTo(anchorPos.current.x, anchorPos.current.y + 55);
      ctx.lineTo(anchorPos.current.x - 50, anchorPos.current.y + 10);
      ctx.moveTo(anchorPos.current.x, anchorPos.current.y + 55);
      ctx.lineTo(anchorPos.current.x + 50, anchorPos.current.y + 10);
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#424242';
      ctx.stroke();

      // Launch Spot Circle on Turf
      ctx.beginPath();
      ctx.ellipse(anchorPos.current.x, anchorPos.current.y + 50, 40, 16, 0, 0, Math.PI * 2);
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

      // In-Game Celebration / Notification Banner
      if (celebrationBanner.current.active) {
        celebrationBanner.current.timer -= 0.02;
        if (celebrationBanner.current.timer <= 0) {
          celebrationBanner.current.active = false;
        } else {
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height * 0.35);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
          ctx.fillRect(-230, -45, 460, 90);
          ctx.strokeStyle = celebrationBanner.current.color;
          ctx.lineWidth = 3;
          ctx.strokeRect(-230, -45, 460, 90);

          ctx.fillStyle = celebrationBanner.current.color;
          ctx.font = '900 26px Roboto, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(celebrationBanner.current.text, 0, -12);

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 15px Roboto, sans-serif';
          ctx.fillText(celebrationBanner.current.subtext, 0, 20);
          ctx.restore();
        }
      }

      ctx.restore();

      // Screenshot Capture for AI Vision (Only when Gemini Strategy Help is enabled)
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
    <div className="flex w-full h-screen bg-[#121212] overflow-hidden font-roboto text-[#e3e3e3]">
      
      {/* MOBILE/TABLET BLOCKER OVERLAY */}
      <div className="fixed inset-0 z-[100] bg-[#121212] flex flex-col items-center justify-center p-8 text-center md:hidden">
        <Monitor className="w-16 h-16 text-[#ef5350] mb-6 animate-pulse" />
        <h2 className="text-2xl font-bold text-[#e3e3e3] mb-4">Desktop View Required</h2>
        <p className="text-[#c4c7c5] max-w-md text-lg leading-relaxed">
          This soccer slingshot requires a larger screen for webcam hand tracking & field trajectory mechanics.
        </p>
        <div className="mt-8 flex items-center gap-2 text-sm text-[#757575] uppercase tracking-wider font-bold">
          <div className="w-2 h-2 bg-[#42a5f5] rounded-full"></div>
          Please maximize window
        </div>
      </div>

      {/* LEFT: Game Area */}
      <div ref={gameContainerRef} className="flex-1 relative h-full overflow-hidden select-none">
        <video ref={videoRef} className="absolute hidden" playsInline />
        <canvas ref={canvasRef} className="absolute inset-0" />

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#121212] z-50">
            <div className="flex flex-col items-center">
              <Loader2 className="w-12 h-12 text-[#42a5f5] animate-spin mb-4" />
              <p className="text-[#e3e3e3] text-lg font-medium">Starting Stadium & Hand Tracker...</p>
            </div>
          </div>
        )}

        {/* Analyzing Overlay - positioned at Slingshot Anchor */}
        {isAiThinking && (
          <div 
            className="absolute left-1/2 -translate-x-1/2 z-50 flex flex-col items-center justify-center pointer-events-none"
            style={{ bottom: '200px', transform: 'translate(-50%, 50%)' }}
          >
            <div className="w-[72px] h-[72px] rounded-full border-4 border-t-[#a8c7fa] border-r-[#a8c7fa] border-b-transparent border-l-transparent animate-spin" />
            <p className="mt-4 text-[#a8c7fa] font-bold text-xs tracking-widest animate-pulse">ANALYZING PITCH...</p>
          </div>
        )}

        {/* HUD: Score Card & Streak Tracker */}
        <div className="absolute top-6 left-6 z-40 flex items-center gap-3">
          <div className="bg-[#1e1e1e] p-5 rounded-[28px] border border-[#444746] shadow-2xl flex items-center gap-4 min-w-[180px]">
            <div className="bg-[#42a5f5]/20 p-3 rounded-full">
              <Trophy className="w-6 h-6 text-[#42a5f5]" />
            </div>
            <div>
              <p className="text-xs text-[#c4c7c5] uppercase tracking-wider font-medium">Score</p>
              <p className="text-3xl font-bold text-white">{score.toLocaleString()}</p>
            </div>
          </div>

          {streak > 1 && (
            <div className="bg-[#1e1e1e] px-4 py-3 rounded-[24px] border border-[#ffa726] shadow-xl flex items-center gap-2 animate-bounce">
              <Flame className="w-5 h-5 text-[#ffa726]" />
              <div>
                <p className="text-[10px] text-[#ffa726] font-bold uppercase tracking-wider">Goal Streak</p>
                <p className="text-lg font-black text-white">{streak}x</p>
              </div>
            </div>
          )}
        </div>

        {/* HUD: Ball Style & Technique Picker */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-[#1e1e1e] px-6 py-4 rounded-[32px] border border-[#444746] shadow-2xl flex items-center gap-4">
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
                  className={`relative w-14 h-14 rounded-full transition-all duration-300 transform flex items-center justify-center
                    ${isSelected ? 'scale-110 ring-4 ring-white/50 z-10' : 'opacity-80 hover:opacity-100 hover:scale-105'}
                  `}
                  style={{ 
                    background: `radial-gradient(circle at 35% 35%, ${config.hex}, ${adjustColor(config.hex, -60)})`,
                    boxShadow: isSelected 
                      ? `0 0 20px ${config.hex}, inset 0 -4px 4px rgba(0,0,0,0.3)`
                      : '0 4px 6px rgba(0,0,0,0.3), inset 0 -4px 4px rgba(0,0,0,0.3)'
                  }}
                >
                  {/* Soccer ball seam icon graphic on button */}
                  <div className="w-5 h-5 rounded-full border border-black/40 flex items-center justify-center">
                    <div className="w-2.5 h-2.5 bg-black/50 rounded-sm transform rotate-45" />
                  </div>

                  {/* Glossy highlight */}
                  <div className="absolute top-2 left-3 w-4 h-2 bg-white/40 rounded-full transform -rotate-45 filter blur-[1px]" />
                  
                  {isRecommended && !isSelected && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-black text-[10px] font-bold flex items-center justify-center rounded-full animate-bounce shadow-md">!</span>
                  )}
                  {isSelected && (
                    <MousePointerClick className="w-6 h-6 text-white/90 drop-shadow-md absolute" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom Gesture Guidance Tip */}
        {!isPinching.current && !isFlying.current && !isAiThinking && (
          <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 pointer-events-none opacity-80">
            <div className="flex items-center gap-2 bg-[#1e1e1e]/95 px-5 py-2.5 rounded-full border border-[#444746] backdrop-blur-sm shadow-xl">
              <Play className="w-3.5 h-3.5 text-[#42a5f5] fill-current" />
              <p className="text-[#e3e3e3] text-xs font-semibold">Pinch Fingers (Index + Thumb) to Grab & Drag Slingshot</p>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Debug Panel */}
      <div className="w-[380px] bg-[#1e1e1e] border-l border-[#444746] flex flex-col h-full overflow-hidden shadow-2xl">
        
        {/* FLASH STRATEGY SECTION */}
        <div 
          className="p-5 border-b-4 transition-colors duration-500 flex flex-col gap-2"
          style={{ 
            backgroundColor: '#252525',
            borderColor: geminiHelpEnabled ? borderColor : '#444746'
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5" style={{ color: geminiHelpEnabled ? borderColor : '#757575' }} />
              <h2 className="font-bold text-sm tracking-widest uppercase" style={{ color: geminiHelpEnabled ? borderColor : '#c4c7c5' }}>
                Flash Strategy
              </h2>
            </div>
            
            <div className="flex items-center gap-2">
              {isAiThinking && <Loader2 className="w-4 h-4 animate-spin text-white/50" />}
              
              {/* Gemini Help Toggle */}
              <button
                onClick={handleToggleGeminiHelp}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wider flex items-center gap-1.5 transition-all border ${
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
          
          <p className="text-[#e3e3e3] text-sm leading-relaxed font-bold">
            {geminiHelpEnabled ? aiHint : 'Gemini Strategy Assistance is disabled. Toggle AI ON above to receive live tactical hints & aim guides.'}
          </p>
          
          {geminiHelpEnabled && aiRationale && (
            <div className="flex gap-2 mt-1">
              <Lightbulb className="w-4 h-4 text-[#a8c7fa] shrink-0 mt-0.5" />
              <p className="text-[#a8c7fa] text-xs italic opacity-90 leading-tight">
                {aiRationale}
              </p>
            </div>
          )}
          
          {geminiHelpEnabled && aiRecommendedColor && (
            <div className="flex items-center gap-2 mt-3 bg-black/20 p-2 rounded">
              <Target className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-400 uppercase tracking-wide">Rec. Technique:</span>
              <span className="text-xs font-bold uppercase" style={{ color: COLOR_CONFIG[aiRecommendedColor].hex }}>
                {COLOR_CONFIG[aiRecommendedColor].label}
              </span>
            </div>
          )}
        </div>

        {/* DEBUG HEADER */}
        <div className="p-3 border-b border-[#444746] bg-[#1e1e1e] flex items-center gap-2 text-[#757575]">
          <Terminal className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Debugger</span>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* Status Section */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider">
              <BrainCircuit className="w-3 h-3" /> Status
            </div>
            <div className={`p-3 rounded-lg border ${isAiThinking ? 'bg-[#a8c7fa]/10 border-[#a8c7fa]/30 text-[#a8c7fa]' : 'bg-[#444746]/20 border-[#444746]/50 text-[#c4c7c5]'}`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isAiThinking ? 'bg-[#a8c7fa] animate-pulse' : 'bg-[#66bb6a]'}`} />
                <span className="text-sm font-mono">{isAiThinking ? 'Processing Vision...' : 'Tactical Vision Ready'}</span>
              </div>
            </div>
          </div>

          {/* Vision Input */}
          {debugInfo?.screenshotBase64 && (
            <div>
              <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider">
                <Eye className="w-3 h-3" /> Vision Input
              </div>
              <div className="rounded-lg overflow-hidden border border-[#444746] bg-black/50 relative group">
                <img src={debugInfo.screenshotBase64} alt="AI Vision" className="w-full h-auto opacity-80 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-[10px] text-center text-gray-400 font-mono">
                  Sent to gemini-3.7-flash
                </div>
              </div>
            </div>
          )}

          {/* Prompt Context */}
          {debugInfo?.promptContext && (
            <div>
              <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider">
                <Terminal className="w-3 h-3" /> Tactical Context
              </div>
              <div className="bg-[#121212] p-3 rounded-lg border border-[#444746] font-mono text-[10px] text-gray-400 h-32 overflow-y-auto whitespace-pre-wrap leading-tight">
                {debugInfo.promptContext}
              </div>
            </div>
          )}

          {/* AI Output Stats */}
          {debugInfo && (
            <div>
              <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase tracking-wider">
                <BrainCircuit className="w-3 h-3" /> AI Output
              </div>
              
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-[#2a2a2a] p-2 rounded border border-[#444746]">
                  <p className="text-[10px] text-gray-500 mb-1">Latency</p>
                  <div className="flex items-center gap-1 text-[#a8c7fa] font-mono font-bold">
                    {debugInfo.latency}ms
                  </div>
                </div>
                <div className="bg-[#2a2a2a] p-2 rounded border border-[#444746]">
                  <p className="text-[10px] text-gray-500 mb-1">Rec. Technique</p>
                  <div className="flex items-center gap-1 text-[#e3e3e3] font-mono font-bold capitalize">
                    {debugInfo.parsedResponse?.recommendedColor || '--'}
                  </div>
                </div>
              </div>

              {debugInfo.error && (
                <div className="bg-[#ef5350]/10 border border-[#ef5350]/30 p-3 rounded-lg mb-3">
                  <div className="flex items-start gap-2 text-[#ef5350]">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-bold">PARSE ERROR DETAILS</p>
                      <p className="text-[10px] font-mono mt-1 break-all">{debugInfo.error}</p>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-gray-500 mb-1">Raw Response Text</p>
              <div className="bg-[#121212] p-3 rounded-lg border border-[#444746] font-mono text-[11px] text-[#66bb6a] max-h-40 overflow-y-auto whitespace-pre-wrap mb-3 border-l-2 border-l-[#66bb6a]">
                {debugInfo.rawResponse}
              </div>

              <p className="text-[10px] text-gray-500 mb-1">Parsed JSON</p>
              <div className="bg-[#121212] p-3 rounded-lg border border-[#444746] font-mono text-[10px] text-[#a8c7fa] overflow-x-auto">
                <pre>{JSON.stringify(debugInfo.parsedResponse || { error: "Local engine active" }, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-3 bg-[#252525] border-t border-[#444746] text-center">
          <p className="text-[10px] text-gray-500 font-medium">Powered by Google Gemini 3 Flash</p>
        </div>
      </div>
    </div>
  );
};

export default GeminiSlingshot;
