import {useCallback, useEffect, useRef, useState} from "react"
import {actInfer, getCarState, resetCar, saveDataset, sendAction, socket} from "../api/socket";
import type {Car} from "../model/car";
import type {Target, TargetType} from "../model/target";
import {getTargetAtPosition as getTargetAtPositionFromModel} from "../model/target";
import {useTargetStore} from "../store/targetStore";
import {
    renderTopDownTargets,
    targetsToWalls,
    computeSprites,
    renderFirstPersonWalls,
    renderFirstPersonSprites
} from "../components/target/TargetRenderer";
import {TargetManager} from "../components/target/TargetManager";

const MAP_W = 800; 
const MAP_H = 600; 
const CAR_W = 40;
const CAR_H = 20;
const CAR_RADIUS = Math.hypot(CAR_W / 2, CAR_H / 2);
const INFER_HZ = 5;
const inferInterval = 1000 / INFER_HZ;
const ACTION_DIM = 3;
const CHUNK_SIZE = 50;

// 坐标偏移量：将后端坐标(中心为原点)转换为前端坐标(左上角为原点)
const INITIAL_LOCAL_W = MAP_W / 2;
const INITIAL_LOCAL_H = MAP_H / 2;

// 渲染帧率设置
const FPS = 30
const frameInterval = 1000 / FPS

type EpisodeStep = {
    state: number[];
    envState: number[];
    action: number[];
    image?: string;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const intersectRaySegment = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    x4: number,
    y4: number
) => {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return null;
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
    if (ua >= 0 && ub >= 0 && ub <= 1) {
        const ix = x1 + ua * (x2 - x1);
        const iy = y1 + ua * (y2 - y1);
        return {x: ix, y: iy};
    }
    return null;
};

// ============================================================
// SimPage 组件 - 小车模拟器主页面
// 包含俯视图(上帝视角)和第一人称视角两个画布
// ============================================================
const SimPage = () => {
    // ----------------------------------------
    // Ref 引用：用于访问 DOM 元素
    // ----------------------------------------
    const canvasRef = useRef<HTMLCanvasElement | null>(null)   // 俯视图画布引用
    const fpvRef = useRef<HTMLCanvasElement | null>(null);     // 第一人称视角画布引用

    // ----------------------------------------
    // 状态管理：目标物数据
    // ----------------------------------------
    // 使用 zustand store 管理目标物状态
    const { targets, setTargets, updateTarget, removeTarget, selectTarget, selectedTargetId } = useTargetStore();
    
    // 使用 useRef 存储目标物的实时引用
    // 目的：解决渲染循环(每帧调用)中访问最新状态的闭包问题
    // 原理：targetsRef.current 始终指向最新的 targets 数组
    const targetsRef = useRef(targets);

    // 建立 zustand store 和 useRef 之间的同步
    // 当 targets 更新时，targetsRef.current 也会同步更新
    useEffect(() => {
        targetsRef.current = targets;
    }, [targets]);
    
    // 拖拽状态管理
    const draggingRef = useRef({
        isDragging: false,
        targetId: null as string | null
    });
    
    // 目标物创建状态（用于画布点击创建）
    const [selectedTargetType, _setSelectedTargetType] = useState<TargetType>('RECT');
    const [isCreatingTarget, _setIsCreatingTarget] = useState(false);

    // ----------------------------------------
    // 状态管理：小车状态 (使用 ref 避免频繁重渲染)
    // ----------------------------------------
    const carState = useRef({
        x: 400,          // 初始 X 坐标
        y: 300,          // 初始 Y 坐标
        angle: -Math.PI / 2, // 初始角度 (弧度)，-PI/2 朝上
    })
    const [actEnabled, setActEnabled] = useState(false)
    const [actStatus, setActStatus] = useState("ACT: off")
    const actCommandRef = useRef<string>("stop")
    const lastCommandRef = useRef<string>("stop")
    const lastSentCommandRef = useRef<string>("stop")
    const lastSendAtRef = useRef<number>(0)
    const lastInferAtRef = useRef<number>(0)
    const inferFrameRef = useRef<number>(0)
    const localSpeedRef = useRef<number>(0)

    const [collecting, setCollecting] = useState(false)
    const [collectStatus, setCollectStatus] = useState("采集: 未开始")
    const [targetEpisodes, setTargetEpisodes] = useState(50)
    const [collectedEpisodes, setCollectedEpisodes] = useState(0)
    const episodesRef = useRef<{steps: EpisodeStep[]}[]>([])
    const currentEpisodeRef = useRef<EpisodeStep[]>([])
    const [showFlowHelp, setShowFlowHelp] = useState(false)

    const handleCreateTargetInFront = () => {
        const {x, y, angle} = carState.current;
        const frontX = x + Math.cos(angle) * 50;
        const frontY = y + Math.sin(angle) * 50;
        createTarget(frontX, frontY);
    };

    const mapActionToCommand = (vec: number[]) => {
        if (!Array.isArray(vec) || vec.length === 0) return "stop"
        const v0 = vec[0] ?? 0
        const v1 = vec[1] ?? 0
        const magnitude = Math.abs(v0) + Math.abs(v1)
        if (magnitude < 0.1) return "stop"
        if (Math.abs(v0) >= Math.abs(v1)) {
            return v0 >= 0 ? "up" : "down"
        }
        return v1 >= 0 ? "right" : "left"
    }

    useEffect(() => {
        if (actEnabled) {
            lastInferAtRef.current = 0
            return
        }
        actCommandRef.current = "stop"
        sendAction("stop")
    }, [actEnabled])

    useEffect(() => {
        getCarState()
        socket.on('car_state', (car: Car) => {
            const newState = {
                x: car.x + INITIAL_LOCAL_W,
                y: car.y + INITIAL_LOCAL_H,
                angle: car.angle
            };
            carState.current = newState;
        });
        socket.on('act_action', (payload: {action?: number[][][]; error?: string}) => {
            if (payload?.error) {
                setActStatus(`ACT: ${payload.error}`)
                actCommandRef.current = "stop"
                return
            }
            const action = payload?.action
            if (!action || action.length === 0 || action[0].length === 0) {
                setActStatus("ACT: empty")
                actCommandRef.current = "stop"
                return
            }
            const cmd = mapActionToCommand(action[0][0])
            actCommandRef.current = cmd
            setActStatus(`ACT: ${cmd}`)
        })
        return () => {
            socket.off('car_state');
            socket.off('act_action');
        }
    }, [])

    const keys = useRef<Record<string, boolean>>({})

    // ============================================================
    // 碰撞检测函数
    // 参数：x, y - 要检测的坐标点
    // 返回：boolean - true 表示发生碰撞，false 表示安全
    // ============================================================
    const checkCollision = useCallback((x: number, y: number) => {
        if (x < CAR_RADIUS || x > MAP_W - CAR_RADIUS || y < CAR_RADIUS || y > MAP_H - CAR_RADIUS) return true;
        return targetsRef.current.some(t => {
            if (t.type === 'CIRCLE') {
                const r = t.r || 0;
                const dx = x - t.x;
                const dy = y - t.y;
                return dx * dx + dy * dy <= (r + CAR_RADIUS) ** 2;
            }
            const w = t.w || 0;
            const h = t.h || 0;
            const angle = t.angle || 0;
            const centerX = t.x + w / 2;
            const centerY = t.y + h / 2;
            const cos = Math.cos(-angle);
            const sin = Math.sin(-angle);
            const localX = cos * (x - centerX) - sin * (y - centerY) + centerX;
            const localY = sin * (x - centerX) + cos * (y - centerY) + centerY;
            const closestX = clamp(localX, t.x, t.x + w);
            const closestY = clamp(localY, t.y, t.y + h);
            const dx = localX - closestX;
            const dy = localY - closestY;
            return dx * dx + dy * dy <= CAR_RADIUS * CAR_RADIUS;
        });
    }, []);

    const applyLocalAction = useCallback((cmd: string) => {
        const {x, y, angle} = carState.current
        let nextAngle = angle
        let speed = localSpeedRef.current

        if (cmd === "up") {
            if (speed < 5) speed += 0.2
        }
        if (cmd === "down") {
            if (speed > -2.5) speed -= 0.2
        }
        if (cmd === "left") {
            nextAngle -= 0.05
        }
        if (cmd === "right") {
            nextAngle += 0.05
        }

        speed *= 0.95

        let nextX = x + Math.cos(nextAngle) * speed
        let nextY = y + Math.sin(nextAngle) * speed

        if (cmd === "stop") {
            speed = 0
            nextX = x
            nextY = y
        }

        if (checkCollision(nextX, nextY)) {
            speed = 0
            nextX = x
            nextY = y
        }

        localSpeedRef.current = speed
        carState.current = {x: nextX, y: nextY, angle: nextAngle}
    }, [checkCollision]);

    const updatePhysics = useCallback(() => {
        let cmd = "stop"
        if (actEnabled) {
            cmd = actCommandRef.current
        } else {
            if (keys.current['ArrowUp'] || keys.current['KeyW']) {
                cmd = "up"
            }
            if (keys.current['ArrowDown'] || keys.current['KeyS']) {
                cmd = "down"
            }
            if (keys.current['ArrowLeft'] || keys.current['KeyA']) {
                cmd = "left"
            }
            if (keys.current['ArrowRight'] || keys.current['KeyD']) {
                cmd = "right"
            }
            if (selectedTargetId) {
                if (keys.current['KeyQ']) {
                    const target = targets.find(t => t.id === selectedTargetId);
                    if (target && target.type === 'RECT') {
                        const currentAngle = target.angle || 0;
                        updateTarget(selectedTargetId, { angle: currentAngle - 0.05 });
                    }
                }
                if (keys.current['KeyE']) {
                    const target = targets.find(t => t.id === selectedTargetId);
                    if (target && target.type === 'RECT') {
                        const currentAngle = target.angle || 0;
                        updateTarget(selectedTargetId, { angle: currentAngle + 0.05 });
                    }
                }
                if (keys.current['Delete']) {
                    removeTarget(selectedTargetId);
                    selectTarget(null);
                }
            }
        }
        lastCommandRef.current = cmd
        const now = performance.now()
        if (cmd === "stop") {
            if (lastSentCommandRef.current !== "stop" || now - lastSendAtRef.current >= 300) {
                sendAction(cmd)
                lastSentCommandRef.current = cmd
                lastSendAtRef.current = now
            }
        } else {
            sendAction(cmd)
            lastSentCommandRef.current = cmd
            lastSendAtRef.current = now
        }
        applyLocalAction(cmd)
        const state = carState.current;
        if (checkCollision(state.x, state.y)) {
            if (lastSentCommandRef.current !== "stop") {
                sendAction("stop")
                lastCommandRef.current = "stop"
                lastSentCommandRef.current = "stop"
                lastSendAtRef.current = now
            }
        }
    }, [actEnabled, applyLocalAction, checkCollision, removeTarget, selectTarget, selectedTargetId, targets, updateTarget])

    const commandToActionVec = useCallback((cmd: string) => {
        switch (cmd) {
            case "up":
                return [1, 0, 0]
            case "down":
                return [-1, 0, 0]
            case "left":
                return [0, -1, 0]
            case "right":
                return [0, 1, 0]
            default:
                return [0, 0, 0]
        }
    }, [])

    const getForwardDistance = useCallback((x: number, y: number, angle: number) => {
        const maxDist = Math.hypot(MAP_W, MAP_H);
        const endX = x + Math.cos(angle) * maxDist;
        const endY = y + Math.sin(angle) * maxDist;
        const walls = targetsToWalls(targetsRef.current);
        let minDist = maxDist;
        walls.forEach(wall => {
            const hit = intersectRaySegment(x, y, endX, endY, wall.x1, wall.y1, wall.x2, wall.y2);
            if (hit) {
                const dist = Math.hypot(hit.x - x, hit.y - y);
                if (dist < minDist) minDist = dist;
            }
        });
        return minDist;
    }, [])

    const getObservationVectors = useCallback(() => {
        const {x, y, angle} = carState.current
        const state = new Array(14).fill(0)
        state[0] = x
        state[1] = y
        state[2] = angle
        const envState = new Array(6).fill(0)
        envState[0] = x
        envState[1] = y
        envState[2] = angle
        envState[3] = 0
        envState[4] = checkCollision(x, y) ? 1 : 0
        envState[5] = getForwardDistance(x, y, angle)
        return {state, envState}
    }, [checkCollision, getForwardDistance])

    const buildInferencePayload = useCallback(() => {
        const {state, envState} = getObservationVectors()
        const frameId = inferFrameRef.current
        inferFrameRef.current += 1
        return {
            observation: {state, environment_state: envState},
            meta: {frame_id: frameId, index: frameId}
        }
    }, [getObservationVectors])

    const packDataset = (episodes: {steps: EpisodeStep[]}[]) => {
        const states: number[][][] = []
        const env_states: number[][][] = []
        const actions: number[][][] = []
        const action_is_pad: number[][] = []
        const images: string[][][] = []
        let hasImages = false
        episodes.forEach(ep => {
            const steps = ep.steps
            for (let i = 0; i < steps.length; i += CHUNK_SIZE) {
                const chunkSteps = steps.slice(i, i + CHUNK_SIZE)
                const stateChunk: number[][] = []
                const envChunk: number[][] = []
                const actionChunk: number[][] = []
                const padChunk: number[] = []
                const imageChunk: string[][] = []
                chunkSteps.forEach(step => {
                    stateChunk.push(step.state)
                    envChunk.push(step.envState)
                    actionChunk.push(step.action)
                    padChunk.push(0)
                    const image = step.image ?? ""
                    if (image) hasImages = true
                    imageChunk.push([image])
                })
                for (let pad = chunkSteps.length; pad < CHUNK_SIZE; pad += 1) {
                    stateChunk.push(new Array(14).fill(0))
                    envChunk.push(new Array(6).fill(0))
                    actionChunk.push(new Array(ACTION_DIM).fill(0))
                    padChunk.push(1)
                    imageChunk.push([""])
                }
                states.push(stateChunk)
                env_states.push(envChunk)
                actions.push(actionChunk)
                action_is_pad.push(padChunk)
                images.push(imageChunk)
            }
        })
        if (hasImages) {
            return {states, env_states, actions, action_is_pad, images}
        }
        return {states, env_states, actions, action_is_pad}
    }

    const drawGrid = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
        ctx.strokeStyle = '#e0e0e0'
        ctx.lineWidth = 1
        const gridSize = 50

        ctx.beginPath()
        for (let x = 0; x <= w; x += gridSize) {
            ctx.moveTo(x, 0)
            ctx.lineTo(x, h)
        }
        for (let y = 0; y <= h; y += gridSize) {
            ctx.moveTo(0, y)
            ctx.lineTo(w, y)
        }
        ctx.stroke()
    }, [])

    const drawCarBody = useCallback((ctx: CanvasRenderingContext2D) => {
        const {x, y, angle} = carState.current;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = 'blue';
        ctx.fillRect(-CAR_W / 2, -CAR_H / 2, CAR_W, CAR_H);
        ctx.fillStyle = 'yellow'; // 车灯
        ctx.beginPath();
        ctx.arc(15, -6, 3, 0, Math.PI * 2);
        ctx.arc(15, 6, 3, 0, Math.PI * 2);
        ctx.fill();
        // 挡风玻璃
        ctx.fillStyle = '#2c3e50'
        ctx.fillRect(5, -8, 10, 16)
        ctx.restore();
    }, [])

    // ============================================================
    // 俯视图绘制函数 (上帝视角)
    // 参数：ctx - Canvas 2D 绘图上下文
    // 功能：绘制网格、目标物、小车和方向指示线
    // ============================================================
    const drawTopDown = useCallback((ctx: CanvasRenderingContext2D) => {
        // 清空画布
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

        // 绘制背景网格 (模拟地面)
        drawGrid(ctx, ctx.canvas.width, ctx.canvas.height)

        // 保存当前绘图状态
        ctx.save()

        // 2. 画目标物：使用提取的渲染函数
        renderTopDownTargets(ctx, targetsRef.current, selectedTargetId);

        // 3. 绘制小车 (此时原点就是车身中心)
        drawCarBody(ctx)

        const {x, y, angle} = carState.current;
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle - Math.PI / 6) * 100, y + Math.sin(angle - Math.PI / 6) * 100);
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle + Math.PI / 6) * 100, y + Math.sin(angle + Math.PI / 6) * 100);
        ctx.stroke();

        // 恢复绘图状态
        ctx.restore()
    }, [drawCarBody, drawGrid, selectedTargetId])

    // 检查鼠标点击是否在目标物内
    const getTargetAtPointer = useCallback((x: number, y: number) => {
        return getTargetAtPositionFromModel(x, y, targetsRef.current);
    }, []);
    
    // 创建新目标物（在画布点击时使用）
    const createTarget = useCallback((x: number, y: number) => {
        const newTarget: Target = {
            id: `target_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            type: selectedTargetType,
            x,
            y,
            w: selectedTargetType === 'RECT' ? 50 : undefined,
            h: selectedTargetType === 'RECT' ? 30 : undefined,
            r: selectedTargetType === 'CIRCLE' ? 20 : undefined,
            color: selectedTargetType === 'RECT' ? '#8B4513' : '#2E8B57',
            angle: 0
        };
        
        setTargets([...targets, newTarget]);
    }, [selectedTargetType, setTargets, targets]);

    // 帧率控制变量
    const drawFirstPerson = useCallback((ctx: CanvasRenderingContext2D) => {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const {x, y, angle} = carState.current;

        // 天空和地面
        ctx.fillStyle = '#87CEEB';
        ctx.fillRect(0, 0, w, h / 2);
        ctx.fillStyle = '#7f8c8d';
        ctx.fillRect(0, h / 2, w, h / 2);

        const fov = Math.PI / 3;
        const rayCount = w / 4;
        const rayWidth = w / rayCount;

        // 每帧重新计算墙段（确保目标物位置更新时能正确渲染）
        const walls = targetsToWalls(targetsRef.current);

        // 渲染墙体并获取深度缓冲
        const depthBuffer = renderFirstPersonWalls(ctx, walls, x, y, angle, w, h);

        const sprites = computeSprites(targetsRef.current, x, y, angle, fov, w, h);
        renderFirstPersonSprites(ctx, sprites, depthBuffer, rayWidth, rayCount, x, y, angle, fov);
        const hasVisibleSprite = sprites.some(sprite => sprite.screenX + sprite.size > 0 && sprite.screenX - sprite.size < w);
        const hasVisibleWall = depthBuffer.some(dist => dist < Infinity);
        if (!hasVisibleSprite && !hasVisibleWall) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('视野内无目标', w / 2, h / 2);
        }
    }, [])


    useEffect(() => {
        const canvas = canvasRef.current
        const fpv = fpvRef.current
        if (canvas == null || fpv == null) return
        const ctxTop = canvas.getContext('2d')
        const ctxFpv = fpv.getContext('2d')

        if (ctxTop == null || ctxFpv == null) return

        // 禁用平滑处理，让像素风更清晰（可选）
        ctxFpv.imageSmoothingEnabled = false;

        let animationFrameId: number

        // 1. 监听键盘事件
        const isTypingTarget = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false
            const tagName = target.tagName
            if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return true
            return target.isContentEditable
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeElement = document.activeElement
            if (isTypingTarget(activeElement) || isTypingTarget(e.target)) return
            if (e.code.startsWith("Arrow")) {
                e.preventDefault()
            }
            keys.current[e.code] = true
        }
        const handleKeyUp = (e: KeyboardEvent) => {
            const activeElement = document.activeElement
            if (isTypingTarget(activeElement) || isTypingTarget(e.target)) return
            if (e.code.startsWith("Arrow")) {
                e.preventDefault()
            }
            keys.current[e.code] = false
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)
        
        // 2. 监听鼠标事件（用于拖拽目标物）
        let handleMouseDown: ((e: MouseEvent) => void) | null = null;
        let handleMouseMove: ((e: MouseEvent) => void) | null = null;
        let handleMouseUp: (() => void) | null = null;
        
        if (canvas) {
            handleMouseDown = (e: MouseEvent) => {
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    
                    if (isCreatingTarget) {
                        // 创建新目标物
                        createTarget(x, y);
                    } else {
                        const clickedTarget = getTargetAtPointer(x, y);
                        if (clickedTarget) {
                            selectTarget(clickedTarget.id);
                            draggingRef.current = {
                                isDragging: true,
                                targetId: clickedTarget.id
                            };
                        } else {
                            selectTarget(null);
                        }
                    }
                };
            
            handleMouseMove = (e: MouseEvent) => {
                if (draggingRef.current.isDragging && draggingRef.current.targetId) {
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    
                    // 更新目标物位置
                    updateTarget(draggingRef.current.targetId, {x, y});
                }
            };
            
            handleMouseUp = () => {
                draggingRef.current = {
                    isDragging: false,
                    targetId: null
                };
            };
            
            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseup', handleMouseUp);
            canvas.addEventListener('mouseleave', handleMouseUp);
        }

        let lastTime = 0;

        // 2. 核心渲染循环
        const renderLoop = (currentTime: number) => {
            animationFrameId = window.requestAnimationFrame(renderLoop)

            const delta = currentTime - lastTime

            if (delta < frameInterval) return

            lastTime = currentTime - (delta % frameInterval)

            if (actEnabled) {
                const elapsed = currentTime - lastInferAtRef.current
                if (elapsed >= inferInterval) {
                    lastInferAtRef.current = currentTime
                    actInfer(buildInferencePayload())
                }
            }
            updatePhysics()
            drawTopDown(ctxTop)
            drawFirstPerson(ctxFpv)
            if (collecting && episodesRef.current.length < targetEpisodes) {
                const {state, envState} = getObservationVectors()
                const action = commandToActionVec(lastCommandRef.current)
                const image = fpvRef.current?.toDataURL('image/png')
                currentEpisodeRef.current.push({state, envState, action, image})
            }
        }

        animationFrameId = window.requestAnimationFrame(renderLoop)

        // 清理函数
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
            if (canvas && handleMouseDown && handleMouseMove && handleMouseUp) {
                canvas.removeEventListener('mousedown', handleMouseDown);
                canvas.removeEventListener('mousemove', handleMouseMove);
                canvas.removeEventListener('mouseup', handleMouseUp);
                canvas.removeEventListener('mouseleave', handleMouseUp);
            }
            window.cancelAnimationFrame(animationFrameId)
        }
    }, [actEnabled, buildInferencePayload, collecting, commandToActionVec, createTarget, drawFirstPerson, drawTopDown, getObservationVectors, getTargetAtPointer, isCreatingTarget, selectTarget, targetEpisodes, updatePhysics, updateTarget])

    // --- 外部指令模拟 ---
    const sendCommand = (cmd: string) => {
        keys.current[cmd] = true
        setTimeout(() => {
            keys.current[cmd] = false
        }, 200)
    }

    const startCollect = () => {
        if (collecting) return
        currentEpisodeRef.current = []
        if (episodesRef.current.length === 0) {
            setCollectedEpisodes(0)
        }
        setCollecting(true)
        const count = episodesRef.current.length
        setCollectStatus(count > 0 ? `采集: 继续 ${count}/${targetEpisodes}` : "采集: 进行中")
    }

    const stopCollect = async () => {
        if (currentEpisodeRef.current.length > 0) {
            episodesRef.current.push({steps: currentEpisodeRef.current})
            currentEpisodeRef.current = []
        }
        const episodes = episodesRef.current
        if (episodes.length === 0) {
            setCollecting(false)
            setCollectStatus("采集: 无数据")
            return
        }
        setCollectStatus("采集: 保存中")
        try {
            const payload = packDataset(episodes)
            const res = await saveDataset(payload)
            if (res && typeof res.path === "string") {
                setCollectStatus(`采集: 已保存 ${res.path}`)
            } else {
                setCollectStatus("采集: 已保存")
            }
        } catch {
            setCollectStatus("采集: 保存失败")
        }
        setCollecting(false)
    }

    const handleResetSave = () => {
        if (!collecting) {
            resetCar()
            return
        }
        if (episodesRef.current.length >= targetEpisodes) {
            setCollectStatus("采集: 已达目标")
            currentEpisodeRef.current = []
            resetCar()
            return
        }
        let steps = currentEpisodeRef.current
        if (steps.length === 0) {
            const {state, envState} = getObservationVectors()
            const action = commandToActionVec(lastCommandRef.current)
            const image = fpvRef.current?.toDataURL('image/png')
            steps = [{state, envState, action, image}]
        }
        episodesRef.current.push({steps})
        currentEpisodeRef.current = []
        const count = episodesRef.current.length
        setCollectedEpisodes(count)
        if (count >= targetEpisodes) {
            setCollectStatus("采集: 已达目标")
        } else {
            setCollectStatus(`采集: 已记录 ${count}/${targetEpisodes}`)
        }
        resetCar()
    }

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '20px',
            height: '100vh',
            boxSizing: 'border-box',
            overflow: 'hidden',
            background: '#f1f5f9'
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: '#ffffff',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)'
            }}>
                <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                    <div style={{fontSize: 18, fontWeight: 700, color: '#0f172a'}}>小车模拟器</div>
                    <div style={{fontSize: 12, color: '#64748b'}}>目标物编辑 · 采集训练 · ACT 推理</div>
                </div>
                <div style={{fontSize: 12, color: '#94a3b8'}}>模拟模式</div>
            </div>
            <div style={{
                display: 'flex',
                flexDirection: 'row',
                gap: '16px',
                flex: 1,
                minHeight: 0
            }}>
                {/* 左侧：目标物管理 */}
                <TargetManager 
                    onCreateInFront={handleCreateTargetInFront}
                    isCreatingTarget={isCreatingTarget}
                    onToggleCreating={(creating) => _setIsCreatingTarget(creating)}
                    selectedTargetType={selectedTargetType}
                    onTargetTypeChange={(type) => _setSelectedTargetType(type)}
                />
                
                
                {/* 右侧：画布和控制按钮 */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    alignItems: 'stretch',
                    minHeight: 0
                }}>
                    <div style={{display: 'flex', flexDirection: 'row', gap: '16px', alignItems: 'flex-start', flexWrap: 'nowrap'}}>
                        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', flexShrink: 0}}>
                            {/* 左侧：上帝视角 */}
                            <div style={{
                                position: 'relative',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                background: '#ffffff',
                                flexShrink: 0,
                                boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)'
                            }}>
                                <canvas
                                    ref={canvasRef}
                                    width={800}
                                    height={600}
                                    style={{background: '#f8fafc', display: 'block'}}
                                />
                                <div style={{
                                    position: 'absolute',
                                    top: 10,
                                    left: 10,
                                    background: 'rgba(255,255,255,0.9)',
                                    padding: '6px 8px',
                                    borderRadius: 8,
                                    fontSize: 12,
                                    color: '#334155',
                                    border: '1px solid #e2e8f0'
                                }}>
                                    使用 WASD 或 方向键 移动<br/>
                                    使用 QE 键旋转选中的目标物<br/>
                                    选中目标物后按 Delete 键删除
                                </div>
                            </div>

                            <div style={{
                                display: 'flex',
                                gap: '10px',
                                flexWrap: 'wrap',
                                justifyContent: 'center',
                                alignItems: 'center',
                                background: '#ffffff',
                                border: '1px solid #e2e8f0',
                                borderRadius: 12,
                                padding: '10px 12px',
                                boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)'
                            }}>
                                <button onClick={() => sendCommand('ArrowUp')}>前进</button>
                                <button onClick={() => sendCommand('ArrowLeft')}>左转</button>
                                <button onClick={() => sendCommand('ArrowRight')}>右转</button>
                                <button onClick={() => sendCommand('ArrowDown')}>后退</button>
                                <button onClick={() => resetCar()} style={{background: '#0f172a', color: '#ffffff', borderColor: '#0f172a'}}>复位</button>
                            </div>
                        </div>
                        {/* 右侧：第一人称 */}
                        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: 320, flexShrink: 0}}>
                            <div style={{position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                                <div style={{
                                    position: 'absolute',
                                    top: 8,
                                    left: 8,
                                    background: 'rgba(255,255,255,0.92)',
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    borderRadius: 6,
                                    border: '1px solid #e2e8f0',
                                    color: '#334155'
                                }}>车载摄像头 (Camera)
                                </div>
                                <canvas
                                    ref={fpvRef}
                                    width={320}
                                    height={240}
                                    style={{background: '#0f172a', border: '1px solid #e2e8f0', borderRadius: 12}}
                                />
                                <div style={{marginTop: '10px', fontSize: '12px', color: '#64748b', width: 320, textAlign: 'center'}}>
                                    说明：右侧画面是根据左侧地图实时计算生成的伪3D视角。
                                </div>
                            </div>
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px',
                                width: 320
                            }}>
                                <div style={{
                                    border: '1px solid #e2e8f0',
                                    borderRadius: 8,
                                    padding: 10,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 8,
                                    background: '#ffffff',
                                    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)'
                                }}>
                                    <div style={{fontSize: 12, fontWeight: 600, color: '#0f172a'}}>推理流程（ACT）</div>
                                    <button onClick={() => {
                                        setActEnabled(v => {
                                            const next = !v
                                            setActStatus(next ? "ACT: on" : "ACT: off")
                                            if (!next) {
                                                actCommandRef.current = "stop"
                                                sendAction("stop")
                                            }
                                            return next
                                        })
                                    }}>切换 ACT</button>
                                    <div style={{fontSize: 12, opacity: 0.8, textAlign: 'center', minHeight: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#64748b'}}>
                                        {actStatus}
                                    </div>
                                </div>
                                <div style={{
                                    border: '1px solid #e2e8f0',
                                    borderRadius: 8,
                                    padding: 10,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 8,
                                    background: '#ffffff',
                                    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)'
                                }}>
                                    <div style={{fontSize: 12, fontWeight: 600, color: '#0f172a'}}>训练流程</div>
                                    <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                                        <button onClick={startCollect} disabled={collecting}>开始采集</button>
                                        <button onClick={stopCollect} disabled={!collecting}>结束采集</button>
                                        <button onClick={handleResetSave} disabled={!collecting}>复位保存</button>
                                    </div>
                                    <div style={{fontSize: 12, opacity: 0.8, color: '#64748b'}}>进度 {collectedEpisodes}/{targetEpisodes}</div>
                                    <label style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: 12}}>
                                        目标回合
                                        <input
                                            type="number"
                                            min={1}
                                            value={targetEpisodes}
                                            onChange={(e) => {
                                                const next = Number(e.target.value)
                                                if (!Number.isNaN(next) && next > 0) {
                                                    setTargetEpisodes(Math.max(next, collectedEpisodes))
                                                }
                                            }}
                                            style={{width: 80, borderRadius: 8, border: '1px solid #e2e8f0', padding: '4px 6px'}}
                                        />
                                    </label>
                                    <button
                                        onClick={() => setShowFlowHelp(v => !v)}
                                        style={{fontSize: 12, textAlign: 'left'}}
                                    >
                                        {showFlowHelp ? "隐藏流程说明" : "查看流程说明"}
                                    </button>
                                    {showFlowHelp && (
                                        <div style={{fontSize: 12, opacity: 0.85, lineHeight: 1.5, color: '#475569'}}>
                                            ① 点击开始采集 → ② 操作小车完成任务 → ③ 点击复位保存自动记录一条数据 → ④ 调整场景 → ⑤ 继续开始采集
                                        </div>
                                    )}
                                    <div style={{fontSize: 12, opacity: 0.8, textAlign: 'center', minHeight: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#64748b'}}>
                                        {collectStatus}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default SimPage
