import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as math from "mathjs";
import {
  afterDraw,
  createStudioSetup,
  disposeObjectTree,
  StudioContext,
} from "./webglUtils";

export class FunctionPlotterEngine {
  private ctx: StudioContext;
  private controls: OrbitControls;
  private container: HTMLElement;

  private surfaceMesh?: THREE.Mesh;
  private wireMesh?: THREE.LineSegments;
  private surfaceGeo: THREE.BufferGeometry;

  private rafId = 0;
  private timerId = 0;
  private disposed = false;
  private autoRotate = true;
  private currentExpr = "sin(sqrt(x^2 + y^2) * 1.8) * 1.4";
  private phase = 0;
  private animateWave = true;

  private readonly segs = 68;
  private readonly domain = 5.0;

  constructor(container: HTMLElement, initialExpr: string) {
    this.container = container;
    this.currentExpr = initialExpr;

    this.ctx = createStudioSetup(container, 0x07090e, 0.012);
    const { scene, camera, renderer, isSoftwareGl } = this.ctx;

    camera.position.set(7.2, 5.8, 7.6);
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = !isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 0.2, 0);

    // Coordinate Axes + Base Grid
    const grid = new THREE.GridHelper(10, 20, 0x0e7490, 0x1e293b);
    grid.position.y = -2.2;
    scene.add(grid);

    const axes = new THREE.AxesHelper(5.5);
    scene.add(axes);

    this.surfaceGeo = new THREE.PlaneGeometry(
      this.domain * 2,
      this.domain * 2,
      this.segs,
      this.segs,
    );
    this.surfaceGeo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.25,
      side: THREE.DoubleSide,
    });
    this.surfaceMesh = new THREE.Mesh(this.surfaceGeo, mat);
    scene.add(this.surfaceMesh);

    const wireMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.16,
    });
    this.wireMesh = new THREE.LineSegments(
      new THREE.WireframeGeometry(this.surfaceGeo),
      wireMat,
    );
    scene.add(this.wireMesh);

    this.evaluateExpression(this.currentExpr);

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

  public setAutoRotate(enabled: boolean) {
    this.autoRotate = enabled;
  }

  public setAnimateWave(enabled: boolean) {
    this.animateWave = enabled;
    if (!enabled) {
      this.evaluateExpression(this.currentExpr);
    }
  }

  public evaluateExpression(expr: string): { ok: boolean; error?: string } {
    try {
      const compiled = math.compile(expr);
      // Test evaluate at origin
      compiled.evaluate({ x: 0, y: 0, t: this.phase });
      this.currentExpr = expr;
      this.updateSurfaceVertices(compiled);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid math expression",
      };
    }
  }

  private updateSurfaceVertices(compiled: math.EvalFunction) {
    const pos = this.surfaceGeo.attributes.position;
    const count = pos.count;

    let colors = this.surfaceGeo.attributes.color as THREE.BufferAttribute;
    if (!colors) {
      colors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
      this.surfaceGeo.setAttribute("color", colors);
    }

    let minZ = Infinity;
    let maxZ = -Infinity;
    const zVals = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getZ(i); // map plane Z to math Y
      let z = 0;
      try {
        const res = compiled.evaluate({ x, y, t: this.phase });
        z = typeof res === "number" && Number.isFinite(res) ? res : 0;
      } catch {
        z = 0;
      }
      z = THREE.MathUtils.clamp(z, -4.0, 4.0);
      zVals[i] = z;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      pos.setY(i, z);
    }

    const span = Math.max(0.001, maxZ - minZ);
    const low = new THREE.Color(0x1e3a8a);
    const mid = new THREE.Color(0x06b6d4);
    const high = new THREE.Color(0xf59e0b);
    const tmp = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const norm = (zVals[i] - minZ) / span;
      if (norm < 0.5) {
        tmp.copy(low).lerp(mid, norm * 2);
      } else {
        tmp.copy(mid).lerp(high, (norm - 0.5) * 2);
      }
      colors.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }

    pos.needsUpdate = true;
    colors.needsUpdate = true;
    this.surfaceGeo.computeVertexNormals();

    if (this.wireMesh) {
      this.wireMesh.geometry.dispose();
      this.wireMesh.geometry = new THREE.WireframeGeometry(this.surfaceGeo);
    }
  }

  private tick = () => {
    if (this.disposed) return;

    if (this.animateWave && this.currentExpr.includes("t")) {
      this.phase += 0.035;
      try {
        const compiled = math.compile(this.currentExpr);
        this.updateSurfaceVertices(compiled);
      } catch {
        // ignore transient error
      }
    }

    if (this.autoRotate && this.surfaceMesh && this.wireMesh) {
      this.surfaceMesh.rotation.y += 0.003;
      this.wireMesh.rotation.y += 0.003;
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
    this.ctx.pmremTexture.dispose();
    this.ctx.renderer.dispose();
  }
}
