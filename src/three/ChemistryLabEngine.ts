import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AtomNode, BondEdge, REAGENTS } from "../data/chemistryMissions";
import {
  afterDraw,
  createContactShadowTexture,
  createProceduralGridTexture,
  createStudioSetup,
  disposeObjectTree,
  StudioContext,
} from "./webglUtils";

export interface ChemistryVisualState {
  tempK: number;
  pressureAtm: number;
  catalystActive: boolean;
  reagentCounts: Record<string, number>;
  reacting: boolean;
  reactionColor: string;
  effectType: "flame" | "bubbles" | "precipitate" | "crystal" | "neutralize";
  productSpec?: {
    formula: string;
    atoms: AtomNode[];
    bonds: BondEdge[];
  } | null;
}

const _dummy = new THREE.Object3D();
const _pColor = new THREE.Color();
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

interface ParticleState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  scale: number;
}

export class ChemistryLabEngine {
  private ctx: StudioContext;
  private controls: OrbitControls;
  private container: HTMLElement;
  private state: ChemistryVisualState;

  private gridTex: THREE.CanvasTexture;
  private shadowTex: THREE.CanvasTexture;

  private thermalRingMat!: THREE.MeshStandardMaterial;
  private liquidMat!: THREE.MeshPhysicalMaterial;
  private liquidMesh!: THREE.Mesh;
  private stirBar!: THREE.Mesh;
  private catalystMesh!: THREE.Group;
  private moleculeGroup: THREE.Group;

  private particlesMesh!: THREE.InstancedMesh;
  private particleCount = 240;
  private particleData: ParticleState[] = [];

  private rafId = 0;
  private timerId = 0;
  private disposed = false;
  private lastTime = performance.now();
  private elapsed = 0;
  private reactionBurst = 0;

  constructor(container: HTMLElement, initialState: ChemistryVisualState) {
    this.container = container;
    this.state = { ...initialState };

    this.ctx = createStudioSetup(container, 0x07090e, 0.015);
    const { scene, camera, renderer, isSoftwareGl } = this.ctx;

    camera.position.set(4.6, 3.8, 6.0);
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = !isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 1.85, 0);
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.gridTex = createProceduralGridTexture(renderer);
    this.shadowTex = createContactShadowTexture();

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({
        map: this.gridTex,
        roughness: 0.78,
        metalness: 0.15,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    this.moleculeGroup = new THREE.Group();
    scene.add(this.moleculeGroup);

    this.buildReactorApparatus();
    this.buildParticleSystem();
    this.rebuildMolecules();

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    window.addEventListener("resize", this.handleResize);
    renderer.domElement.addEventListener(
      "webglcontextlost",
      this.handleContextLost,
    );
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

  private buildReactorApparatus() {
    const { scene, isSoftwareGl } = this.ctx;
    const stand = new THREE.Group();

    // Contact shadow
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    stand.add(shadow);

    // Anodized hotplate base
    const metalDark = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.3,
    });
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.75, 1.95, 0.34, 40),
      metalDark,
    );
    plinth.position.y = 0.17;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    stand.add(plinth);

    // Thermal ceramic heating ring
    this.thermalRingMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.8,
      roughness: 0.35,
      metalness: 0.4,
    });
    const thermalRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.38, 0.08, 16, 48),
      this.thermalRingMat,
    );
    thermalRing.rotation.x = Math.PI / 2;
    thermalRing.position.y = 0.36;
    stand.add(thermalRing);

    // Ceramic platen
    const platen = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.35, 0.06, 36),
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.45,
        metalness: 0.25,
      }),
    );
    platen.position.y = 0.37;
    stand.add(platen);

    // Liquid solution core
    this.liquidMat = new THREE.MeshPhysicalMaterial({
      color: 0x0ea5e9,
      roughness: 0.12,
      metalness: 0.0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.liquidMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.24, 1.24, 1.55, 36),
      this.liquidMat,
    );
    this.liquidMesh.position.y = 1.22;
    this.liquidMesh.renderOrder = 1;
    stand.add(this.liquidMesh);

    // Magnetic PTFE stir bar
    this.stirBar = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.44, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 }),
    );
    this.stirBar.rotation.z = Math.PI / 2;
    this.stirBar.position.y = 0.52;
    stand.add(this.stirBar);

    // Catalytic platinum/iron mesh disc
    this.catalystMesh = new THREE.Group();
    this.catalystMesh.position.y = 0.72;
    const catRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.76, 0.035, 12, 32),
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        metalness: 0.92,
        roughness: 0.18,
      }),
    );
    catRing.rotation.x = Math.PI / 2;
    const catGrid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 0.02, 24),
      new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.9,
        roughness: 0.25,
        wireframe: true,
      }),
    );
    this.catalystMesh.add(catRing, catGrid);
    this.catalystMesh.visible = this.state.catalystActive;
    stand.add(this.catalystMesh);

    // Outer Borosilicate Glass Vessel (Lathe profile + rim)
    const lathePts = [
      new THREE.Vector2(0.0, 0.4),
      new THREE.Vector2(1.32, 0.4),
      new THREE.Vector2(1.34, 0.52),
      new THREE.Vector2(1.34, 2.75),
      new THREE.Vector2(1.02, 3.25),
      new THREE.Vector2(1.02, 3.65),
      new THREE.Vector2(1.12, 3.72),
    ];
    const vesselGeo = new THREE.LatheGeometry(lathePts, 44);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      metalness: 0.0,
      roughness: 0.05,
      transmission: isSoftwareGl ? 0 : 0.85,
      transparent: true,
      opacity: isSoftwareGl ? 0.24 : 0.36,
      ior: 1.52,
      thickness: 0.4,
      clearcoat: 1.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const vesselMesh = new THREE.Mesh(vesselGeo, glassMat);
    vesselMesh.renderOrder = 3;
    stand.add(vesselMesh);

    // Brushed Steel Neck Collar
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.055, 16, 40),
      new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.9,
        roughness: 0.22,
      }),
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 3.68;
    stand.add(collar);

    scene.add(stand);
  }

  private buildParticleSystem() {
    const geo = new THREE.SphereGeometry(0.055, 10, 10);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.2,
      metalness: 0.2,
      transparent: true,
      opacity: 0.88,
    });
    this.particlesMesh = new THREE.InstancedMesh(geo, mat, this.particleCount);
    this.particlesMesh.frustumCulled = false;
    this.particlesMesh.renderOrder = 2;

    for (let i = 0; i < this.particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.random() * 1.05;
      this.particleData.push({
        x: Math.cos(angle) * rad,
        y: 0.55 + Math.random() * 2.5,
        z: Math.sin(angle) * rad,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.3 + Math.random() * 0.9,
        vz: (Math.random() - 0.5) * 0.4,
        life: Math.random(),
        scale: 0.5 + Math.random() * 0.9,
      });
    }
    this.ctx.scene.add(this.particlesMesh);
  }

  private createMoleculeGroup(atoms: AtomNode[], bonds: BondEdge[]): THREE.Group {
    const g = new THREE.Group();

    atoms.forEach((a) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(a.color),
        roughness: 0.22,
        metalness: 0.12,
        clearcoat: 0.7,
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(a.radius, 22, 22), mat);
      sphere.position.set(a.position[0], a.position[1], a.position[2]);
      g.add(sphere);
    });

    const bondMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.65,
      roughness: 0.28,
    });

    bonds.forEach((b) => {
      const p1 = atoms[b.from].position;
      const p2 = atoms[b.to].position;
      _vecA.set(p1[0], p1[1], p1[2]);
      _vecB.set(p2[0], p2[1], p2[2]);
      const dir = _vecB.clone().sub(_vecA);
      const len = dir.length();
      const mid = _vecA.clone().add(_vecB).multiplyScalar(0.5);

      const offsets =
        b.order === 1 ? [0] : b.order === 2 ? [-0.055, 0.055] : [-0.08, 0, 0.08];

      offsets.forEach((off) => {
        const cyl = new THREE.Mesh(
          new THREE.CylinderGeometry(0.052, 0.052, len, 12),
          bondMat,
        );
        cyl.position.copy(mid);
        cyl.position.z += off;
        cyl.quaternion.setFromUnitVectors(_up, dir.clone().normalize());
        g.add(cyl);
      });
    });

    return g;
  }

  private rebuildMolecules() {
    disposeObjectTree(this.moleculeGroup);
    while (this.moleculeGroup.children.length > 0) {
      this.moleculeGroup.remove(this.moleculeGroup.children[0]);
    }

    if (this.state.productSpec) {
      for (let i = 0; i < 4; i++) {
        const mol = this.createMoleculeGroup(
          this.state.productSpec.atoms,
          this.state.productSpec.bonds,
        );
        const angle = (i / 4) * Math.PI * 2;
        mol.position.set(
          Math.cos(angle) * 0.55,
          1.45 + (i % 2) * 0.55,
          Math.sin(angle) * 0.55,
        );
        mol.scale.setScalar(0.62);
        mol.userData = {
          baseY: mol.position.y,
          phase: i * 1.4,
          orbitAngle: angle,
          orbitRadius: 0.52,
        };
        this.moleculeGroup.add(mol);
      }
      return;
    }

    // Build molecules from active reagent counts
    let idx = 0;
    Object.entries(this.state.reagentCounts).forEach(([id, count]) => {
      const def = REAGENTS[id];
      if (!def || count <= 0) return;
      const copies = Math.min(count, 4);
      for (let c = 0; c < copies; c++) {
        const mol = this.createMoleculeGroup(def.atoms, def.bonds);
        const angle = idx * 1.65;
        const r = 0.25 + (idx % 3) * 0.25;
        mol.position.set(
          Math.cos(angle) * r,
          1.15 + ((idx * 0.37) % 1.4),
          Math.sin(angle) * r,
        );
        mol.scale.setScalar(0.56);
        mol.userData = {
          baseY: mol.position.y,
          phase: idx * 1.1,
          orbitAngle: angle,
          orbitRadius: r,
        };
        this.moleculeGroup.add(mol);
        idx++;
      }
    });
  }

  public updateState(next: Partial<ChemistryVisualState>, triggerBurst = false) {
    const prevCounts = JSON.stringify(this.state.reagentCounts);
    const prevProduct = this.state.productSpec?.formula;
    this.state = { ...this.state, ...next };

    if (this.catalystMesh) {
      this.catalystMesh.visible = this.state.catalystActive;
    }

    if (triggerBurst) {
      this.reactionBurst = 1.0;
    }

    if (
      JSON.stringify(this.state.reagentCounts) !== prevCounts ||
      this.state.productSpec?.formula !== prevProduct
    ) {
      this.rebuildMolecules();
    }
  }

  private tick = () => {
    if (this.disposed) return;

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;

    if (this.reactionBurst > 0) {
      this.reactionBurst = Math.max(0, this.reactionBurst - dt * 0.45);
    }

    // Thermal ring color interpolation (273K cryo cyan -> 900K molten amber)
    const tNorm = THREE.MathUtils.clamp((this.state.tempK - 273) / 600, 0, 1);
    _pColor.setHex(0x06b6d4).lerp(new THREE.Color(0xf97316), tNorm);
    this.thermalRingMat.color.copy(_pColor);
    this.thermalRingMat.emissive.copy(_pColor);
    this.thermalRingMat.emissiveIntensity =
      0.55 + tNorm * 1.4 + this.reactionBurst * 1.8;

    // Liquid color & height
    const targetLiquid = new THREE.Color(this.state.reactionColor || "#0ea5e9");
    this.liquidMat.color.lerp(targetLiquid, 0.08);
    const totalMoles = Object.values(this.state.reagentCounts).reduce(
      (a, b) => a + b,
      0,
    );
    const targetScaleY = THREE.MathUtils.clamp(0.35 + totalMoles * 0.14, 0.3, 1.15);
    this.liquidMesh.scale.y = THREE.MathUtils.lerp(
      this.liquidMesh.scale.y,
      targetScaleY,
      0.1,
    );
    this.liquidMesh.position.y = 0.44 + (1.55 * this.liquidMesh.scale.y) / 2;

    // Spin magnetic stir bar proportional to temperature & reaction burst
    const stirSpeed = 3.5 + tNorm * 9.0 + this.reactionBurst * 14.0;
    this.stirBar.rotation.y += dt * stirSpeed;

    // Animate 3D molecules with thermal Brownian agitation
    const thermalAgitation = 0.5 + tNorm * 2.4 + this.reactionBurst * 2.5;
    for (let i = 0; i < this.moleculeGroup.children.length; i++) {
      const mol = this.moleculeGroup.children[i];
      const { baseY, phase, orbitAngle, orbitRadius } = mol.userData;
      const a = orbitAngle + this.elapsed * 0.65 * thermalAgitation;
      mol.position.x = Math.cos(a) * orbitRadius;
      mol.position.z = Math.sin(a) * orbitRadius;
      mol.position.y =
        baseY + Math.sin(this.elapsed * 2.5 * thermalAgitation + phase) * 0.14;
      mol.rotation.x += dt * 0.8 * thermalAgitation;
      mol.rotation.y += dt * 1.1 * thermalAgitation;
    }

    // Animate 240 kinetic reaction particles
    const speedFactor = 0.6 + tNorm * 2.2 + this.state.pressureAtm * 0.12 + this.reactionBurst * 3.0;
    const isPrecipitate =
      this.state.effectType === "precipitate" ||
      this.state.effectType === "crystal";
    const activeParticleColor =
      this.reactionBurst > 0.1
        ? new THREE.Color(this.state.reactionColor || "#f59e0b")
        : _pColor;

    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particleData[i];
      const dirY = isPrecipitate && this.reactionBurst > 0.05 ? -0.8 : 1.0;
      p.y += p.vy * dirY * speedFactor * dt;
      p.x += Math.sin(this.elapsed * 3 + i) * 0.18 * dt * speedFactor;
      p.z += Math.cos(this.elapsed * 2.7 + i) * 0.18 * dt * speedFactor;

      if (p.y > 3.2) {
        p.y = 0.55;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 1.05;
        p.x = Math.cos(a) * r;
        p.z = Math.sin(a) * r;
      } else if (p.y < 0.48) {
        p.y = 2.6;
      }

      const visibleScale =
        totalMoles > 0 || this.reactionBurst > 0.05
          ? p.scale * (0.7 + this.reactionBurst * 0.9)
          : 0.001;

      _dummy.position.set(p.x, p.y, p.z);
      _dummy.scale.setScalar(visibleScale);
      _dummy.updateMatrix();
      this.particlesMesh.setMatrixAt(i, _dummy.matrix);
      this.particlesMesh.setColorAt(i, activeParticleColor);
    }
    this.particlesMesh.instanceMatrix.needsUpdate = true;
    if (this.particlesMesh.instanceColor) {
      this.particlesMesh.instanceColor.needsUpdate = true;
    }

    this.controls.update();
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);

    if (this.ctx.isSoftwareGl) {
      afterDraw(this.ctx.renderer, this.tick, (id) => {
        this.timerId = id;
      });
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

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
