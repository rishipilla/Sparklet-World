import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import cuteRefUrl from "./assets/7a47c4b92220063e-image_c741b5.png";

type SparkletState = "idle" | "notice" | "invite" | "follow" | "curious" | "listening" | "thinking" | "speaking" | "happy" | "confused" | "farewell";
type GraphicsQuality = "low" | "med" | "high";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);

  // UI
  const [showMenu, setShowMenu] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [crystals, setCrystals] = useState(0);
  const [interactionPrompt, setInteractionPrompt] = useState<string | null>(null);
  const [showDialogue, setShowDialogue] = useState(false);
  const [dialogueHistory, setDialogueHistory] = useState<{ role: "user" | "sparklet" | "system"; text: string; isLocal?: boolean }[]>([
    { role: "sparklet", text: "✦ hi! i'm Sparklet! your little star-friend is here! come say hello at the central plaza!" }
  ]);
  const [inputText, setInputText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [apiStatus, setApiStatus] = useState<"disconnected" | "checking" | "connected" | "error">("disconnected");
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem("sparklet_api_url") || "");
  const [apiToken, setApiToken] = useState(() => sessionStorage.getItem("sparklet_api_token") || "");
  const [showSettings, setShowSettings] = useState(false);
  const [showPause, setShowPause] = useState(false);
  const [graphics, setGraphics] = useState<GraphicsQuality>(() => (localStorage.getItem("sparklet_gfx") as GraphicsQuality) || "med");
  const [thirdPerson, setThirdPerson] = useState(true);
  const [vrSupported, setVrSupported] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [objective, setObjective] = useState("Find Sparklet at the central ring");
  const [showTutorial, setShowTutorial] = useState(true);
  const [muted, setMuted] = useState(false);
  const [sensitivity, setSensitivity] = useState(1);

  const gameRef = useRef<{
    player?: THREE.Group,
    playerParts?: any,
    sparklet?: THREE.Group,
    sparkletParts?: any,
    sparkletState?: SparkletState,
    stateTimer?: number,
    playerVelY?: number,
    grounded?: boolean,
    yaw?: number,
    pitch?: number,
    camDist?: number,
    crystalsCollected?: Set<number>,
    dialogueOpen?: boolean,
    following?: boolean,
    t?: number,
    keys?: any,
    mouseDown?: boolean,
    joyMove?: { x: number, y: number },
    joyLook?: { x: number, y: number },
    crystalsMeshes?: THREE.Mesh[],
    terminals?: { mesh: THREE.Mesh, text: string }[],
    teleportPad?: THREE.Mesh,
    cleanup?: () => void
  }>({});

  useEffect(() => {
    // @ts-ignore
    if (navigator.xr && navigator.xr.isSessionSupported) {
      // @ts-ignore
      navigator.xr.isSessionSupported("immersive-vr").then((s: boolean) => setVrSupported(s));
    }
    setIsMobile(/Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 900);
    localStorage.setItem("sparklet_gfx", graphics);
  }, [graphics]);

  const checkHealth = async () => {
    if (!apiUrl) { setApiStatus("disconnected"); return; }
    setApiStatus("checking");
    try {
      const res = await fetch(apiUrl.replace(/\/$/, "") + "/health", {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        method: "GET",
      });
      if (res.ok) setApiStatus("connected");
      else setApiStatus("error");
    } catch { setApiStatus("error"); }
  };
  useEffect(() => { checkHealth(); }, []);

  const saveApiConfig = () => {
    localStorage.setItem("sparklet_api_url", apiUrl);
    sessionStorage.setItem("sparklet_api_token", apiToken);
    checkHealth();
    setShowSettings(false);
  };

  const MSG_COLLECTION = "sparklet_messages";
  const PROGRESS_COLLECTION = "sparklet_progress";

  useEffect(() => {
    const loadPersisted = async () => {
      try {
        const msgRes = await fetch("actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "records.list", args: { collection: MSG_COLLECTION, limit: 100 } })
        });
        if (msgRes.ok) {
          const json = await msgRes.json();
          const recs = json?.data?.records || json?.records || [];
          if (recs.length > 0) {
            recs.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            const loaded = recs.map((r: any) => r.value).filter((v: any) => v && v.text);
            if (loaded.length > 0 && loaded.some((m: any) => m.role === "user")) {
              setDialogueHistory(loaded);
            }
          }
        }
        const progRes = await fetch("actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "records.list", args: { collection: PROGRESS_COLLECTION, limit: 50 } })
        });
        if (progRes.ok) {
          const pj = await progRes.json();
          const precs = pj?.data?.records || pj?.records || [];
          if (precs.length > 0) {
            const latest = precs.sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
            const v = latest?.value;
            if (v && typeof v.crystals === "number") {
              setCrystals(v.crystals);
              if (v.crystals > 0) setObjective(v.crystals >= 5 ? "All crystals found! Return to Sparklet" : `Crystals collected ${v.crystals}/5`);
            }
          }
        }
      } catch (err) { console.debug("records.list unavailable", err); }
    };
    loadPersisted();
  }, []);

  const persistRecord = async (collection: string, value: any) => {
    try {
      await fetch("actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "records.create", args: { collection, value, idempotency_key: `${collection}-${Date.now()}-${Math.random()}` } })
      });
    } catch { }
  };

  // ----- Three.js -----
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    let renderer: THREE.WebGLRenderer;
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let clock = new THREE.Clock();
    let animationId = 0;
    const keys: any = { w: false, a: false, s: false, d: false, shift: false, space: false };
    let yaw = -Math.PI / 2;
    let pitch = 0.15;
    let camDist = 4.2;
    let playerVelY = 0;
    let grounded = true;
    let mouseDown = false;
    let joyMove = { x: 0, y: 0 };
    let joyLook = { x: 0, y: 0 };
    const raycaster = new THREE.Raycaster();
    const downRay = new THREE.Raycaster();
    let sparkletState: SparkletState = "idle";
    let stateTimer = 0;
    let crystalsCollected = new Set<number>();
    let following = false;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xeef6ff, 0.0065);

    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);

    renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: graphics !== "low", alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics === "high" ? 2 : graphics === "med" ? 1.6 : 1.2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // @ts-ignore
    renderer.xr.enabled = true;

    // Sky - pastel soft
    const skyCanvas = document.createElement("canvas"); skyCanvas.width = 2; skyCanvas.height = 512;
    const ctx = skyCanvas.getContext("2d")!;
    const grd = ctx.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, "#b9dcff");
    grd.addColorStop(0.22, "#d6eaff");
    grd.addColorStop(0.5, "#eaf3ff");
    grd.addColorStop(0.82, "#fff6ea");
    grd.addColorStop(1, "#fffdf8");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 2, 512);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    scene.background = skyTex;

    // Lighting - bright studio
    const hemi = new THREE.HemisphereLight(0xddeeff, 0xfff4e6, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfffaf0, 1.35);
    sun.position.set(40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(graphics === "high" ? 2048 : 1024, graphics === "high" ? 2048 : 1024);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    const softFill = new THREE.DirectionalLight(0xcfe6ff, 0.45);
    softFill.position.set(-30, 40, -20);
    scene.add(softFill);

    // --- Clean ground - main island ---
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xf7f3eb, roughness: 0.92, metalness: 0.02 });
    const mainIsland = new THREE.Mesh(new THREE.CylinderGeometry(110, 110, 2.2, 64), groundMat);
    mainIsland.position.y = -1.1;
    mainIsland.receiveShadow = true;
    scene.add(mainIsland);

    // edge bevel torus for rounded feel
    const edge = new THREE.Mesh(new THREE.TorusGeometry(110, 0.9, 12, 100), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.9 }));
    edge.rotation.x = Math.PI / 2;
    edge.position.y = -0.05;
    scene.add(edge);

    // Grass disc slightly above
    const grassMat = new THREE.MeshStandardMaterial({ color: 0xeaf5e6, roughness: 0.95 });
    const grassDisc = new THREE.Mesh(new THREE.CylinderGeometry(106, 106, 0.3, 64), grassMat);
    grassDisc.position.y = 0.15;
    grassDisc.receiveShadow = true;
    scene.add(grassDisc);

    // Central plaza - premium clean
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 });
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 0.45, 64), plazaMat);
    plaza.position.y = 0.35;
    plaza.receiveShadow = true;
    plaza.castShadow = true;
    scene.add(plaza);

    const plazaInner = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.46, 64), new THREE.MeshStandardMaterial({ color: 0xf5f7ff, roughness: 0.4 }));
    plazaInner.position.y = 0.36;
    scene.add(plazaInner);

    // clean circular patterns
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(11.8, 0.18, 12, 100), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
    ring1.rotation.x = Math.PI / 2; ring1.position.y = 0.38; scene.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.12, 10, 80), new THREE.MeshStandardMaterial({ color: 0xffd84d, emissive: 0xffc21a, emissiveIntensity: 0.6 }));
    ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.5; scene.add(ring2);
    const ring3 = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.06, 8, 80), new THREE.MeshStandardMaterial({ color: 0x00d8b0, emissive: 0x00d8b0, emissiveIntensity: 0.8 }));
    ring3.rotation.x = Math.PI / 2; ring3.position.y = 0.52; scene.add(ring3);

    // Holo pillars around plaza - clean white
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 8;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
      pillar.position.set(Math.cos(ang) * 14.2, 1.25, Math.sin(ang) * 14.2);
      pillar.castShadow = true;
      scene.add(pillar);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffc233, emissiveIntensity: 0.9, transparent: true, opacity: 0.9 }));
      cap.position.copy(pillar.position); cap.position.y += 1.45;
      scene.add(cap);
      // outline for pillar
      const outline = new THREE.Mesh(pillar.geometry, new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.BackSide }));
      outline.position.copy(pillar.position);
      outline.scale.set(1.08, 1.02, 1.08);
      scene.add(outline);
    }

    // Minimalist lab buildings - white
    const buildingPositions = [[-30, 0, -20], [34, 0, 16], [-16, 0, 38]];
    const buildings: THREE.Mesh[] = [];
    buildingPositions.forEach(([x, , z]) => {
      const h = 5.5;
      const b = new THREE.Mesh(new THREE.BoxGeometry(11, h, 9), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.02 }));
      b.position.set(x as number, h / 2 + 0.15, z as number);
      b.castShadow = true; b.receiveShadow = true;
      scene.add(b); buildings.push(b);
      const bOutline = new THREE.Mesh(b.geometry, new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.BackSide }));
      bOutline.position.copy(b.position); bOutline.scale.set(1.04, 1.04, 1.04); scene.add(bOutline);
      // large windows - soft glow blue
      const winMat = new THREE.MeshStandardMaterial({ color: 0xd8f1ff, emissive: 0xa8ddff, emissiveIntensity: 0.35, transparent: true, opacity: 0.85, roughness: 0.2 });
      for (let wx = 0; wx < 2; wx++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), winMat);
        win.position.set((x as number) + 5.51, 1.6 + wx * 2, (z as number));
        win.rotation.y = Math.PI / 2;
        scene.add(win);
      }
    });

    // Cute low-poly bushes & trees - clean
    const bushGeo = new THREE.SphereGeometry(0.9, 12, 10);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xa8d8a0, roughness: 0.8 });
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.2, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 });
    for (let i = 0; i < 46; i++) {
      const ang = Math.random() * Math.PI * 2; const rad = 22 + Math.random() * 70;
      if (rad < 18) continue;
      const x = Math.cos(ang) * rad + (Math.random() - 0.5) * 4;
      const z = Math.sin(ang) * rad + (Math.random() - 0.5) * 4;
      let tooClose = false;
      for (const bp of buildingPositions) if (Math.hypot(x - bp[0], z - bp[2]) < 10) tooClose = true;
      if (tooClose) continue;
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 0.6; g.add(trunk);
      const leaves = new THREE.Mesh(bushGeo, bushMat);
      leaves.position.y = 1.6; leaves.scale.set(1.2 + Math.random() * 0.4, 0.9, 1.2);
      leaves.castShadow = true; g.add(leaves);
      // outline for leaves
      const outline = new THREE.Mesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.BackSide }));
      outline.position.copy(leaves.position); outline.scale.set(1.12, 1.12, 1.12); g.add(outline);
      g.position.set(x, 0, z);
      scene.add(g);
    }

    // Floating islands - soft
    const floatRocks: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const fr = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.2, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0xddd8c8 }));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0xd9efd7 }));
      top.position.y = 0.5; base.position.y = 0;
      fr.add(base); fr.add(top);
      const ang = Math.random() * Math.PI * 2; const rad = 58 + Math.random() * 32;
      fr.position.set(Math.cos(ang) * rad, 13 + Math.random() * 16, Math.sin(ang) * rad);
      scene.add(fr);
      // @ts-ignore
      floatRocks.push(fr as any);
    }

    // Pastel crystals - clean garden
    const crystalsMeshes: THREE.Mesh[] = [];
    const crystalColors = [0xb6f0e8, 0xffd6e7, 0xffe9a8, 0xc7e8ff, 0xd0f0c0];
    const crystalGeo = new THREE.IcosahedronGeometry(0.85, 0);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + Math.random() * 0.25;
      const rad = 24 + Math.random() * 52;
      const col = crystalColors[i % crystalColors.length];
      const c = new THREE.Mesh(crystalGeo, new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.55, transparent: true, opacity: 0.92, roughness: 0.15, metalness: 0.05
      }));
      c.position.set(Math.cos(ang) * rad, 1.05 + Math.random() * 0.4, Math.sin(ang) * rad);
      c.castShadow = true;
      // outline
      const o = new THREE.Mesh(crystalGeo, new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.BackSide }));
      o.position.copy(c.position); o.scale.set(1.14, 1.14, 1.14); scene.add(o);
      (c as any)._outline = o;
      c.userData = { idx: i, baseY: c.position.y, ang: Math.random() * Math.PI * 2, collected: false };
      crystalsMeshes.push(c); scene.add(c);
      const light = new THREE.PointLight(col as any, 0.8, 10); light.position.copy(c.position); scene.add(light); (c as any).userData.light = light; (c as any).userData.outline = o;
    }

    // Terminals - clean white
    const terminals: { mesh: THREE.Mesh, text: string }[] = [];
    const termData = [
      { pos: [13, 0.8, 0] as const, text: "Log 07: Crystal garden resonates at 432Hz. Your star hands tingle near them, little explorer." },
      { pos: [-14, 0.8, 8] as const, text: "Log 12: Sparklet's golden plating was polished this morning. He waits at the plaza for you." },
      { pos: [6, 0.8, -16] as const, text: "Log 03: The cute creature from the image? That's YOU! Star hands, big glossy eyes, full of wonder." },
    ];
    termData.forEach(td => {
      const tm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
      tm.position.set(td.pos[0], td.pos[1], td.pos[2]); tm.castShadow = true; scene.add(tm);
      const outline = new THREE.Mesh(tm.geometry, new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.BackSide }));
      outline.position.copy(tm.position); outline.scale.set(1.08, 1.06, 1.15); scene.add(outline);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.6), new THREE.MeshStandardMaterial({ color: 0x00d8b0, emissive: 0x00d8b0, emissiveIntensity: 0.7 }));
      screen.position.set(td.pos[0], td.pos[1] + 0.15, td.pos[2] + 0.17); scene.add(screen);
      terminals.push({ mesh: tm, text: td.text });
    });

    const teleportPad = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.18, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8a5cff, emissiveIntensity: 0.25 }));
    teleportPad.position.set(-44, 0.2, 28); teleportPad.receiveShadow = true; scene.add(teleportPad);
    const tpRing = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.12, 10, 32), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    tpRing.position.copy(teleportPad.position); tpRing.position.y += 0.16; tpRing.rotation.x = Math.PI / 2; scene.add(tpRing);
    const tpInner = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 8, 24), new THREE.MeshStandardMaterial({ color: 0x8a5cff, emissive: 0x8a5cff, emissiveIntensity: 1 }));
    tpInner.position.copy(teleportPad.position); tpInner.position.y += 0.22; tpInner.rotation.x = Math.PI / 2; scene.add(tpInner);

    // Dust - very light
    const dustCount = graphics === "low" ? 300 : 700;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    const dustVel = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 200; dustPos[i * 3 + 1] = Math.random() * 22; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 200; dustVel[i] = Math.random() * 0.4 + 0.15; }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ size: 0.14, color: 0xffffff, transparent: true, opacity: 0.35, sizeAttenuation: true });
    const dustPoints = new THREE.Points(dustGeo, dustMat); scene.add(dustPoints);

    // ========== CUTE PLAYER CHARACTER FROM IMAGE ==========
    // Recreate: round big head ~50% body, huge black glossy eyes with white highlights + heart, tiny torso, star hands, stubby legs, black outline

    function createStarShape(outer: number, inner: number, points = 5) {
      const shape = new THREE.Shape();
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / points) * i - Math.PI / 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      }
      shape.closePath();
      return shape;
    }
    function createHeartShape(s = 1) {
      const shape = new THREE.Shape();
      shape.moveTo(0, -0.4 * s);
      shape.bezierCurveTo(0.5 * s, -0.6 * s, 0.8 * s, 0.15 * s, 0, 0.6 * s);
      shape.bezierCurveTo(-0.8 * s, 0.15 * s, -0.5 * s, -0.6 * s, 0, -0.4 * s);
      return shape;
    }

    const playerGroup = new THREE.Group();

    // Materials
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfffffb, roughness: 0.45, metalness: 0.02 });
    const outlineBlackMat = new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.BackSide });
    const blackEyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.15, metalness: 0.1 });
    const whiteHighlightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.2 });
    const pinkHeartMat = new THREE.MeshStandardMaterial({ color: 0xffc1d6, emissive: 0xff8fae, emissiveIntensity: 0.4 });

    // Body - tiny
    const bodyGeo = new THREE.SphereGeometry(0.28, 20, 16);
    const body = new THREE.Mesh(bodyGeo, whiteMat);
    body.position.y = 0.44;
    body.scale.set(1, 0.92, 0.9);
    body.castShadow = true;
    playerGroup.add(body);
    const bodyOutline = new THREE.Mesh(bodyGeo, outlineBlackMat);
    bodyOutline.position.copy(body.position);
    bodyOutline.scale.set(1.14, 1.08, 1.12);
    playerGroup.add(bodyOutline);

    // Head - big round ~50%
    const headGeo = new THREE.SphereGeometry(0.58, 28, 24);
    const head = new THREE.Mesh(headGeo, whiteMat);
    head.position.y = 1.07;
    head.scale.set(1.05, 1.02, 1);
    head.castShadow = true;
    playerGroup.add(head);
    const headOutline = new THREE.Mesh(headGeo, outlineBlackMat);
    headOutline.position.copy(head.position);
    headOutline.scale.set(1.09, 1.08, 1.08);
    playerGroup.add(headOutline);

    // Head group for wobble
    const headGroup = new THREE.Group();
    headGroup.position.copy(head.position);
    // move head mesh into headGroup for easier animation
    playerGroup.remove(head); playerGroup.remove(headOutline);
    headGroup.add(head); headGroup.add(headOutline);
    head.position.set(0, 0, 0);
    headOutline.position.set(0, 0, 0);
    // re-add headGroup
    // adjust: headGroup at world pos
    headGroup.position.y = 1.07;
    playerGroup.add(headGroup);

    // Eyes - huge black glossy oval
    const eyeGeo = new THREE.SphereGeometry(0.20, 20, 16);
    const eyeL = new THREE.Mesh(eyeGeo, blackEyeMat);
    eyeL.position.set(-0.20, 0.05, 0.46);
    eyeL.scale.set(1.1, 1.35, 0.55);
    eyeL.castShadow = true;
    headGroup.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, blackEyeMat);
    eyeR.position.set(0.20, 0.05, 0.46);
    eyeR.scale.set(1.1, 1.35, 0.55);
    eyeR.castShadow = true;
    headGroup.add(eyeR);

    // Eye outlines - slight bigger black backside
    const eyeOutlineGeo = new THREE.SphereGeometry(0.21, 16, 12);
    const eyeLOut = new THREE.Mesh(eyeOutlineGeo, outlineBlackMat);
    eyeLOut.position.copy(eyeL.position); eyeLOut.scale.set(1.18, 1.42, 0.7); headGroup.add(eyeLOut);
    const eyeROut = new THREE.Mesh(eyeOutlineGeo, outlineBlackMat);
    eyeROut.position.copy(eyeR.position); eyeROut.scale.set(1.18, 1.42, 0.7); headGroup.add(eyeROut);

    // White highlights - glossy dots
    const hlGeo = new THREE.SphereGeometry(0.065, 10, 8);
    const hlL1 = new THREE.Mesh(hlGeo, whiteHighlightMat);
    hlL1.position.set(-0.24, 0.14, 0.58); headGroup.add(hlL1);
    const hlR1 = new THREE.Mesh(hlGeo, whiteHighlightMat);
    hlR1.position.set(0.16, 0.14, 0.58); headGroup.add(hlR1);
    const hlSmallGeo = new THREE.SphereGeometry(0.032, 8, 6);
    const hlL2 = new THREE.Mesh(hlSmallGeo, whiteHighlightMat);
    hlL2.position.set(-0.15, -0.04, 0.59); headGroup.add(hlL2);
    const hlR2 = new THREE.Mesh(hlSmallGeo, whiteHighlightMat);
    hlR2.position.set(0.27, -0.04, 0.59); headGroup.add(hlR2);

    // Tiny heart reflections inside eyes
    const heartShape = createHeartShape(1);
    const heartGeo = new THREE.ExtrudeGeometry(heartShape, { depth: 0.015, bevelEnabled: false });
    heartGeo.scale(0.10, 0.10, 0.10);
    const heartL = new THREE.Mesh(heartGeo, pinkHeartMat);
    heartL.position.set(-0.23, 0.02, 0.61);
    heartL.rotation.z = -0.15;
    headGroup.add(heartL);
    const heartR = new THREE.Mesh(heartGeo, pinkHeartMat);
    heartR.position.set(0.18, 0.02, 0.61);
    heartR.rotation.z = 0.15;
    headGroup.add(heartR);

    // Star hands / wings
    const starShape = createStarShape(0.34, 0.18, 5);
    const starExtrude = new THREE.ExtrudeGeometry(starShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 });
    starExtrude.center();
    const starMat = new THREE.MeshStandardMaterial({ color: 0xfffffb, roughness: 0.4 });
    const starL = new THREE.Mesh(starExtrude, starMat);
    starL.position.set(-0.62, -0.55, 0);
    starL.rotation.z = 0.2;
    starL.castShadow = true;
    playerGroup.add(starL);
    const starLOutline = new THREE.Mesh(starExtrude, outlineBlackMat);
    starLOutline.position.copy(starL.position);
    starLOutline.scale.set(1.12, 1.12, 1.12);
    starLOutline.rotation.copy(starL.rotation);
    playerGroup.add(starLOutline);

    const starR = new THREE.Mesh(starExtrude, starMat);
    starR.position.set(0.62, -0.55, 0);
    starR.rotation.z = -0.2;
    starR.castShadow = true;
    playerGroup.add(starR);
    const starROutline = new THREE.Mesh(starExtrude, outlineBlackMat);
    starROutline.position.copy(starR.position);
    starROutline.scale.set(1.12, 1.12, 1.12);
    starROutline.rotation.copy(starR.rotation);
    playerGroup.add(starROutline);

    // Legs - short stubby
    const legGeo = new THREE.CapsuleGeometry(0.11, 0.22, 4, 10);
    const legL = new THREE.Mesh(legGeo, whiteMat);
    legL.position.set(-0.14, 0.16, 0);
    legL.castShadow = true;
    playerGroup.add(legL);
    const legLOut = new THREE.Mesh(legGeo, outlineBlackMat);
    legLOut.position.copy(legL.position); legLOut.scale.set(1.22, 1.1, 1.22); playerGroup.add(legLOut);

    const legR = new THREE.Mesh(legGeo, whiteMat);
    legR.position.set(0.14, 0.16, 0);
    legR.castShadow = true;
    playerGroup.add(legR);
    const legROut = new THREE.Mesh(legGeo, outlineBlackMat);
    legROut.position.copy(legR.position); legROut.scale.set(1.22, 1.1, 1.22); playerGroup.add(legROut);

    playerGroup.position.set(0, 0.5, 18);
    scene.add(playerGroup);

    const playerParts = { headGroup, head, body, starL, starR, starLOutline, starROutline, legL, legR, legLOut, legROut, eyeL, eyeR, hlL1, hlR1, heartL, heartR, bodyOutline, headOutline };

    // Sparklet Companion - keep golden robot, clean
    const sparkletGroup = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc933, roughness: 0.35, metalness: 0.25 });
    const silverMat = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.3, metalness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e1e24, roughness: 0.8 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffb627, emissive: 0xff8c00, emissiveIntensity: 3.2, transparent: true, opacity: 0.95 });
    const eyeGlowMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xff7b00, emissiveIntensity: 4 });

    const sBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 0.68, 6, 16), silverMat); sBody.position.y = 1.0; sBody.castShadow = true; sparkletGroup.add(sBody);
    const sBodyOut = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 0.68, 6, 16), outlineBlackMat); sBodyOut.position.copy(sBody.position); sBodyOut.scale.set(1.08, 1.05, 1.08); sparkletGroup.add(sBodyOut);
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.58, 0.48, 16), goldMat); chest.position.y = 1.22; chest.castShadow = true; sparkletGroup.add(chest);
    const chestLight = new THREE.Mesh(new THREE.CircleGeometry(0.20, 16), new THREE.MeshStandardMaterial({ color: 0x00ffc2, emissive: 0x00ffc2, emissiveIntensity: 1.6 })); chestLight.position.set(0, 1.22, 0.49); sparkletGroup.add(chestLight);

    const sHeadGroup = new THREE.Group(); sHeadGroup.position.y = 2.0;
    const headBase = new THREE.Mesh(new THREE.SphereGeometry(0.60, 20, 16), goldMat); headBase.scale.set(1, 0.92, 1); headBase.castShadow = true; sHeadGroup.add(headBase);
    const headBaseOut = new THREE.Mesh(new THREE.SphereGeometry(0.60, 20, 16), outlineBlackMat); headBaseOut.scale.set(1.08, 1, 1.08); sHeadGroup.add(headBaseOut);
    const headFront = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.52, 0.42), new THREE.MeshStandardMaterial({ color: 0xfff6d0, roughness: 0.4 })); headFront.position.set(0, 0.05, 0.40); sHeadGroup.add(headFront);
    const eyeLS = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), eyeMat); eyeLS.position.set(-0.20, 0.10, 0.60); sHeadGroup.add(eyeLS);
    const eyeRS = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), eyeMat); eyeRS.position.set(0.20, 0.10, 0.60); sHeadGroup.add(eyeRS);
    const eyeGlowL = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), eyeGlowMat); eyeGlowL.position.copy(eyeLS.position); eyeGlowL.scale.set(1, 1, 0.3); sHeadGroup.add(eyeGlowL);
    const eyeGlowR = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), eyeGlowMat); eyeGlowR.position.copy(eyeRS.position); eyeGlowR.scale.set(1, 1, 0.3); sHeadGroup.add(eyeGlowR);
    const earL = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 8, 16), goldMat); earL.position.set(-0.63, 0.05, 0.05); earL.rotation.y = Math.PI / 2; sHeadGroup.add(earL);
    const earR = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 8, 16), goldMat); earR.position.set(0.63, 0.05, 0.05); earR.rotation.y = Math.PI / 2; sHeadGroup.add(earR);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.33, 8), silverMat); ant.position.set(0, 0.62, 0); sHeadGroup.add(ant);
    const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffb627, emissive: 0xff8c00, emissiveIntensity: 3 })); antTip.position.set(0, 0.86, 0); sHeadGroup.add(antTip);
    sparkletGroup.add(sHeadGroup);

    const sArmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.52, 4, 10), silverMat); sArmL.position.set(-0.70, 1.06, 0); sArmL.castShadow = true; sparkletGroup.add(sArmL);
    const sArmR = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.52, 4, 10), silverMat); sArmR.position.set(0.70, 1.06, 0); sArmR.castShadow = true; sparkletGroup.add(sArmR);
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), goldMat); handL.position.set(-0.70, 0.62, 0); sparkletGroup.add(handL);
    const handR = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), goldMat); handR.position.set(0.70, 0.62, 0); sparkletGroup.add(handR);
    const sLegL = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.32, 4, 8), darkMat); sLegL.position.set(-0.20, 0.24, 0); sparkletGroup.add(sLegL);
    const sLegR = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.32, 4, 8), darkMat); sLegR.position.set(0.20, 0.24, 0); sparkletGroup.add(sLegR);

    sparkletGroup.position.set(0, 0.35, 0);
    scene.add(sparkletGroup);

    const sparkletParts = { headGroup: sHeadGroup, eyeL: eyeLS, eyeR: eyeRS, eyeGlowL, eyeGlowR, earL, earR, antTip, chestLight, sArmL, sArmR, handL, handR, headBase, body: sBody };

    // Input
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "w") keys.w = true;
      if (e.key.toLowerCase() === "a") keys.a = true;
      if (e.key.toLowerCase() === "s") keys.s = true;
      if (e.key.toLowerCase() === "d") keys.d = true;
      if (e.key === "Shift") keys.shift = true;
      if (e.code === "Space") { keys.space = true; e.preventDefault(); }
      if (e.key.toLowerCase() === "e" && !gameRef.current.dialogueOpen) {
        const distToSpark = playerGroup.position.distanceTo(sparkletGroup.position);
        if (distToSpark < 4) { setShowDialogue(true); gameRef.current.dialogueOpen = true; }
        terminals.forEach(t => {
          if (playerGroup.position.distanceTo(t.mesh.position) < 3) {
            setDialogueHistory(h => [...h, { role: "system", text: `[TERMINAL] ${t.text}` }]);
            persistRecord(MSG_COLLECTION, { role: "system", text: `[TERMINAL] ${t.text}`, created_at: new Date().toISOString() });
            setShowDialogue(true); gameRef.current.dialogueOpen = true;
          }
        });
        if (playerGroup.position.distanceTo(teleportPad.position) < 3) {
          playerGroup.position.set(35, 0.5, -32);
          setDialogueHistory(h => [...h, { role: "system", text: "✦ whoosh! teleported to east ridge! crystals twinkle nearby!" }]);
        }
      }
      if (e.key.toLowerCase() === "f") { setThirdPerson(tp => !tp); }
      if (e.key === "Escape") {
        if (gameRef.current.dialogueOpen) { setShowDialogue(false); gameRef.current.dialogueOpen = false; }
        else setShowPause(p => !p);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "w") keys.w = false;
      if (e.key.toLowerCase() === "a") keys.a = false;
      if (e.key.toLowerCase() === "s") keys.s = false;
      if (e.key.toLowerCase() === "d") keys.d = false;
      if (e.key === "Shift") keys.shift = false;
      if (e.code === "Space") keys.space = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      if (document.pointerLockElement !== canvasRef.current) return;
      yaw -= e.movementX * 0.003 * sensitivity;
      pitch -= e.movementY * 0.003 * sensitivity;
      pitch = Math.max(-0.75, Math.min(0.65, pitch));
    };
    const onMouseDown = () => { mouseDown = true; };
    const onMouseUp = () => { mouseDown = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

    canvasRef.current.addEventListener("click", () => {
      if (showMenu || showDialogue || showSettings || showPause) return;
      if (document.pointerLockElement !== canvasRef.current) {
        canvasRef.current?.requestPointerLock();
      }
    });

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics === "high" ? 2 : 1.6));
    };
    window.addEventListener("resize", onResize);

    gameRef.current = {
      player: playerGroup, playerParts, sparklet: sparkletGroup, sparkletParts, sparkletState, stateTimer, playerVelY, grounded, yaw, pitch, camDist, crystalsCollected, crystalsMeshes, terminals, teleportPad, keys, joyMove, joyLook,
      cleanup: () => {
        window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mousedown", onMouseDown); window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("resize", onResize);
      }
    };

    let prog = 0;
    const loadInterval = setInterval(() => {
      prog += Math.random() * 22; if (prog >= 100) { prog = 100; clearInterval(loadInterval); setTimeout(() => { setLoading(false); setLoadingProgress(100); }, 400); } setLoadingProgress(Math.min(100, prog));
    }, 110);

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const delta = Math.min(0.05, clock.getDelta());
      const time = clock.elapsedTime;
      gameRef.current.t = time;

      const forward = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const right = new THREE.Vector3(Math.cos(yaw + Math.PI / 2), 0, Math.sin(yaw + Math.PI / 2));
      let moveX = 0, moveZ = 0;
      if (keys.w) moveZ += 1;
      if (keys.s) moveZ -= 1;
      if (keys.a) moveX -= 1;
      if (keys.d) moveX += 1;
      moveX += joyMove.x;
      moveZ += -joyMove.y;
      yaw += joyLook.x * 0.05;
      pitch += joyLook.y * 0.05;
      pitch = Math.max(-0.75, Math.min(0.65, pitch));

      const moveVec = new THREE.Vector3();
      moveVec.addScaledVector(forward, moveZ);
      moveVec.addScaledVector(right, moveX);
      if (moveVec.lengthSq() > 1) moveVec.normalize();
      const speed = keys.shift ? 6.2 : 3.6;
      const isMoving = moveVec.lengthSq() > 0.01;

      // ground check - use main island
      downRay.set(playerGroup.position.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, -1, 0));
      const intersects = downRay.intersectObjects([grassDisc, mainIsland], false);
      let groundY = 0;
      if (intersects.length > 0) groundY = intersects[0].point.y;
      const distFromCenter = Math.hypot(playerGroup.position.x, playerGroup.position.z);
      if (distFromCenter > 105) {
        const dir = new THREE.Vector2(playerGroup.position.x, playerGroup.position.z).normalize();
        playerGroup.position.x = dir.x * 104; playerGroup.position.z = dir.y * 104;
      }
      for (const b of buildings) {
        const dx = playerGroup.position.x - b.position.x;
        const dz = playerGroup.position.z - b.position.z;
        const minDist = 6.5;
        if (Math.abs(dx) < minDist && Math.abs(dz) < minDist) {
          if (Math.abs(dx) > Math.abs(dz)) playerGroup.position.x += Math.sign(dx) * 0.18;
          else playerGroup.position.z += Math.sign(dz) * 0.18;
        }
      }

      if (playerGroup.position.y <= groundY + 0.52) {
        grounded = true;
        playerGroup.position.y = groundY + 0.52;
        if (keys.space && !gameRef.current.dialogueOpen) { playerVelY = 6.0; grounded = false; }
        else playerVelY = Math.max(0, playerVelY);
      } else {
        grounded = false;
        playerVelY -= 13 * delta;
      }
      playerGroup.position.y += playerVelY * delta;

      if (!gameRef.current.dialogueOpen) {
        playerGroup.position.addScaledVector(moveVec, speed * delta);
        if (isMoving) {
          playerGroup.rotation.y = Math.atan2(moveVec.x, moveVec.z);
        }
      }

      // ===== Cute player animations =====
      const pp = playerParts;
      // idle wobble
      const walkSpeed = keys.shift ? 12 : 8;
      const bobFreq = isMoving ? walkSpeed : 2.2;
      const bobAmp = isMoving ? (keys.shift ? 0.22 : 0.16) : 0.06;
      const bob = Math.sin(time * bobFreq) * bobAmp;

      // body bob and squash/stretch on jump
      const jumpStretch = grounded ? 1 : 1 + Math.abs(playerVelY) * 0.04;
      const jumpSquash = grounded ? 1 : 1 - Math.abs(playerVelY) * 0.02;
      pp.body.position.y = 0.44 + bob * 0.18;
      pp.body.scale.y = (pp.body.scale.y * 0.9 + (jumpStretch * 0.92) * 0.1);
      pp.body.scale.x = (pp.body.scale.x * 0.9 + (jumpSquash * 1) * 0.1);
      pp.bodyOutline.position.copy(pp.body.position);
      pp.bodyOutline.scale.set(1.14 * pp.body.scale.x, 1.08 * pp.body.scale.y, 1.12);

      // head wobble
      pp.headGroup.position.y = 1.07 + bob * 0.12;
      pp.headGroup.rotation.y = Math.sin(time * 0.7) * 0.08 + (isMoving ? Math.sin(time * bobFreq) * 0.06 : 0);
      pp.headGroup.rotation.x = Math.sin(time * 0.9) * 0.04;
      // eyes blink
      const blink = Math.sin(time * 0.45) > 0.998 ? 0.12 : 1;
      pp.eyeL.scale.y = 1.35 * blink;
      pp.eyeR.scale.y = 1.35 * blink;

      // star hands - wing flap
      if (isMoving) {
        pp.starL.rotation.z = 0.2 + Math.sin(time * walkSpeed) * 0.7;
        pp.starR.rotation.z = -0.2 - Math.sin(time * walkSpeed) * 0.7;
        pp.starL.position.y = -0.55 + Math.sin(time * walkSpeed) * 0.12;
        pp.starR.position.y = -0.55 - Math.sin(time * walkSpeed) * 0.12;
      } else {
        // idle wave star hands occasionally
        const wave = Math.sin(time * 1.4);
        if (stateTimer > 3) {
          pp.starL.rotation.z = 0.2 + wave * 0.55;
          pp.starR.rotation.z = -0.2 - wave * 0.55;
          pp.starL.rotation.y = wave * 0.3;
          pp.starR.rotation.y = -wave * 0.3;
        } else {
          pp.starL.rotation.z = 0.2 + Math.sin(time * 0.8) * 0.15;
          pp.starR.rotation.z = -0.2 + Math.sin(time * 0.8 + 1) * 0.15;
        }
      }
      pp.starLOutline.position.copy(pp.starL.position); pp.starLOutline.rotation.copy(pp.starL.rotation);
      pp.starROutline.position.copy(pp.starR.position); pp.starROutline.rotation.copy(pp.starR.rotation);

      // legs
      if (isMoving) {
        pp.legL.rotation.x = Math.sin(time * walkSpeed) * 0.9;
        pp.legR.rotation.x = Math.sin(time * walkSpeed + Math.PI) * 0.9;
      } else {
        pp.legL.rotation.x = Math.sin(time * 0.8) * 0.05;
        pp.legR.rotation.x = Math.sin(time * 0.8 + 1) * 0.05;
      }
      pp.legLOut.position.copy(pp.legL.position); pp.legLOut.rotation.copy(pp.legL.rotation);
      pp.legROut.position.copy(pp.legR.position); pp.legROut.rotation.copy(pp.legR.rotation);

      // crystals
      crystalsMeshes.forEach((c, i) => {
        if ((c as any).userData.collected) return;
        c.rotation.y += delta * 1.2;
        c.rotation.x += delta * 0.35;
        c.position.y = (c as any).userData.baseY + Math.sin(time * 1.1 + (c as any).userData.ang) * 0.32;
        const out = (c as any)._outline as THREE.Mesh;
        if (out) out.position.copy(c.position);
        const l = (c as any).userData.light as THREE.PointLight;
        if (l) { l.position.copy(c.position); l.intensity = 0.8 + Math.sin(time * 3 + i) * 0.35; }
        if (playerGroup.position.distanceTo(c.position) < 1.8) {
          (c as any).userData.collected = true;
          c.visible = false;
          if (out) out.visible = false;
          if (l) l.visible = false;
          crystalsCollected.add(i);
          setCrystals(crystalsCollected.size);
          if (crystalsCollected.size === 1) setObjective("Nice! You found one ✦ 1/5");
          else if (crystalsCollected.size < 5) setObjective(`Crystals ✦ ${crystalsCollected.size}/5`);
          else setObjective("All crystals! Return to Sparklet ✦");
          try {
            fetch("actions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "records.create", args: { collection: PROGRESS_COLLECTION, value: { crystals: crystalsCollected.size, updated_at: new Date().toISOString() } } })
            });
          } catch { }
        }
      });

      // Sparklet FSM
      const distToPlayer = playerGroup.position.distanceTo(sparkletGroup.position);
      stateTimer += delta;

      let newState: SparkletState = sparkletState;
      if (!gameRef.current.dialogueOpen) {
        if (distToPlayer < 3.8) {
          if (sparkletState !== "invite" && sparkletState !== "listening") newState = "invite";
        } else if (distToPlayer < 14) {
          if (sparkletState === "idle" || sparkletState === "curious") newState = "notice";
        } else {
          if (sparkletState === "notice" || sparkletState === "invite") newState = "idle";
        }
        if (following && distToPlayer > 4.2 && distToPlayer < 20) {
          const dir = new THREE.Vector3().subVectors(playerGroup.position, sparkletGroup.position); dir.y = 0; dir.normalize();
          sparkletGroup.position.addScaledVector(dir, 2.0 * delta);
          sparkletGroup.rotation.y = Math.atan2(dir.x, dir.z);
          newState = "follow";
        }
        if (sparkletState === "idle" && stateTimer > 7 && Math.random() < 0.012) { newState = "curious"; stateTimer = 0; }
        if (sparkletState === "curious" && stateTimer > 3) { newState = "idle"; stateTimer = 0; }
        if (sparkletState === "notice" && stateTimer > 2.5) { newState = "idle"; stateTimer = 0; }
      }
      if (newState !== sparkletState) { sparkletState = newState; stateTimer = 0; gameRef.current.sparkletState = newState; }

      // Sparklet animations
      const sp = sparkletParts;
      sparkletGroup.position.y = 0.35 + Math.sin(time * 1.4) * 0.07;
      sp.headGroup.rotation.y = Math.sin(time * 0.6) * 0.12;
      sp.headGroup.rotation.x = Math.sin(time * 0.8) * 0.04;
      sp.earL.rotation.z = Math.sin(time * 1.1) * 0.18;
      sp.earR.rotation.z = -Math.sin(time * 1.1) * 0.18;
      const sBlink = Math.sin(time * 0.32) > 0.998 ? 0.1 : 1;
      sp.eyeL.scale.y = sBlink; sp.eyeR.scale.y = sBlink;
      if (["notice", "invite", "listening", "speaking", "follow"].includes(sparkletState)) {
        const target = playerGroup.position.clone(); target.y += 1.0;
        const worldPos = new THREE.Vector3(); sp.headGroup.getWorldPosition(worldPos);
        const dir = new THREE.Vector3().subVectors(target, worldPos);
        const lookYaw = Math.atan2(dir.x, dir.z) - sparkletGroup.rotation.y;
        sp.headGroup.rotation.y += (lookYaw * 0.5 - sp.headGroup.rotation.y) * delta * 3;
        sp.eyeGlowL.material.emissiveIntensity = 5 + Math.sin(time * 6) * 0.5;
        sp.eyeGlowR.material.emissiveIntensity = 5 + Math.sin(time * 6) * 0.5;
      } else {
        sp.eyeGlowL.material.emissiveIntensity = 3.2; sp.eyeGlowR.material.emissiveIntensity = 3.2;
      }
      if (sparkletState === "thinking") { sp.headGroup.rotation.z = Math.sin(time * 8) * 0.12; sp.antTip.material.emissiveIntensity = 2 + Math.sin(time * 15) * 2; }
      if (sparkletState === "happy") { sparkletGroup.position.y += Math.sin(time * 12) * 0.10; sp.sArmL.rotation.x = Math.sin(time * 10) * 0.7; sp.sArmR.rotation.x = -Math.sin(time * 10) * 0.7; }
      if (sparkletState === "confused") { sp.headGroup.rotation.z = Math.sin(time * 4) * 0.32; }
      if (sparkletState === "invite") { sp.sArmR.rotation.z = Math.sin(time * 3) * 0.5 - 0.2; sp.sArmR.rotation.x = -0.45; }

      // interaction prompt
      let prompt: string | null = null;
      if (distToPlayer < 4 && !gameRef.current.dialogueOpen) prompt = "Talk to Sparklet";
      else {
        for (const t of terminals) { if (playerGroup.position.distanceTo(t.mesh.position) < 2.8) { prompt = "Read terminal"; break; } }
        if (!prompt && playerGroup.position.distanceTo(teleportPad.position) < 2.8) prompt = "Teleport";
      }
      if (prompt !== interactionPrompt) {
        setInteractionPrompt(prompt as any);
      }

      // Camera - cozy third person
      const camTarget = playerGroup.position.clone().add(new THREE.Vector3(0, 0.95, 0));
      if (!thirdPerson) {
        camera.position.copy(camTarget); camera.position.y += 0.35;
        const lookDir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
        camera.lookAt(camTarget.clone().add(lookDir.multiplyScalar(10)));
      } else {
        const dist = camDist;
        const offset = new THREE.Vector3(
          -Math.cos(yaw) * Math.cos(pitch) * dist,
          Math.sin(pitch) * dist + 1.2,
          -Math.sin(yaw) * Math.cos(pitch) * dist
        );
        const desiredPos = camTarget.clone().add(offset);
        raycaster.set(camTarget, offset.clone().normalize());
        const hits = raycaster.intersectObjects([...buildings, grassDisc], false);
        if (hits.length > 0 && hits[0].distance < offset.length()) {
          desiredPos.copy(camTarget).addScaledVector(offset.clone().normalize(), Math.max(1.4, hits[0].distance - 0.35));
        }
        camera.position.lerp(desiredPos, 0.14);
        camera.lookAt(camTarget);
      }

      floatRocks.forEach((fr: any, i) => { fr.rotation.y += delta * 0.14 * (i % 2 ? 1 : -1); fr.position.y += Math.sin(time * 0.5 + i) * 0.006; });

      const dPos = dustGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < dustCount; i++) {
        let y = dPos.getY(i);
        y += dustVel[i] * delta * 0.22;
        if (y > 24) { y = 0; dPos.setX(i, (Math.random() - 0.5) * 200); dPos.setZ(i, (Math.random() - 0.5) * 200); }
        dPos.setY(i, y);
      }
      dPos.needsUpdate = true;
      dustPoints.rotation.y += delta * 0.015;

      ring2.rotation.z += delta * 0.35;
      ring3.rotation.z -= delta * 0.55;

      renderer.render(scene, camera);

      if (minimapRef.current) {
        const mctx = minimapRef.current.getContext("2d")!;
        const size = minimapRef.current.width;
        mctx.clearRect(0, 0, size, size);
        mctx.fillStyle = "#ffffff"; mctx.beginPath(); mctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); mctx.fill();
        mctx.strokeStyle = "#111111"; mctx.lineWidth = 2.5; mctx.beginPath(); mctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2); mctx.stroke();
        mctx.fillStyle = "#eaf5e6"; mctx.beginPath(); mctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2); mctx.fill();
        const toMap = (v: THREE.Vector3) => ({ x: size / 2 + (v.x / 120) * (size / 2 - 12), y: size / 2 + (v.z / 120) * (size / 2 - 12) });
        crystalsMeshes.forEach(c => {
          if ((c as any).userData.collected) return;
          const p = toMap(c.position);
          mctx.fillStyle = "#ff7ab2"; mctx.beginPath(); mctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); mctx.fill();
          mctx.strokeStyle = "#111"; mctx.lineWidth = 1; mctx.stroke();
        });
        const spPos = toMap(sparkletGroup.position);
        mctx.fillStyle = "#ffc933"; mctx.beginPath(); mctx.arc(spPos.x, spPos.y, 5.5, 0, Math.PI * 2); mctx.fill(); mctx.strokeStyle = "#111"; mctx.lineWidth = 1.5; mctx.stroke();
        const plPos = toMap(playerGroup.position);
        mctx.fillStyle = "#ffffff"; mctx.beginPath(); mctx.arc(plPos.x, plPos.y, 5, 0, Math.PI * 2); mctx.fill(); mctx.strokeStyle = "#111"; mctx.lineWidth = 2; mctx.stroke();
        mctx.strokeStyle = "#111"; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.moveTo(plPos.x, plPos.y); const ang = playerGroup.rotation.y; mctx.lineTo(plPos.x + Math.sin(ang) * 12, plPos.y + Math.cos(ang) * 12); mctx.stroke();
      }
    };
    animate();

    setObjective("Find Sparklet at the central ring ✦");

    return () => {
      cancelAnimationFrame(animationId);
      clearInterval(loadInterval);
      gameRef.current.cleanup?.();
      renderer.dispose();
    };
  }, [graphics, thirdPerson, sensitivity]);

  const localFallbacks = [
    "✦ whoa! your star hands are sparkling! i've been polishing my golden plates waiting for you!",
    " LOCAL PRESET: beep! hi little star creature! my amber eyes light up when you get close! want to hunt crystals together?",
    " LOCAL PRESET: those pastel crystals hum so pretty... kinda like your wobbly walk! you're so cute when you bounce!",
    " LOCAL PRESET: the teleport pad near the south got hiccups again — but you can still boop it with E!",
    " LOCAL PRESET: i noticed you! i was idle-dreaming about floating islands and you appeared! wanna follow me?",
  ];

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    const userMsg = inputText.trim();
    setDialogueHistory(h => [...h, { role: "user", text: userMsg }]);
    persistRecord(MSG_COLLECTION, { role: "user", text: userMsg, created_at: new Date().toISOString() });
    setInputText("");
    setIsThinking(true);
    if (gameRef.current) { gameRef.current.sparkletState = "thinking"; (gameRef.current as any).stateTimer = 0; }

    let replyText = "";
    let isLocal = false;
    if (apiUrl && apiStatus === "connected") {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(apiUrl.replace(/\/$/, "") + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}) },
          body: JSON.stringify({ message: userMsg }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        replyText = data.reply || data.response || data.text || JSON.stringify(data);
      } catch (e: any) {
        replyText = `my brain link glitched (${e.message || "network"}), but locally i think: ${localFallbacks[Math.floor(Math.random() * localFallbacks.length)]}`;
        isLocal = replyText.includes("LOCAL PRESET");
        setApiStatus("error");
      }
    } else {
      await new Promise(r => setTimeout(r, 550 + Math.random() * 500));
      replyText = localFallbacks[Math.floor(Math.random() * localFallbacks.length)];
      isLocal = true;
    }

    setIsThinking(false);
    let displayed = "";
    const full = replyText;
    setDialogueHistory(h => [...h, { role: "sparklet", text: "", isLocal }]);
    let idx = 0;
    const typeInterval = setInterval(() => {
      idx += Math.random() > 0.7 ? 2 : 1;
      displayed = full.slice(0, idx);
      setDialogueHistory(h => {
        const copy = [...h];
        copy[copy.length - 1] = { role: "sparklet", text: displayed, isLocal };
        return copy;
      });
      if (idx >= full.length) {
        clearInterval(typeInterval);
        persistRecord(MSG_COLLECTION, { role: "sparklet", text: full, isLocal, created_at: new Date().toISOString() });
        if (gameRef.current) {
          const lower = full.toLowerCase();
          if (lower.includes("yay") || lower.includes("!") || lower.includes("✦")) { gameRef.current.sparkletState = "happy"; }
          else if (lower.includes("?")) { gameRef.current.sparkletState = "confused"; }
          else { gameRef.current.sparkletState = "speaking"; }
          (gameRef.current as any).stateTimer = 0;
          setTimeout(() => { if (gameRef.current) gameRef.current.sparkletState = "idle"; }, 3400);
        }
      }
    }, 16);
  };

  const Joystick = ({ side }: { side: "left" | "right" }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    useEffect(() => {
      const el = ref.current; if (!el) return;
      const handleStart = (e: TouchEvent) => { e.preventDefault(); setActive(true); };
      const handleMove = (e: TouchEvent) => {
        if (!active) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2;
        const t = e.touches[0]; if (!t) return;
        let dx = (t.clientX - cx) / (rect.width / 2);
        let dy = (t.clientY - cy) / (rect.height / 2);
        const mag = Math.hypot(dx, dy); if (mag > 1) { dx /= mag; dy /= mag; }
        setPos({ x: dx * 36, y: dy * 36 });
        if (side === "left") (window as any)._joyMove = { x: dx, y: dy };
        else (window as any)._joyLook = { x: dx * 1.2, y: -dy * 1.2 };
        if (gameRef.current) {
          if (side === "left") gameRef.current.joyMove = { x: dx, y: dy };
          else gameRef.current.joyLook = { x: dx * 1.2, y: -dy * 1.2 };
        }
      };
      const handleEnd = () => { setActive(false); setPos({ x: 0, y: 0 }); if (side === "left") { (window as any)._joyMove = { x: 0, y: 0 }; if (gameRef.current) gameRef.current.joyMove = { x: 0, y: 0 }; } else { (window as any)._joyLook = { x: 0, y: 0 }; if (gameRef.current) gameRef.current.joyLook = { x: 0, y: 0 }; } };
      el.addEventListener("touchstart", handleStart, { passive: false });
      el.addEventListener("touchmove", handleMove, { passive: false });
      el.addEventListener("touchend", handleEnd);
      return () => { el.removeEventListener("touchstart", handleStart); el.removeEventListener("touchmove", handleMove); el.removeEventListener("touchend", handleEnd); };
    }, [active, side]);
    return (
      <div ref={ref} className="absolute w-[120px] h-[120px] rounded-full border-[2.5px] border-black bg-white/85 backdrop-blur-xl flex items-center justify-center touch-none select-none shadow-[4px_4px_0px_#111]" style={side === "left" ? { left: 14, bottom: 86 } : { right: 14, bottom: 86 }}>
        <div className="w-[78px] h-[78px] rounded-full bg-black/5 border-[2px] border-black/10" />
        <div className="absolute w-11 h-11 rounded-full bg-black border-[2.5px] border-black flex items-center justify-center text-white text-[14px] pointer-events-none shadow-[2px_2px_0px_#111]" style={{ transform: `translate(${pos.x}px,${pos.y}px)` }}>{side === "left" ? "✦" : "◐"}</div>
        <div className="absolute -bottom-6 text-[10px] font-black tracking-widest text-black bg-white px-2 py-0.5 rounded-full border-[1.5px] border-black">{side === "left" ? "MOVE" : "LOOK"}</div>
      </div>
    );
  };

  return (
    <div ref={containerRef} data-safe-area-inset-root className="relative w-full h-[100dvh] bg-[#f6f8ff] overflow-hidden text-black antialiased" style={{ boxSizing: "border-box", paddingTop: "var(--safe-area-inset-top)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Space+Grotesk:wght@500;700&display=swap');
        *{font-family:"Plus Jakarta Sans",system-ui,sans-serif}
        .display{font-family:"Space Grotesk",sans-serif}
        .mono{font-family:"Space Grotesk",monospace}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#111;border-radius:999px}
        @keyframes floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes pulseStar { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
      `}</style>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      <canvas ref={minimapRef} width={148} height={148} className="absolute top-[76px] right-3 w-[96px] h-[96px] md:w-[148px] md:h-[148px] rounded-[22px] border-[2.5px] border-black bg-white shadow-[4px_4px_0px_#111]" />

      {/* Top HUD - clean white glass */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-3 md:p-4 pointer-events-none" data-safe-area-sticky-top style={{ top: "var(--safe-area-inset-top)" }}>
        <div className="pointer-events-auto flex items-center gap-2 md:gap-3">
          <div className="px-3.5 md:px-5 py-2.5 rounded-full bg-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center text-[12px] font-black">✦</div>
            <span className="display text-[12px] md:text-[13px] font-bold tracking-wide">SPARKLET WORLD</span>
            <span className="hidden lg:inline text-[11px] font-bold bg-black text-white px-2 py-0.5 rounded-full ml-1">{objective}</span>
          </div>
          <div className="hidden md:flex px-4 py-2.5 rounded-full bg-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] text-[11px] font-black gap-2 items-center">
            <span className="opacity-60">CRYSTALS</span><span className="bg-[#ffd84d] px-2 py-0.5 rounded-full border border-black">{crystals}/5</span>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <div className={`px-3.5 py-2.5 rounded-full border-[2.5px] border-black shadow-[3px_3px_0px_#111] text-[11px] font-black flex items-center gap-2 ${apiStatus === "connected" ? "bg-[#c6f6c0] text-black" : apiStatus === "checking" ? "bg-[#ffe9a8] text-black" : "bg-white text-black/70"}`}>
            <div className={`w-2 h-2 rounded-full border border-black ${apiStatus === "connected" ? "bg-black animate-pulse" : apiStatus === "checking" ? "bg-black animate-bounce" : "bg-black/30"}`} />
            {apiStatus.toUpperCase()}
          </div>
          {vrSupported && (
            <button onClick={() => alert("VR: Use browser's XR button. Three.js xr.enabled is on — connect headset and press Enter VR in browser UI.")} className="px-4 py-2.5 rounded-full bg-black text-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] text-[11px] font-black tracking-widest hover:translate-y-[1px] hover:shadow-[2px_2px_0px_#111] transition">ENTER VR</button>
          )}
          <button onClick={() => setShowSettings(true)} className="pointer-events-auto w-10 h-10 rounded-full bg-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] flex items-center justify-center hover:translate-y-[1px] hover:shadow-[2px_2px_0px_#111] transition">⚙</button>
        </div>
      </div>

      {/* BIG floating TALK TO SPARKLET when near */}
      {interactionPrompt && !showDialogue && (
        <div className="absolute bottom-[32%] left-1/2 -translate-x-1/2 pointer-events-auto z-10">
          <button
            onClick={() => { setShowDialogue(true); if (gameRef.current) gameRef.current.dialogueOpen = true; }}
            className="group px-7 py-4 rounded-full bg-white border-[3px] border-black shadow-[5px_5px_0px_#111] flex items-center gap-3 animate-[floaty_2.2s_ease-in-out_infinite] hover:shadow-[7px_7px_0px_#111] hover:-translate-y-[1px] transition-all"
          >
            <span className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center text-[18px] animate-[pulseStar_1.2s_ease-in-out_infinite]">✦</span>
            <span className="display text-[14px] font-black tracking-wide">TALK TO SPARKLET</span>
            <span className="ml-1 text-[12px] font-bold bg-[#ffd84d] px-2.5 py-1 rounded-full border-[2px] border-black">E</span>
          </button>
        </div>
      )}

      {/* Always visible bottom-center big pill TALK button */}
      {!showMenu && !showDialogue && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-5 md:bottom-6 z-20 pointer-events-auto flex flex-col items-center gap-2">
          <button
            onClick={() => { setShowDialogue(true); if (gameRef.current) gameRef.current.dialogueOpen = true; }}
            className="px-8 md:px-10 py-3.5 md:py-4 rounded-full bg-black text-white border-[2.5px] border-black shadow-[5px_5px_0px_#111] display font-black text-[15px] md:text-[16px] tracking-wide flex items-center gap-2.5 hover:shadow-[7px_7px_0px_#111] hover:-translate-y-[1px] active:translate-y-[2px] active:shadow-[2px_2px_0px_#111] transition-all"
          >
            <span className="text-[18px]">✦</span> TALK
          </button>
          <span className="text-[10px] font-black tracking-widest bg-white border-[1.5px] border-black px-2 py-0.5 rounded-full shadow-[2px_2px_0px_#111] hidden md:block">AI CHAT • ALWAYS HERE</span>
        </div>
      )}

      {/* Mobile controls */}
      {isMobile && !showMenu && !showDialogue && (
        <>
          <Joystick side="left" />
          <Joystick side="right" />
          <div className="absolute left-1/2 -translate-x-1/2 bottom-[20px] flex gap-2.5 z-10">
            <button onTouchStart={() => { if (gameRef.current.keys) { gameRef.current.keys.space = true; setTimeout(() => { if (gameRef.current.keys) gameRef.current.keys.space = false; }, 180); } }} className="w-14 h-14 rounded-full bg-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] text-[11px] font-black">JUMP</button>
            <button onTouchStart={() => { const dist = gameRef.current.player && gameRef.current.sparklet ? gameRef.current.player.position.distanceTo(gameRef.current.sparklet.position) : 999; if (dist < 4.5) { setShowDialogue(true); if (gameRef.current) gameRef.current.dialogueOpen = true; } }} className="w-16 h-14 rounded-full bg-black text-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] text-[11px] font-black">TALK</button>
            <button onTouchStart={() => { if (gameRef.current.keys) gameRef.current.keys.shift = true; }} onTouchEnd={() => { if (gameRef.current.keys) gameRef.current.keys.shift = false; }} className="w-14 h-14 rounded-full bg-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] text-[11px] font-black">RUN</button>
          </div>
        </>
      )}

      {/* Dialogue UI - clean white card with black outline */}
      {showDialogue && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end p-3 md:p-6 bg-white/55 backdrop-blur-[8px]">
          <div className="mx-auto w-full max-w-[760px] rounded-[26px] border-[3px] border-black bg-white shadow-[8px_8px_0px_#111] overflow-hidden flex flex-col max-h-[74vh]">
            <div className="flex items-center justify-between px-5 py-3.5 border-b-[2.5px] border-black bg-[#fffdf0]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center font-black text-[13px] border-[2px] border-black shadow-[2px_2px_0px_#111]">✦</div>
                <div>
                  <div className="display text-[13px] font-black tracking-wide">SPARKLET • {gameRef.current.sparkletState?.toUpperCase()}</div>
                  <div className="text-[11px] font-bold opacity-60">{isThinking ? "✦ thinking..." : "listening • cute creature explorer"}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { if (gameRef.current) { gameRef.current.following = !gameRef.current.following; const msg = gameRef.current.following ? "✦ Sparklet will follow your wobbly steps!" : "✦ Sparklet stopped following."; setDialogueHistory(h => [...h, { role: "system", text: msg }]); persistRecord(MSG_COLLECTION, { role: "system", text: msg, created_at: new Date().toISOString() }); } }} className="px-3.5 py-2 rounded-full bg-white border-[2px] border-black shadow-[2px_2px_0px_#111] text-[11px] font-black hover:translate-y-[1px] hover:shadow-[1px_1px_0px_#111] transition">
                  {gameRef.current?.following ? "UNFOLLOW" : "FOLLOW ME ✦"}
                </button>
                <button onClick={() => { setShowDialogue(false); if (gameRef.current) { gameRef.current.dialogueOpen = false; gameRef.current.sparkletState = "farewell"; setTimeout(() => { if (gameRef.current) gameRef.current.sparkletState = "idle"; }, 1100); } }} className="w-9 h-9 rounded-full bg-black text-white border-[2px] border-black shadow-[2px_2px_0px_#111] flex items-center justify-center font-black">✕</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[42vh] bg-[#fcfcff]">
              {dialogueHistory.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[84%] px-4 py-3 rounded-[20px] border-[2.5px] border-black shadow-[3px_3px_0px_#111] text-[13px] leading-relaxed font-medium ${m.role === "user" ? "bg-black text-white rounded-br-[8px]" : m.role === "system" ? "bg-[#fff6d6] text-black/70 text-[11px] font-bold italic rounded-[14px]" : "bg-white text-black rounded-bl-[8px]"}`}>
                    <span>{m.text}</span>
                    {m.isLocal && <span className="ml-2 text-[9px] px-2 py-0.5 rounded-full bg-[#ffd84d] border-[1.5px] border-black font-black">LOCAL</span>}
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="flex justify-start">
                  <div className="px-4 py-3 rounded-[20px] rounded-bl-[8px] bg-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] flex gap-1.5 items-center">
                    <span className="w-2 h-2 bg-black rounded-full animate-bounce" /><span className="w-2 h-2 bg-black rounded-full animate-bounce [animation-delay:0.1s]" /><span className="w-2 h-2 bg-black rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="ml-2 text-[11px] font-black">Sparklet thinking ✦</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 border-t-[2.5px] border-black bg-white">
              <div className="flex items-end gap-2">
                <textarea value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Ask Sparklet about crystals, garden, your star hands..." className="flex-1 min-h-[52px] max-h-[110px] rounded-[18px] bg-[#f7f7f8] border-[2.5px] border-black px-4 py-3.5 text-[13px] font-medium resize-none outline-none focus:bg-white placeholder:text-black/35 shadow-[2px_2px_0px_#111] focus:shadow-[3px_3px_0px_#111] transition-all" rows={1} />
                <button onClick={sendMessage} disabled={isThinking || !inputText.trim()} className="h-[52px] px-6 rounded-[18px] bg-black text-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] font-black text-[13px] disabled:opacity-40 hover:shadow-[4px_4px_0px_#111] hover:-translate-y-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_#111] transition-all">SEND ✦</button>
              </div>
              <div className="mt-2.5 flex items-center justify-between text-[10px] font-black tracking-wide opacity-60">
                <span>ENTER to send • SHIFT+ENTER newline • API {apiStatus}</span>
                <span>{apiStatus !== "connected" ? "LOCAL REPLIES ✦" : "RoboAI LIVE ✦"}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Menu - clean */}
      {showMenu && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-[#f6f8ff]/88 backdrop-blur-[14px]">
          <div className="w-full max-w-[560px] rounded-[28px] border-[3px] border-black bg-white shadow-[10px_10px_0px_#111] overflow-hidden">
            <div className="p-7 md:p-9">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 rounded-[16px] bg-black border-[2.5px] border-black shadow-[3px_3px_0px_#111] flex items-center justify-center text-white font-black text-[18px]">✦</div>
                  <div><h1 className="display text-[22px] font-black tracking-tight leading-none">SPARKLET<br />WORLD</h1><p className="text-[10px] font-black tracking-widest opacity-60 mt-1">CUTE CREATURE EDITION • v2.0</p></div>
                </div>
                <img src={cuteRefUrl} alt="Cute reference creature" className="w-[72px] h-[72px] rounded-[16px] border-[2.5px] border-black shadow-[3px_3px_0px_#111] object-contain bg-[#fffdf5] p-1" />
              </div>

              <div className="rounded-[18px] border-[2.5px] border-black bg-[#fffef2] p-4 mb-5 shadow-[4px_4px_0px_#111]">
                <p className="text-[13px] leading-relaxed font-medium"><span className="font-black">You are the cute creature!</span> Round big head, glossy black eyes with heart sparkles, tiny body, star-shaped hands. Waddle around a cozy clean sci-fi garden to meet your golden robot friend Sparklet. Clean visuals, soft pastel world, super readable.</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-black">
                  <div className="rounded-full bg-white border-[2px] border-black px-2.5 py-1.5 text-center">✦ BIG HEAD</div>
                  <div className="rounded-full bg-white border-[2px] border-black px-2.5 py-1.5 text-center">★ STAR HANDS</div>
                  <div className="rounded-full bg-white border-[2px] border-black px-2.5 py-1.5 text-center">♥ GLOSSY EYES</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-6 text-[11px] font-medium">
                <div className="rounded-[16px] bg-[#f7f7f8] border-[2.5px] border-black p-3 shadow-[3px_3px_0px_#111]"><div className="font-black tracking-widest opacity-60 text-[10px]">DESKTOP</div><div className="mt-1.5 leading-relaxed">WASD move • Mouse drag look • Space jump • Shift run • E talk • F view • Big TALK button always visible</div></div>
                <div className="rounded-[16px] bg-[#f7f7f8] border-[2.5px] border-black p-3 shadow-[3px_3px_0px_#111]"><div className="font-black tracking-widest opacity-60 text-[10px]">MOBILE / VR</div><div className="mt-1.5 leading-relaxed">Left joystick move • Right drag look • Jump/Talk/Run • Bottom ✦ TALK pill opens AI • VR if headset</div></div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => { setShowMenu(false); setShowTutorial(true); }} className="flex-1 h-[56px] rounded-[18px] bg-black text-white border-[3px] border-black shadow-[4px_4px_0px_#111] display font-black tracking-wide text-[14px] hover:shadow-[6px_6px_0px_#111] hover:-translate-y-[1px] transition-all">ENTER WORLD ✦</button>
                <button onClick={() => setShowSettings(true)} className="h-[56px] px-5 rounded-[18px] bg-white border-[3px] border-black shadow-[4px_4px_0px_#111] font-black text-[12px] hover:shadow-[5px_5px_0px_#111] hover:-translate-y-[1px] transition-all">SETTINGS</button>
              </div>

              <div className="mt-6 text-[10px] font-bold leading-relaxed opacity-50">
                Clean cozy sci-fi: pastel sky, soft shadows, rounded islands, white labs, pastel crystals, no heavy fog. Player = your reference image 3D recreation with toon outline. Companion = golden Sparklet robot. Backend token stored locally only.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#f6f8ff]">
          <div className="w-[300px] text-center">
            <div className="w-20 h-20 mx-auto rounded-[20px] bg-white border-[3px] border-black shadow-[4px_4px_0px_#111] flex items-center justify-center mb-5 animate-[floaty_2s_ease-in-out_infinite]">
              <img src={cuteRefUrl} alt="Cute creature loading" className="w-[52px] h-[52px] object-contain" />
            </div>
            <div className="text-[11px] font-black tracking-[0.18em]">LOADING SPARKLET WORLD • {Math.round(loadingProgress)}%</div>
            <div className="mt-3 h-3 w-full rounded-full bg-white border-[2.5px] border-black shadow-[2px_2px_0px_#111] overflow-hidden p-0.5"><div className="h-full bg-black rounded-full transition-all duration-200" style={{ width: `${loadingProgress}%` }} /></div>
            <div className="mt-3 text-[10px] font-bold opacity-60">Crafting cute creature • Clean island • Spawning Sparklet</div>
          </div>
        </div>
      )}

      {showTutorial && !showMenu && !loading && (
        <div className="absolute bottom-[88px] md:bottom-24 left-1/2 -translate-x-1/2 md:left-4 md:translate-x-0 z-20 w-[94%] md:w-[360px] rounded-[20px] border-[2.5px] border-black bg-white shadow-[5px_5px_0px_#111] p-4">
          <div className="flex items-start justify-between gap-3">
            <div><div className="display text-[12px] font-black tracking-wide">YOU ARE THE STAR ✦</div><div className="mt-1 text-[11px] font-medium leading-relaxed opacity-75">Click canvas to lock mouse. WASD = waddle. Star hands wave when idle. Find Sparklet at center (golden). Use big black TALK button anytime. 5 pastel crystals, 3 terminals, teleport pad south.</div></div>
            <button onClick={() => setShowTutorial(false)} className="w-8 h-8 rounded-full bg-black text-white border-[2px] border-black font-black text-[12px]">✕</button>
          </div>
        </div>
      )}

      {showPause && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 backdrop-blur-[10px]">
          <div className="w-[360px] rounded-[22px] border-[3px] border-black bg-white shadow-[8px_8px_0px_#111] p-6">
            <h3 className="display text-[18px] font-black tracking-wide mb-4">PAUSED ✦</h3>
            <div className="grid gap-2.5">
              <button onClick={() => setShowPause(false)} className="h-12 rounded-[14px] bg-black text-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] font-black">RESUME</button>
              <button onClick={() => { setShowPause(false); setShowSettings(true); }} className="h-12 rounded-[14px] bg-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] font-black text-[12px]">SETTINGS</button>
              <button onClick={() => { setShowPause(false); setShowMenu(true); }} className="h-12 rounded-[14px] bg-[#f7f7f8] border-[2.5px] border-black shadow-[3px_3px_0px_#111] font-black text-[12px] opacity-70">MAIN MENU</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-white/75 backdrop-blur-[14px]">
          <div className="w-full max-w-[520px] rounded-[24px] border-[3px] border-black bg-white shadow-[8px_8px_0px_#111] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5"><h3 className="display text-[16px] font-black tracking-wide">SETTINGS ✦</h3><button onClick={() => setShowSettings(false)} className="w-9 h-9 rounded-full bg-black text-white border-[2px] border-black font-black">✕</button></div>

            <div className="space-y-5">
              <div>
                <label className="text-[11px] font-black tracking-widest opacity-60">ROBOAI API URL</label>
                <input value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://your-proxy.example.com" className="mt-1.5 w-full h-12 rounded-[14px] bg-[#f7f7f8] border-[2.5px] border-black px-4 text-[12px] font-medium outline-none focus:bg-white shadow-[2px_2px_0px_#111]" />
              </div>
              <div>
                <label className="text-[11px] font-black tracking-widest opacity-60">BEARER TOKEN (local only)</label>
                <input value={apiToken} onChange={e => setApiToken(e.target.value)} type="password" placeholder="••••••••" className="mt-1.5 w-full h-12 rounded-[14px] bg-[#f7f7f8] border-[2.5px] border-black px-4 text-[12px] font-medium outline-none focus:bg-white shadow-[2px_2px_0px_#111]" />
                <div className="mt-2 text-[10px] font-bold opacity-50">Never hardcoded. Sent as Authorization: Bearer. Test via /health.</div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveApiConfig} className="flex-1 h-12 rounded-[14px] bg-black text-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] font-black text-[12px]">SAVE & CHECK ✦</button>
                <button onClick={checkHealth} className="h-12 px-5 rounded-[14px] bg-white border-[2.5px] border-black shadow-[3px_3px_0px_#111] font-black text-[11px]">TEST</button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[11px] font-black opacity-60">GRAPHICS</label>
                  <select value={graphics} onChange={e => { setGraphics(e.target.value as any); localStorage.setItem("sparklet_gfx", e.target.value); }} className="mt-1.5 w-full h-12 rounded-[14px] bg-[#f7f7f8] border-[2.5px] border-black px-3 text-[12px] font-bold shadow-[2px_2px_0px_#111]">
                    <option value="low">Low (perf)</option><option value="med">Medium</option><option value="high">High</option>
                  </select></div>
                <div><label className="text-[11px] font-black opacity-60">MOUSE SENSITIVITY</label>
                  <input type="range" min={0.3} max={2} step={0.1} value={sensitivity} onChange={e => setSensitivity(parseFloat(e.target.value))} className="mt-4 w-full accent-black" /></div>
              </div>

              <div className="flex items-center justify-between rounded-[14px] bg-[#f7f7f8] border-[2.5px] border-black p-3.5 shadow-[3px_3px_0px_#111]">
                <span className="text-[11px] font-black">Mute ambient</span>
                <button onClick={() => setMuted(m => !m)} className={`w-12 h-7 rounded-full p-1 border-[2px] border-black transition ${muted ? "bg-white" : "bg-black"}`}><div className={`w-4 h-4 rounded-full border border-black transition ${muted ? "translate-x-0 bg-black" : "translate-x-5 bg-white"}`} /></button>
              </div>

              <div className="rounded-[14px] bg-[#fff6d6] border-[2.5px] border-black p-3.5 text-[11px] font-medium leading-relaxed shadow-[3px_3px_0px_#111]">
                API contract: GET /health, POST /chat {"{message}"} → {"{reply}"}. Token never logged. CORS must allow origin. For Colab tunnels, URL expires — update here.
              </div>
            </div>
          </div>
        </div>
      )}

      {!showMenu && (
        <div className="absolute left-3 bottom-3 md:bottom-5 pointer-events-none hidden md:block z-10">
          <div className="rounded-[16px] bg-white border-[2.5px] border-black shadow-[4px_4px_0px_#111] px-4 py-2.5">
            <div className="text-[9px] font-black tracking-widest opacity-60">OBJECTIVE</div>
            <div className="text-[12px] font-black mt-0.5 flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-black text-white flex items-center justify-center text-[10px]">✦</span>{objective}</div>
          </div>
        </div>
      )}

      {/* Character style hint */}
      {!showMenu && !showDialogue && !loading && (
        <div className="absolute top-[112px] left-3 hidden md:flex items-center gap-2 rounded-full bg-white border-[2px] border-black shadow-[3px_3px_0px_#111] px-3 py-1.5 pointer-events-none">
          <img src={cuteRefUrl} alt="You" className="w-6 h-6 rounded-full border border-black object-contain bg-[#fffdf5]" />
          <span className="text-[10px] font-black">YOU • STAR HANDS • GLOSSY EYES</span>
        </div>
      )}
    </div>
  );
}
