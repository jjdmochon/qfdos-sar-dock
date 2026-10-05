// Visor 3D (3Dmol.js, BSD): receptor, residuos del centro activo, ligando del cristal y poses.
import { TIPOS } from "./interacciones.js";

let cargado = null;
function cargar3Dmol() {
  if (!cargado) {
    cargado = new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = new URL("../vendor/3dmol/3Dmol-min.js", import.meta.url).href;
      s.onload = () => ok(globalThis.$3Dmol);
      s.onerror = () => mal(new Error("No se pudo cargar 3Dmol.js"));
      document.head.appendChild(s);
    });
  }
  return cargado;
}

export const COLOR_CRISTAL = "#10b981";
export const COLOR_POSE = "#f59e0b";
export const COLOR_SERIE = "#8b5cf6";
const ESQUEMA = { [COLOR_CRISTAL]: "greenCarbon", [COLOR_POSE]: "orangeCarbon", [COLOR_SERIE]: "purpleCarbon" };

// 3Dmol trata cualquier línea que empieza por «END» (ENDROOT, ENDBRANCH) como fin del modelo:
// al visor solo le pasamos los átomos y él deduce los enlaces por distancia.
const soloAtomos = (pdbqt) =>
  pdbqt.split("\n").filter((l) => l.startsWith("ATOM") || l.startsWith("HETATM")).join("\n");

export class Visor {
  constructor(el) {
    this.el = el;
    this.modelos = {};
    this.formas = [];
    this.opciones = { cristal: true, superficie: false, etiquetas: true, interacciones: true };
  }

  async iniciar() {
    const $3Dmol = await cargar3Dmol();
    this.v = $3Dmol.createViewer(this.el, { backgroundColor: "white", antialias: true });
    return this;
  }

  /** ficha: ficha.json; receptorPdb: texto PDB; cristalPdbqt: ligando del cristal */
  cargarDiana(ficha, receptorPdb, cristalPdbqt) {
    const v = this.v;
    v.removeAllModels();
    v.removeAllShapes();
    v.removeAllLabels();
    v.removeAllSurfaces();
    this.ficha = ficha;
    this.modelos = {};
    this.modelos.rec = v.addModel(receptorPdb, "pdb");
    this.bolsillo = ficha.centro_activo.map((r) => ({ chain: r.cadena, resi: r.num }));
    this.modelos.cristal = v.addModel(soloAtomos(cristalPdbqt), "pdbqt");
    this.estilos();
    v.zoomTo({ model: this.modelos.cristal });
    v.zoom(0.9);
    v.render();
  }

  estilos() {
    const v = this.v;
    const rec = this.modelos.rec;
    rec.setStyle({}, { cartoon: { color: "#c7d2fe", opacity: 0.55, thickness: 0.3 } });
    const sel = { or: this.bolsillo.map((b) => ({ chain: b.chain, resi: b.resi })) };
    rec.setStyle({ and: [sel, { not: { elem: "H" } }] }, {
      cartoon: { color: "#c7d2fe", opacity: 0.55 },
      stick: { radius: 0.12, colorscheme: "grayCarbon" },
    });
    // Hidrógenos polares del bolsillo (útiles para ver donadores)
    rec.setStyle({ and: [sel, { elem: "H" }, { atom: ["H", "HE1", "HH", "HG", "HG1", "HD1", "HE2", "HZ1", "HZ2", "HZ3", "HH11", "HH12", "HH21", "HH22", "HE", "HD21", "HD22", "HE21", "HE22"] }] },
      { stick: { radius: 0.08, color: "#e2e8f0" } });
    rec.setStyle({ resn: ["ZN", "MG", "CA", "FE"] }, { sphere: { radius: 0.7, color: "#8b5cf6" } });
    this.estiloLigando(this.modelos.cristal, COLOR_CRISTAL, this.opciones.cristal);
    for (const k of Object.keys(this.modelos)) {
      if (k.startsWith("pose:")) this.estiloLigando(this.modelos[k], this.modelos[k].__color, true);
    }
    v.removeAllLabels();
    if (this.opciones.etiquetas) {
      // Los 12 residuos más cercanos al ligando del cristal (con más, las etiquetas se tapan)
      for (const r of this.ficha.centro_activo.slice(0, 12)) {
        const at = rec.selectedAtoms({ chain: r.cadena, resi: r.num, atom: ["CB", "CA", r.res] })[0];
        if (!at) continue;
        v.addLabel(`${r.res}${r.num}`, {
          position: { x: at.x, y: at.y, z: at.z }, font: "Montserrat", fontSize: 11, fontColor: "#1e3a8a",
          backgroundColor: "white", backgroundOpacity: 0.8, showBackground: true, inFront: true, borderThickness: 0,
        });
      }
    }
    v.removeAllSurfaces();
    if (this.opciones.superficie) {
      v.addSurface(globalThis.$3Dmol.SurfaceType.VDW, { opacity: 0.18, color: "#1e3a8a" }, { model: rec, and: [sel] });
    }
  }

  estiloLigando(m, color, visible) {
    if (!m) return;
    if (!visible) return m.setStyle({}, {});
    // 3Dmol acepta «<color>Carbon»: carbonos del color indicado y heteroátomos con el código CPK
    m.setStyle({}, { stick: { radius: 0.26, colorscheme: ESQUEMA[color] ?? "greenCarbon" } });
    m.setStyle({ elem: "H" }, { stick: { radius: 0.12, color: "#e2e8f0" } });
  }

  /** Añade o sustituye una pose (PDBQT de un solo modelo). */
  pose(clave, pdbqt, color = COLOR_POSE) {
    this.quitarPose(clave);
    const m = this.v.addModel(soloAtomos(pdbqt), "pdbqt");
    m.__color = color;
    this.modelos["pose:" + clave] = m;
    this.estiloLigando(m, color, true);
    this.v.render();
  }

  quitarPose(clave) {
    const m = this.modelos["pose:" + clave];
    if (m) {
      this.v.removeModel(m);
      delete this.modelos["pose:" + clave];
    }
  }

  quitarPoses() {
    for (const k of Object.keys(this.modelos)) if (k.startsWith("pose:")) this.quitarPose(k.slice(5));
    this.interacciones([]);
  }

  interacciones(pares) {
    for (const f of this.formas) this.v.removeShape(f);
    this.formas = [];
    if (this.opciones.interacciones) {
      for (const p of pares) {
        this.formas.push(
          this.v.addCylinder({
            start: { x: p.a.x, y: p.a.y, z: p.a.z },
            end: { x: p.b.x, y: p.b.y, z: p.b.z },
            radius: 0.06, dashed: true, dashLength: 0.25, gapLength: 0.18, fromCap: 1, toCap: 1,
            color: TIPOS[p.tipo].color,
          })
        );
      }
    }
    this.v.render();
  }

  opcion(nombre, valor) {
    this.opciones[nombre] = valor;
    this.estilos();
    this.v.render();
  }

  centrar() {
    this.v.zoomTo({ model: this.modelos.cristal });
    this.v.zoom(0.9);
    this.v.render();
  }

  png() {
    return this.v.pngURI();
  }

  redimensionar() {
    this.v?.resize();
    this.v?.render();
  }
}
