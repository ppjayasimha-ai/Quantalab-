import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  afterDraw,
  createContactShadowTexture,
  createProceduralGridTexture,
  createStudioSetup,
  disposeObjectTree,
  StudioContext,
} from "./webglUtils";

export type PhysicsExperimentId = "pendulum" | "orbital" | "wave" | "projectile";
export type CameraPresetId = "iso" | "top" | "side" | "reset";

export interface PhysicsParams {
  gravity: number; // m/s^2
  timeScale: number; // 0.25 - 2.5
  paused: boolean;
  // Pendulum
  length1: number;
  length2: number;
  mass1: number;
  mass2: number;
  damping: number;
  // Orbital
  starMass: number;
  probeSpeed: number;
  // Wave
  waveFreq: number;
  waveAmp: number;
  wavePhase: number;
  // Projectile
  launchAngle: number; // deg
  launchVelocity: number; // m/s
  airDrag: number;
  windSpeed: number;
}

export interface PhysicsTelemetry {
  fps: number;
  solverHz: number;
  primaryMetricLabel: string;
  primaryMetricValue: string;
  secondaryMetricLabel: string;
  secondaryMetricValue: string;
  tertiaryMetricLabel: string;
  tertiaryMetricValue: string;
  energyLabel: string;
  energyValue: string;
}

// Pre-allocated scratch math helpers (zero GC inside animation loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _cyan = new THREE.Color(0x06b6d4);
const _amber = new THREE.Color(0xf59e0b);
const _deepBlue = new THREE.Color(0x0f172a);

const SUB_DT = 1 / 720; // 720 Hz RK4 / Verlet fixed-timestep solver

export class PhysicsLabEngine {
  private ctx: StudioContext;
  private controls: OrbitControls;
  private container: HTMLElement;
  private experiment: PhysicsExperimentId = "pendulum";
  private params: PhysicsParams;
  private onTelemetry: (t: PhysicsTelemetry) => void;

  private activeGroup: THREE.Group;
  private floorMesh: THREE.Mesh;
  private gridTex: THREE.CanvasTexture;
  private shadowTex: THREE.CanvasTexture;

  private rafId = 0;
  private timerId = 0;
  private disposed = false;
  private lastTime = performance.now();
  private accumulator = 0;
  private fpsFrames = 0;
  private fpsLastReport = performance.now();
  private measuredFps = 60;

  // Smooth camera transition targets
  private camTransitioning = false;
  private camTargetPos = new THREE.Vector3(7.5, 5.2, 9.2);
  private camTargetLook = new THREE.Vector3(0, 1.5, 0);

  // --- Pendulum state ---
  private pTheta1 = Math.PI * 0.68;
  private pTheta2 = Math.PI * 0.85;
  private pOmega1 = 0.2;
  private pOmega2 = -0.35;
  private pPivotY = 4.6;
  private arm1Group?: THREE.Group;
  private arm2Group?: THREE.Group;
  private bob1Mesh?: THREE.Mesh;
  private bob2Mesh?: THREE.Mesh;
  private rod1Mesh?: THREE.Mesh;
  private rod2Mesh?: THREE.Mesh;
  private pTrailGeo?: THREE.BufferGeometry;
  private pTrailPts = new Float32Array(320 * 3);
  private pTrailCount = 0;

  // --- Orbital state ---
  private planets: Array<{
    group: THREE.Group;
    radius: number;
    angle: number;
    speed: number;
    moon?: THREE.Object3D;
  }> = [];
  private starCore?: THREE.Mesh;
  private gravityWellGeo?: THREE.BufferGeometry;
  private probeMesh?: THREE.Mesh;
  private probePos = new THREE.Vector3(3.6, 0.25, 0);
  private probeVel = new THREE.Vector3(0, 0, 2.35);
  private probeTrailGeo?: THREE.BufferGeometry;
  private probeTrailPts = new Float32Array(360 * 3);
  private probeTrailCount = 0;

  // --- Wave lattice state ---
  private waveInstanced?: THREE.InstancedMesh;
  private waveGridN = 40; // 40x40 = 1600 instances
  private waveTime = 0;

  // --- Projectile state ---
  private projBarrelPivot?: THREE.Group;
  private projBall?: THREE.Mesh;
  private projPos = new THREE.Vector3(-4.5, 0.45, 0);
  private projVel = new THREE.Vector3(6, 7, 0);
  private projActive = true;
  private projFlightTime = 0;
  private projMaxHeight = 0.45;
  private projRange = 0;
  private projTrailGeo?: THREE.BufferGeometry;
  private projTrailPts = new Float32Array(260 * 3);
  private projTrailCount = 0;
  private projPredLine?: THREE.Line;
  private projImpactRing?: THREE.Mesh;
  private windArrow?: THREE.Group;

  constructor(
    container: HTMLElement,
    initialParams: PhysicsParams,
    onTelemetry: (t: PhysicsTelemetry) => void,
  ) {
    this.container = container;
    this.params = { ...initialParams };
    this.onTelemetry = onTelemetry;

    this.ctx = createStudioSetup(container, 0x07090e, 0.014);
    const { scene, camera, renderer, isSoftwareGl } = this.ctx;

    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = !isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 28;
    this.controls.target.set(0, 1.5, 0);

    // Cancel scripted camera transition if user interacts
    this.controls.addEventListener("start", () => {
      this.camTransitioning = false;
    });

    this.gridTex = createProceduralGridTexture(renderer);
    this.shadowTex = createContactShadowTexture();

    // Precision Lab Floor
    const floorGeo = new THREE.PlaneGeometry(60, 60);
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.gridTex,
      roughness: 0.78,
      metalness: 0.18,
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = 0;
    this.floorMesh.receiveShadow = true;
    scene.add(this.floorMesh);

    this.activeGroup = new THREE.Group();
    scene.add(this.activeGroup);

    this.buildExperiment("pendulum");

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    window.addEventListener("resize", this.handleResize);
    renderer.domElement.addEventListener(
      "webglcontextlost",
      this.handleContextLost,
    );

    this.lastTime = performance.now();
    this.tick();
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
  };

  private handleResize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.ctx.camera.aspect = width / height;
    this.ctx.camera.updateProjectionMatrix();
    this.ctx.renderer.setSize(width, height);
  };

  public setParams(next: Partial<PhysicsParams>) {
    const prevAngle = this.params.launchAngle;
    const prevVel = this.params.launchVelocity;
    const prevDrag = this.params.airDrag;
    const prevWind = this.params.windSpeed;
    const prevL1 = this.params.length1;
    const prevL2 = this.params.length2;
    this.params = { ...this.params, ...next };

    if (
      this.experiment === "pendulum" &&
      (next.length1 !== undefined && next.length1 !== prevL1 ||
        next.length2 !== undefined && next.length2 !== prevL2)
    ) {
      this.updatePendulumGeometry();
    }

    if (
      this.experiment === "projectile" &&
      (prevAngle !== this.params.launchAngle ||
        prevVel !== this.params.launchVelocity ||
        prevDrag !== this.params.airDrag ||
        prevWind !== this.params.windSpeed)
    ) {
      this.updateProjectilePrediction();
    }
  }

  public setExperiment(id: PhysicsExperimentId) {
    if (this.experiment === id) return;
    this.experiment = id;
    this.buildExperiment(id);
    this.setCameraPreset("reset");
  }

  public setCameraPreset(preset: CameraPresetId) {
    if (preset === "iso" || preset === "reset") {
      if (this.experiment === "pendulum") {
        this.camTargetPos.set(6.2, 4.4, 8.2);
        this.camTargetLook.set(0, 2.3, 0);
      } else if (this.experiment === "orbital") {
        this.camTargetPos.set(7.5, 6.2, 8.5);
        this.camTargetLook.set(0, 0.2, 0);
      } else if (this.experiment === "wave") {
        this.camTargetPos.set(8.2, 5.8, 8.2);
        this.camTargetLook.set(0, 0.6, 0);
      } else {
        this.camTargetPos.set(0.5, 4.4, 11.5);
        this.camTargetLook.set(0.5, 1.8, 0);
      }
    } else if (preset === "top") {
      this.camTargetPos.set(0.01, 13.5, 0.01);
      this.camTargetLook.set(0, 0.5, 0);
    } else if (preset === "side") {
      this.camTargetPos.set(0, 2.8, 11.8);
      this.camTargetLook.set(0, 1.8, 0);
    }
    this.camTransitioning = true;
  }

  public triggerAction() {
    if (this.experiment === "pendulum") {
      this.pOmega1 += 2.6;
      this.pOmega2 -= 3.8;
    } else if (this.experiment === "orbital") {
      this.launchProbe();
    } else if (this.experiment === "wave") {
      this.waveTime = 0;
    } else if (this.experiment === "projectile") {
      this.fireProjectile();
    }
  }

  public resetExperiment() {
    this.buildExperiment(this.experiment);
  }

  private clearActiveGroup() {
    disposeObjectTree(this.activeGroup);
    while (this.activeGroup.children.length > 0) {
      this.activeGroup.remove(this.activeGroup.children[0]);
    }
    this.planets = [];
  }

  private buildExperiment(id: PhysicsExperimentId) {
    this.clearActiveGroup();

    if (id === "pendulum") {
      this.buildPendulumScene();
    } else if (id === "orbital") {
      this.buildOrbitalScene();
    } else if (id === "wave") {
      this.buildWaveScene();
    } else if (id === "projectile") {
      this.buildProjectileScene();
    }
  }

  // =========================================================================
  // 1. DOUBLE COMPOUND PENDULUM (Composite 7-part machined brass & titanium)
  // =========================================================================
  private buildPendulumScene() {
    this.pTheta1 = Math.PI * 0.68;
    this.pTheta2 = Math.PI * 0.85;
    this.pOmega1 = 0.25;
    this.pOmega2 = -0.35;
    this.pTrailCount = 0;

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.28,
    });
    const brassMat = new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      metalness: 0.92,
      roughness: 0.18,
      anisotropy: 0.7,
    });
    const cyanMat = new THREE.MeshPhysicalMaterial({
      color: 0x06b6d4,
      metalness: 0.55,
      roughness: 0.2,
      clearcoat: 0.8,
    });

    // Contact shadow plane
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 5.5),
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.02;
    this.activeGroup.add(shadowPlane);

    // 1. Heavy machined base plinth (sat flush on Y=0)
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.65, 0.28, 32),
      steelMat,
    );
    base.position.y = 0.14;
    base.castShadow = true;
    base.receiveShadow = true;
    this.activeGroup.add(base);

    // 2. Vertical A-frame gantry mast (offset slightly behind Z=-0.45 so arms swing freely)
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.16, this.pPivotY + 0.1, 20),
      steelMat,
    );
    mast.position.set(0, (this.pPivotY + 0.1) / 2, -0.45);
    mast.castShadow = true;
    this.activeGroup.add(mast);

    // 3. Horizontal bearing cantilever axle
    const axle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.65, 24),
      brassMat,
    );
    axle.rotation.x = Math.PI / 2;
    axle.position.set(0, this.pPivotY, -0.2);
    axle.castShadow = true;
    this.activeGroup.add(axle);

    // 4. Pivot cap jewel
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.08, 24),
      cyanMat,
    );
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, this.pPivotY, 0.14);
    this.activeGroup.add(cap);

    // Arm 1 group
    this.arm1Group = new THREE.Group();
    this.arm1Group.position.set(0, this.pPivotY, 0);
    this.activeGroup.add(this.arm1Group);

    this.rod1Mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1, 16),
      steelMat,
    );
    this.rod1Mesh.castShadow = true;
    this.arm1Group.add(this.rod1Mesh);

    this.bob1Mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 28, 28),
      brassMat,
    );
    this.bob1Mesh.castShadow = true;
    this.arm1Group.add(this.bob1Mesh);

    // Arm 2 group
    this.arm2Group = new THREE.Group();
    this.arm1Group.add(this.arm2Group);

    this.rod2Mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1, 16),
      steelMat,
    );
    this.rod2Mesh.castShadow = true;
    this.arm2Group.add(this.rod2Mesh);

    this.bob2Mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 28, 28),
      cyanMat,
    );
    this.bob2Mesh.castShadow = true;
    this.arm2Group.add(this.bob2Mesh);

    // Phase-space glowing trail
    this.pTrailGeo = new THREE.BufferGeometry();
    this.pTrailGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.pTrailPts, 3),
    );
    this.pTrailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.85,
    });
    const trailLine = new THREE.Line(this.pTrailGeo, trailMat);
    trailLine.frustumCulled = false;
    this.activeGroup.add(trailLine);

    this.updatePendulumGeometry();
    this.syncPendulumMeshes();
  }

  private updatePendulumGeometry() {
    if (!this.rod1Mesh || !this.rod2Mesh || !this.bob1Mesh || !this.bob2Mesh || !this.arm2Group) return;
    const L1 = this.params.length1;
    const L2 = this.params.length2;
    this.rod1Mesh.scale.set(1, L1, 1);
    this.rod1Mesh.position.set(0, -L1 / 2, 0);
    this.bob1Mesh.position.set(0, -L1, 0);
    this.bob1Mesh.scale.setScalar(0.75 + this.params.mass1 * 0.22);

    this.arm2Group.position.set(0, -L1, 0.08);
    this.rod2Mesh.scale.set(1, L2, 1);
    this.rod2Mesh.position.set(0, -L2 / 2, 0);
    this.bob2Mesh.position.set(0, -L2, 0);
    this.bob2Mesh.scale.setScalar(0.75 + this.params.mass2 * 0.22);
  }

  private stepPendulumRK4(dt: number) {
    const g = this.params.gravity;
    const L1 = this.params.length1;
    const L2 = this.params.length2;
    const m1 = this.params.mass1;
    const m2 = this.params.mass2;
    const damp = this.params.damping;

    const deriv = (t1: number, t2: number, w1: number, w2: number) => {
      const delta = t1 - t2;
      const sinD = Math.sin(delta);
      const cosD = Math.cos(delta);
      const den = 2 * m1 + m2 - m2 * Math.cos(2 * delta);

      const dw1 =
        (-g * (2 * m1 + m2) * Math.sin(t1) -
          m2 * g * Math.sin(t1 - 2 * t2) -
          2 * sinD * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cosD)) /
          (L1 * den) -
        damp * w1;

      const dw2 =
        (2 *
          sinD *
          (w1 * w1 * L1 * (m1 + m2) +
            g * (m1 + m2) * Math.cos(t1) +
            w2 * w2 * L2 * m2 * cosD)) /
          (L2 * den) -
        damp * w2;

      return [w1, w2, dw1, dw2];
    };

    const k1 = deriv(this.pTheta1, this.pTheta2, this.pOmega1, this.pOmega2);
    const k2 = deriv(
      this.pTheta1 + 0.5 * dt * k1[0],
      this.pTheta2 + 0.5 * dt * k1[1],
      this.pOmega1 + 0.5 * dt * k1[2],
      this.pOmega2 + 0.5 * dt * k1[3],
    );
    const k3 = deriv(
      this.pTheta1 + 0.5 * dt * k2[0],
      this.pTheta2 + 0.5 * dt * k2[1],
      this.pOmega1 + 0.5 * dt * k2[2],
      this.pOmega2 + 0.5 * dt * k2[3],
    );
    const k4 = deriv(
      this.pTheta1 + dt * k3[0],
      this.pTheta2 + dt * k3[1],
      this.pOmega1 + dt * k3[2],
      this.pOmega2 + dt * k3[3],
    );

    this.pTheta1 += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    this.pTheta2 += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    this.pOmega1 += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    this.pOmega2 += (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
  }

  private syncPendulumMeshes() {
    if (!this.arm1Group || !this.arm2Group || !this.bob2Mesh || !this.pTrailGeo)
      return;
    this.arm1Group.rotation.z = this.pTheta1;
    this.arm2Group.rotation.z = this.pTheta2 - this.pTheta1;

    const L1 = this.params.length1;
    const L2 = this.params.length2;
    const x2 = L1 * Math.sin(this.pTheta1) + L2 * Math.sin(this.pTheta2);
    const y2 =
      this.pPivotY - L1 * Math.cos(this.pTheta1) - L2 * Math.cos(this.pTheta2);

    const maxPts = 320;
    if (this.pTrailCount < maxPts) {
      const idx = this.pTrailCount * 3;
      this.pTrailPts[idx] = x2;
      this.pTrailPts[idx + 1] = y2;
      this.pTrailPts[idx + 2] = 0.08;
      this.pTrailCount++;
    } else {
      this.pTrailPts.copyWithin(0, 3);
      const idx = (maxPts - 1) * 3;
      this.pTrailPts[idx] = x2;
      this.pTrailPts[idx + 1] = y2;
      this.pTrailPts[idx + 2] = 0.08;
    }
    this.pTrailGeo.attributes.position.needsUpdate = true;
    this.pTrailGeo.setDrawRange(0, this.pTrailCount);
  }

  // =========================================================================
  // 2. ORBITAL MECHANICS & GRAVITATIONAL WELL
  // =========================================================================
  private buildOrbitalScene() {
    // Central Star (composite core + corona halo + point light)
    const starGroup = new THREE.Group();
    starGroup.position.set(0, 1.4, 0);
    this.activeGroup.add(starGroup);

    const starMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.2,
      roughness: 0.25,
    });
    this.starCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 32, 32),
      starMat,
    );
    starGroup.add(this.starCore);

    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(0.88, 28, 28),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );
    starGroup.add(corona);

    // Dynamic gravitational potential well wireframe
    const wellGeo = new THREE.PlaneGeometry(14, 14, 48, 48);
    wellGeo.rotateX(-Math.PI / 2);
    this.gravityWellGeo = wellGeo;
    this.deformGravityWell();
    const wellMesh = new THREE.Mesh(
      wellGeo,
      new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        wireframe: true,
        transparent: true,
        opacity: 0.24,
      }),
    );
    wellMesh.position.y = 0.55;
    this.activeGroup.add(wellMesh);

    // 3 Composite Planets
    const planetSpecs = [
      { r: 2.3, size: 0.22, color: 0x38bdf8, speed: 1.45, hasRing: false, hasMoon: false },
      { r: 3.8, size: 0.34, color: 0x10b981, speed: 0.85, hasRing: false, hasMoon: true },
      { r: 5.5, size: 0.42, color: 0xa855f7, speed: 0.48, hasRing: true, hasMoon: false },
    ];

    planetSpecs.forEach((spec, idx) => {
      const pGroup = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(spec.size, 24, 24),
        new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: 0.42,
          metalness: 0.2,
        }),
      );
      body.castShadow = true;
      pGroup.add(body);

      if (spec.hasRing) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(spec.size * 1.4, spec.size * 2.1, 36),
          new THREE.MeshStandardMaterial({
            color: 0xc084fc,
            side: THREE.DoubleSide,
            roughness: 0.6,
            transparent: true,
            opacity: 0.72,
          }),
        );
        ring.rotation.x = Math.PI * 0.38;
        pGroup.add(ring);
      }

      let moon: THREE.Object3D | undefined;
      if (spec.hasMoon) {
        moon = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 16, 16),
          new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 }),
        );
        moon.position.set(0.68, 0.08, 0);
        pGroup.add(moon);
      }

      // Orbit track ring
      const orbitRing = new THREE.Mesh(
        new THREE.RingGeometry(spec.r - 0.018, spec.r + 0.018, 72),
        new THREE.MeshBasicMaterial({
          color: 0x334155,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.45,
        }),
      );
      orbitRing.rotation.x = -Math.PI / 2;
      orbitRing.position.y = 1.4;
      this.activeGroup.add(orbitRing);

      this.activeGroup.add(pGroup);
      this.planets.push({
        group: pGroup,
        radius: spec.r,
        angle: idx * 2.1,
        speed: spec.speed,
        moon,
      });
    });

    // Launchable Probe (3-part composite spacecraft)
    const probeGroup = new THREE.Group();
    const probeBus = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        metalness: 0.8,
        roughness: 0.2,
      }),
    );
    const solarL = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.02, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        metalness: 0.7,
        roughness: 0.25,
      }),
    );
    solarL.position.x = -0.22;
    const solarR = solarL.clone();
    solarR.position.x = 0.22;
    probeGroup.add(probeBus, solarL, solarR);
    this.probeMesh = probeGroup as unknown as THREE.Mesh;
    this.activeGroup.add(probeGroup);

    this.probeTrailGeo = new THREE.BufferGeometry();
    this.probeTrailGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.probeTrailPts, 3),
    );
    this.probeTrailGeo.setDrawRange(0, 0);
    const probeTrail = new THREE.Line(
      this.probeTrailGeo,
      new THREE.LineBasicMaterial({ color: 0x06b6d4 }),
    );
    probeTrail.frustumCulled = false;
    this.activeGroup.add(probeTrail);

    this.launchProbe();
  }

  private deformGravityWell() {
    if (!this.gravityWellGeo) return;
    const pos = this.gravityWellGeo.attributes.position;
    const M = this.params.starMass;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.sqrt(x * x + z * z);
      const depth = -1.8 * M / Math.sqrt(r * r + 0.85);
      pos.setY(i, Math.max(-2.2, depth + 0.85));
    }
    pos.needsUpdate = true;
    this.gravityWellGeo.computeVertexNormals();
  }

  private launchProbe() {
    this.probePos.set(3.1, 1.4, 0);
    this.probeVel.set(0, 0, this.params.probeSpeed);
    this.probeTrailCount = 0;
  }

  private stepOrbital(dt: number) {
    const mu = 14.0 * this.params.starMass;
    // Update planets
    const starScale = Math.sqrt(this.params.starMass);
    for (let i = 0; i < this.planets.length; i++) {
      const p = this.planets[i];
      p.angle += p.speed * starScale * dt;
      p.group.position.set(
        Math.cos(p.angle) * p.radius,
        1.4,
        Math.sin(p.angle) * p.radius,
      );
      p.group.rotation.y += dt * 0.9;
      if (p.moon) {
        p.moon.position.set(
          Math.cos(p.angle * 4.5) * 0.65,
          0.08,
          Math.sin(p.angle * 4.5) * 0.65,
        );
      }
    }

    // Symplectic Euler integration for probe
    const dx = -this.probePos.x;
    const dz = -this.probePos.z;
    const r2 = dx * dx + dz * dz;
    const r = Math.sqrt(r2);
    if (r > 0.72 && r < 16) {
      const accel = mu / (r2 * r);
      this.probeVel.x += dx * accel * dt;
      this.probeVel.z += dz * accel * dt;
      this.probePos.x += this.probeVel.x * dt;
      this.probePos.z += this.probeVel.z * dt;
    } else if (r <= 0.72 || r >= 16) {
      this.launchProbe();
    }
  }

  private syncOrbitalMeshes() {
    if (this.starCore) {
      const s = 0.85 + 0.18 * this.params.starMass;
      this.starCore.scale.setScalar(s);
      this.starCore.rotation.y += 0.008;
    }
    this.deformGravityWell();
    if (this.probeMesh && this.probeTrailGeo) {
      this.probeMesh.position.copy(this.probePos);
      this.probeMesh.rotation.y += 0.03;

      const maxPts = 360;
      if (this.probeTrailCount < maxPts) {
        const idx = this.probeTrailCount * 3;
        this.probeTrailPts[idx] = this.probePos.x;
        this.probeTrailPts[idx + 1] = this.probePos.y;
        this.probeTrailPts[idx + 2] = this.probePos.z;
        this.probeTrailCount++;
      } else {
        this.probeTrailPts.copyWithin(0, 3);
        const idx = (maxPts - 1) * 3;
        this.probeTrailPts[idx] = this.probePos.x;
        this.probeTrailPts[idx + 1] = this.probePos.y;
        this.probeTrailPts[idx + 2] = this.probePos.z;
      }
      this.probeTrailGeo.attributes.position.needsUpdate = true;
      this.probeTrailGeo.setDrawRange(0, this.probeTrailCount);
    }
  }

  // =========================================================================
  // 3. COUPLED HARMONIC WAVE INTERFERENCE LATTICE (1,600 InstancedMesh nodes)
  // =========================================================================
  private buildWaveScene() {
    this.waveTime = 0;
    const N = this.waveGridN;
    const total = N * N;

    const nodeGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const nodeMat = new THREE.MeshStandardMaterial({
      roughness: 0.25,
      metalness: 0.55,
    });
    this.waveInstanced = new THREE.InstancedMesh(nodeGeo, nodeMat, total);
    this.waveInstanced.frustumCulled = false;

    const spacing = 0.22;
    const offset = ((N - 1) * spacing) / 2;
    let idx = 0;
    for (let ix = 0; ix < N; ix++) {
      for (let iz = 0; iz < N; iz++) {
        _dummy.position.set(ix * spacing - offset, 1.4, iz * spacing - offset);
        _dummy.updateMatrix();
        this.waveInstanced.setMatrixAt(idx, _dummy.matrix);
        this.waveInstanced.setColorAt(idx, _cyan);
        idx++;
      }
    }
    this.waveInstanced.instanceMatrix.needsUpdate = true;
    if (this.waveInstanced.instanceColor) {
      this.waveInstanced.instanceColor.needsUpdate = true;
    }
    this.activeGroup.add(this.waveInstanced);

    // Dual coherent emitter towers
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.25,
    });
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.4,
    });
    [-2.0, 2.0].forEach((xPos) => {
      const tower = new THREE.Group();
      tower.position.set(xPos, 0, 0);
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, 2.35, 16),
        towerMat,
      );
      col.position.y = 1.175;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), tipMat);
      tip.position.y = 2.4;
      tower.add(col, tip);
      this.activeGroup.add(tower);
    });
  }

  private syncWaveLattice() {
    if (!this.waveInstanced) return;
    const N = this.waveGridN;
    const spacing = 0.22;
    const offset = ((N - 1) * spacing) / 2;
    const k = this.params.waveFreq * 1.45;
    const omega = this.params.waveFreq * 4.2;
    const amp = this.params.waveAmp;
    const phase = this.params.wavePhase;

    let idx = 0;
    for (let ix = 0; ix < N; ix++) {
      const x = ix * spacing - offset;
      for (let iz = 0; iz < N; iz++) {
        const z = iz * spacing - offset;
        const r1 = Math.sqrt((x + 2.0) * (x + 2.0) + z * z) + 0.15;
        const r2 = Math.sqrt((x - 2.0) * (x - 2.0) + z * z) + 0.15;
        const y1 = Math.sin(k * r1 - omega * this.waveTime) / Math.sqrt(r1 + 0.5);
        const y2 =
          Math.sin(k * r2 - omega * this.waveTime + phase) / Math.sqrt(r2 + 0.5);
        const h = (y1 + y2) * amp;

        _dummy.position.set(x, 1.4 + h, z);
        _dummy.scale.set(1, 1 + Math.abs(h) * 1.8, 1);
        _dummy.updateMatrix();
        this.waveInstanced.setMatrixAt(idx, _dummy.matrix);

        const norm = THREE.MathUtils.clamp((h + amp) / (2 * amp + 0.001), 0, 1);
        if (norm > 0.5) {
          _color.copy(_cyan).lerp(_amber, (norm - 0.5) * 2);
        } else {
          _color.copy(_deepBlue).lerp(_cyan, norm * 2);
        }
        this.waveInstanced.setColorAt(idx, _color);
        idx++;
      }
    }
    this.waveInstanced.instanceMatrix.needsUpdate = true;
    if (this.waveInstanced.instanceColor) {
      this.waveInstanced.instanceColor.needsUpdate = true;
    }
  }

  // =========================================================================
  // 4. BALLISTIC PROJECTILE & AERODYNAMIC DRAG TUNNEL
  // =========================================================================
  private buildProjectileScene() {
    const gunMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.25,
    });
    const brassMat = new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      metalness: 0.9,
      roughness: 0.2,
    });

    // Launcher Gantry (composite 4-part)
    const gantry = new THREE.Group();
    gantry.position.set(-5.0, 0, 0);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.24, 0.9),
      gunMat,
    );
    base.position.y = 0.12;
    base.castShadow = true;
    const yoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.45, 20),
      gunMat,
    );
    yoke.position.y = 0.44;
    gantry.add(base, yoke);

    this.projBarrelPivot = new THREE.Group();
    this.projBarrelPivot.position.set(0, 0.62, 0);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.13, 1.15, 20),
      brassMat,
    );
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.x = 0.5;
    barrel.castShadow = true;
    this.projBarrelPivot.add(barrel);
    gantry.add(this.projBarrelPivot);
    this.activeGroup.add(gantry);

    // Flying Projectile
    this.projBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 24, 24),
      new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x0284c7,
        emissiveIntensity: 0.7,
        metalness: 0.5,
        roughness: 0.2,
      }),
    );
    this.projBall.castShadow = true;
    this.activeGroup.add(this.projBall);

    // Impact target ring
    this.projImpactRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.36, 32),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide,
      }),
    );
    this.projImpactRing.rotation.x = -Math.PI / 2;
    this.projImpactRing.position.y = 0.025;
    this.projImpactRing.visible = false;
    this.activeGroup.add(this.projImpactRing);

    // Wind vector indicator
    this.windArrow = new THREE.Group();
    this.windArrow.position.set(0, 4.8, -1.5);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1.2, 12),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    );
    shaft.rotation.z = Math.PI / 2;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.28, 12),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    );
    head.rotation.z = -Math.PI / 2;
    head.position.x = 0.7;
    this.windArrow.add(shaft, head);
    this.activeGroup.add(this.windArrow);

    // Trail
    this.projTrailGeo = new THREE.BufferGeometry();
    this.projTrailGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.projTrailPts, 3),
    );
    this.projTrailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(
      this.projTrailGeo,
      new THREE.LineBasicMaterial({ color: 0x06b6d4 }),
    );
    trail.frustumCulled = false;
    this.activeGroup.add(trail);

    // Predictive dotted curve
    const predGeo = new THREE.BufferGeometry();
    this.projPredLine = new THREE.Line(
      predGeo,
      new THREE.LineDashedMaterial({
        color: 0x64748b,
        dashSize: 0.25,
        gapSize: 0.15,
      }),
    );
    this.activeGroup.add(this.projPredLine);

    this.updateProjectilePrediction();
    this.fireProjectile();
  }

  private updateProjectilePrediction() {
    const rad = THREE.MathUtils.degToRad(this.params.launchAngle);
    if (this.projBarrelPivot) {
      this.projBarrelPivot.rotation.z = rad;
    }
    if (this.windArrow) {
      const ws = this.params.windSpeed;
      this.windArrow.visible = Math.abs(ws) > 0.1;
      this.windArrow.scale.x = ws >= 0 ? 1 : -1;
    }
    if (!this.projPredLine) return;

    const pts: THREE.Vector3[] = [];
    let x = -5.0 + Math.cos(rad) * 1.05;
    let y = 0.62 + Math.sin(rad) * 1.05;
    let vx = Math.cos(rad) * this.params.launchVelocity;
    let vy = Math.sin(rad) * this.params.launchVelocity;
    const g = this.params.gravity;
    const k = this.params.airDrag;
    const wind = this.params.windSpeed;
    const dt = 0.02;

    for (let i = 0; i < 240 && y >= 0.16; i++) {
      pts.push(new THREE.Vector3(x, y, 0));
      const relVx = vx - wind;
      const speed = Math.sqrt(relVx * relVx + vy * vy);
      vx += -k * speed * relVx * dt;
      vy += (-g - k * speed * vy) * dt;
      x += vx * dt;
      y += vy * dt;
    }
    this.projPredLine.geometry.dispose();
    this.projPredLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.projPredLine.computeLineDistances();
  }

  private fireProjectile() {
    const rad = THREE.MathUtils.degToRad(this.params.launchAngle);
    if (this.projBarrelPivot) {
      this.projBarrelPivot.rotation.z = rad;
    }
    this.projPos.set(
      -5.0 + Math.cos(rad) * 1.05,
      0.62 + Math.sin(rad) * 1.05,
      0,
    );
    this.projVel.set(
      Math.cos(rad) * this.params.launchVelocity,
      Math.sin(rad) * this.params.launchVelocity,
      0,
    );
    this.projActive = true;
    this.projFlightTime = 0;
    this.projMaxHeight = this.projPos.y;
    this.projRange = 0;
    this.projTrailCount = 0;
    if (this.projImpactRing) this.projImpactRing.visible = false;
  }

  private stepProjectile(dt: number) {
    if (!this.projActive) return;
    const g = this.params.gravity;
    const k = this.params.airDrag;
    const wind = this.params.windSpeed;

    const relVx = this.projVel.x - wind;
    const speed = Math.sqrt(relVx * relVx + this.projVel.y * this.projVel.y);
    this.projVel.x += -k * speed * relVx * dt;
    this.projVel.y += (-g - k * speed * this.projVel.y) * dt;

    this.projPos.x += this.projVel.x * dt;
    this.projPos.y += this.projVel.y * dt;
    this.projFlightTime += dt;
    if (this.projPos.y > this.projMaxHeight) {
      this.projMaxHeight = this.projPos.y;
    }
    this.projRange = this.projPos.x + 5.0;

    if (this.projPos.y <= 0.16) {
      this.projPos.y = 0.16;
      this.projActive = false;
      if (this.projImpactRing) {
        this.projImpactRing.position.set(this.projPos.x, 0.025, 0);
        this.projImpactRing.visible = true;
      }
    }
  }

  private syncProjectileMeshes() {
    if (!this.projBall || !this.projTrailGeo) return;
    this.projBall.position.copy(this.projPos);

    if (this.projActive) {
      const maxPts = 260;
      if (this.projTrailCount < maxPts) {
        const idx = this.projTrailCount * 3;
        this.projTrailPts[idx] = this.projPos.x;
        this.projTrailPts[idx + 1] = this.projPos.y;
        this.projTrailPts[idx + 2] = 0;
        this.projTrailCount++;
      }
      this.projTrailGeo.attributes.position.needsUpdate = true;
      this.projTrailGeo.setDrawRange(0, this.projTrailCount);
    }
  }

  // =========================================================================
  // MAIN HIGH-FPS LOOP (720 Hz fixed-timestep sub-stepping)
  // =========================================================================
  private tick = () => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = Math.min(0.05, Math.max(0.0001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    // Smooth camera preset damping
    if (this.camTransitioning) {
      const { camera } = this.ctx;
      camera.position.x = THREE.MathUtils.damp(
        camera.position.x,
        this.camTargetPos.x,
        6.5,
        rawDt,
      );
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y,
        this.camTargetPos.y,
        6.5,
        rawDt,
      );
      camera.position.z = THREE.MathUtils.damp(
        camera.position.z,
        this.camTargetPos.z,
        6.5,
        rawDt,
      );
      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        this.camTargetLook.x,
        6.5,
        rawDt,
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        this.camTargetLook.y,
        6.5,
        rawDt,
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        this.camTargetLook.z,
        6.5,
        rawDt,
      );

      if (
        camera.position.distanceToSquared(this.camTargetPos) < 0.001 &&
        this.controls.target.distanceToSquared(this.camTargetLook) < 0.001
      ) {
        this.camTransitioning = false;
      }
    }

    this.controls.update();

    // 720 Hz sub-stepped solver
    if (!this.params.paused) {
      const scaledDt = rawDt * this.params.timeScale;
      this.accumulator += scaledDt;
      const maxSubSteps = 24;
      let steps = 0;
      while (this.accumulator >= SUB_DT && steps < maxSubSteps) {
        if (this.experiment === "pendulum") {
          this.stepPendulumRK4(SUB_DT);
        } else if (this.experiment === "orbital") {
          this.stepOrbital(SUB_DT);
        } else if (this.experiment === "wave") {
          this.waveTime += SUB_DT;
        } else if (this.experiment === "projectile") {
          this.stepProjectile(SUB_DT);
        }
        this.accumulator -= SUB_DT;
        steps++;
      }
      if (steps >= maxSubSteps) {
        this.accumulator = 0;
      }
    }

    // Sync scene graph
    if (this.experiment === "pendulum") this.syncPendulumMeshes();
    else if (this.experiment === "orbital") this.syncOrbitalMeshes();
    else if (this.experiment === "wave") this.syncWaveLattice();
    else if (this.experiment === "projectile") this.syncProjectileMeshes();

    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);

    // FPS & Telemetry reporting (~10 Hz to avoid React re-render overhead)
    this.fpsFrames++;
    const elapsedFps = now - this.fpsLastReport;
    if (elapsedFps >= 120) {
      this.measuredFps = Math.round((this.fpsFrames * 1000) / elapsedFps);
      this.fpsFrames = 0;
      this.fpsLastReport = now;
      this.emitTelemetry();
    }

    if (this.ctx.isSoftwareGl) {
      afterDraw(this.ctx.renderer, this.tick, (id) => {
        this.timerId = id;
      });
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private emitTelemetry() {
    if (this.experiment === "pendulum") {
      const g = this.params.gravity;
      const L1 = this.params.length1;
      const L2 = this.params.length2;
      const m1 = this.params.mass1;
      const m2 = this.params.mass2;
      const y1 = -L1 * Math.cos(this.pTheta1);
      const y2 = y1 - L2 * Math.cos(this.pTheta2);
      const v1sq = (L1 * this.pOmega1) ** 2;
      const v2sq =
        v1sq +
        (L2 * this.pOmega2) ** 2 +
        2 *
          L1 *
          L2 *
          this.pOmega1 *
          this.pOmega2 *
          Math.cos(this.pTheta1 - this.pTheta2);
      const ke = 0.5 * m1 * v1sq + 0.5 * m2 * v2sq;
      const pe = m1 * g * (y1 + L1 + L2) + m2 * g * (y2 + L1 + L2);
      const deg1 = (((this.pTheta1 * 180) / Math.PI) % 360).toFixed(1);
      const deg2 = (((this.pTheta2 * 180) / Math.PI) % 360).toFixed(1);

      this.onTelemetry({
        fps: this.measuredFps,
        solverHz: 720,
        primaryMetricLabel: "Upper Angle θ₁",
        primaryMetricValue: `${deg1}°`,
        secondaryMetricLabel: "Lower Angle θ₂",
        secondaryMetricValue: `${deg2}°`,
        tertiaryMetricLabel: "Kinetic Energy",
        tertiaryMetricValue: `${ke.toFixed(2)} J`,
        energyLabel: "Total Mechanical E",
        energyValue: `${(ke + pe).toFixed(2)} J`,
      });
    } else if (this.experiment === "orbital") {
      const r = Math.sqrt(this.probePos.x ** 2 + this.probePos.z ** 2);
      const v = Math.sqrt(this.probeVel.x ** 2 + this.probeVel.z ** 2);
      const mu = 14.0 * this.params.starMass;
      const vEsc = Math.sqrt((2 * mu) / Math.max(0.5, r));
      const specEnergy = 0.5 * v * v - mu / Math.max(0.5, r);

      this.onTelemetry({
        fps: this.measuredFps,
        solverHz: 720,
        primaryMetricLabel: "Orbital Radius r",
        primaryMetricValue: `${r.toFixed(2)} AU`,
        secondaryMetricLabel: "Probe Speed v",
        secondaryMetricValue: `${v.toFixed(2)} km/s`,
        tertiaryMetricLabel: "Escape Velocity vₑ",
        tertiaryMetricValue: `${vEsc.toFixed(2)} km/s`,
        energyLabel: "Specific Energy ε",
        energyValue: `${specEnergy.toFixed(2)} MJ/kg`,
      });
    } else if (this.experiment === "wave") {
      const wavelength = (2 * Math.PI) / (this.params.waveFreq * 1.45);
      const phaseDeg = Math.round((this.params.wavePhase * 180) / Math.PI);
      this.onTelemetry({
        fps: this.measuredFps,
        solverHz: 720,
        primaryMetricLabel: "Wavelength λ",
        primaryMetricValue: `${wavelength.toFixed(2)} m`,
        secondaryMetricLabel: "Phase Offset Δφ",
        secondaryMetricValue: `${phaseDeg}°`,
        tertiaryMetricLabel: "Active Lattice Nodes",
        tertiaryMetricValue: `${this.waveGridN * this.waveGridN}`,
        energyLabel: "Peak Amplitude A",
        energyValue: `${this.params.waveAmp.toFixed(2)} m`,
      });
    } else {
      const speed = Math.sqrt(this.projVel.x ** 2 + this.projVel.y ** 2);
      this.onTelemetry({
        fps: this.measuredFps,
        solverHz: 720,
        primaryMetricLabel: "Horizontal Range",
        primaryMetricValue: `${this.projRange.toFixed(2)} m`,
        secondaryMetricLabel: "Peak Apex Height",
        secondaryMetricValue: `${this.projMaxHeight.toFixed(2)} m`,
        tertiaryMetricLabel: "Flight Time",
        tertiaryMetricValue: `${this.projFlightTime.toFixed(2)} s`,
        energyLabel: "Instantaneous Speed",
        energyValue: `${speed.toFixed(2)} m/s`,
      });
    }
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.timerId);
    window.removeEventListener("resize", this.handleResize);
    this.ctx.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.handleContextLost,
    );
    this.controls.dispose();
    disposeObjectTree(this.ctx.scene);
    this.gridTex.dispose();
    this.shadowTex.dispose();
    this.ctx.pmremTexture.dispose();
    this.ctx.renderer.dispose();
  }
}
