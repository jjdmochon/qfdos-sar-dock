// Docking en el navegador: OpenBabel (WASM) para SMILES → 3D → PDBQT y AutoDock Vina 1.2.3
// compilado a WebAssembly (Webina, Durrant lab, Apache-2.0). Todo corre en el equipo del estudiante.

const WEBINA = new URL("../vendor/webina/", import.meta.url).href;

export const dockingDisponible = () =>
  typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true;

// ---------------------------------------------------------------- OpenBabel (en un worker)
let worker = null;
let siguienteId = 0;
const pendientes = new Map();

function obWorker() {
  if (!worker) {
    worker = new Worker(new URL("./ob-worker.js", import.meta.url));
    worker.onmessage = ({ data }) => {
      const p = pendientes.get(data.id);
      if (!p) return;
      pendientes.delete(data.id);
      data.error ? p.mal(new Error(data.error)) : p.ok(data.pdbqt);
    };
  }
  return worker;
}

/**
 * SMILES → PDBQT con coordenadas 3D (MMFF94) y torsiones.
 * El SMILES debe llegar ya protonado a pH 7,4 (lo hace chem.js); corregirPH aplica además
 * el modelo de pH de OpenBabel.
 */
export function smilesAPdbqt(smiles, { corregirPH = false } = {}) {
  const id = ++siguienteId;
  return new Promise((ok, mal) => {
    pendientes.set(id, { ok, mal });
    obWorker().postMessage({ id, smiles, corregirPH });
  });
}

// ---------------------------------------------------------------- Vina
/**
 * Ejecuta Vina. Devuelve { pdbqt, poses: [{kcal, rmsdLb, rmsdUb}], stdout, segundos }.
 */
export async function acoplar({ receptor, ligando, caja, exhaustividad = 8, semilla = 42, modos = 9, cpu, onLinea }) {
  if (!dockingDisponible()) {
    throw new Error("Este navegador no permite el docking (falta SharedArrayBuffer). Usa Chrome o Edge de escritorio.");
  }
  const { default: crearModulo } = await import(WEBINA + "vina.1.0.5.js");
  const t0 = performance.now();
  const nucleos = cpu ?? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));

  return new Promise((resolver, rechazar) => {
    let stdout = "";
    let stderr = "";
    let fs = null;
    crearModulo({
      noInitialRun: true,
      locateFile: (p) => WEBINA + p,
      preRun: [
        (M) => {
          M.FS.writeFile("/receptor.pdbqt", receptor);
          M.FS.writeFile("/ligand.pdbqt", ligando);
          fs = M.FS;
        },
      ],
      print: (t) => {
        stdout += t + "\n";
        onLinea?.(t);
      },
      printErr: (t) => {
        stderr += t + "\n";
      },
      onExit: () => {
        try {
          const pdbqt = fs.readFile("/ligand_out.pdbqt", { encoding: "utf8" });
          resolver({
            pdbqt,
            poses: leerEnergias(pdbqt),
            stdout,
            segundos: (performance.now() - t0) / 1000,
          });
        } catch (e) {
          rechazar(new Error(stderr || stdout || String(e)));
        }
      },
      onAbort: (e) => rechazar(new Error(stderr || String(e))),
    })
      .then((M) => {
        const [cx, cy, cz] = caja.center;
        const [sx, sy, sz] = caja.size;
        M.callMain([
          "--center_x", `${cx}`, "--center_y", `${cy}`, "--center_z", `${cz}`,
          "--size_x", `${sx}`, "--size_y", `${sy}`, "--size_z", `${sz}`,
          "--exhaustiveness", `${exhaustividad}`, "--num_modes", `${modos}`,
          "--seed", `${semilla}`, "--cpu", `${nucleos}`,
          "--receptor", "/receptor.pdbqt", "--ligand", "/ligand.pdbqt", "--out", "/ligand_out.pdbqt",
        ]);
      })
      .catch(rechazar);
  });
}

export function leerEnergias(pdbqt) {
  return pdbqt
    .split("\n")
    .filter((l) => l.startsWith("REMARK VINA RESULT"))
    .map((l) => {
      const [, , , kcal, lb, ub] = l.trim().split(/\s+/);
      return { kcal: +kcal, rmsdLb: +lb, rmsdUb: +ub };
    });
}

/** Separa la salida multimodelo de Vina en un PDBQT por pose. */
export function separarPoses(pdbqt) {
  return pdbqt
    .split(/^ENDMDL.*$/m)
    .map((b) => b.replace(/^MODEL.*$/m, "").trim())
    .filter((b) => /^(ATOM|HETATM)/m.test(b));
}
