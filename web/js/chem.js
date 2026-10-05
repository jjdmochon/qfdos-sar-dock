// Quimioinformática en el navegador con RDKit.js (MinimalLib 2025.03.4, BSD).

const BASE = new URL("../vendor/rdkit/", import.meta.url).href;
let rdkitPromesa = null;

export function rdkit() {
  if (!rdkitPromesa) {
    rdkitPromesa = new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = BASE + "RDKit_minimal.js";
      s.onload = () => globalThis.initRDKitModule({ locateFile: () => BASE + "RDKit_minimal.wasm" }).then(ok, mal);
      s.onerror = () => mal(new Error("No se pudo cargar RDKit.js"));
      document.head.appendChild(s);
    });
  }
  return rdkitPromesa;
}

function conMol(RD, smiles, fn) {
  const m = RD.get_mol(smiles || "");
  if (!m || !m.is_valid()) {
    m?.delete();
    return null;
  }
  try {
    return fn(m);
  } finally {
    m.delete();
  }
}

/** Descriptores y reglas de Lipinski/Veber. Devuelve null si el SMILES no es válido. */
export async function analizar(smiles) {
  const RD = await rdkit();
  return conMol(RD, smiles, (m) => {
    const d = JSON.parse(m.get_descriptors());
    const r = {
      canonico: m.get_smiles(),
      mw: +d.amw.toFixed(1),
      clogp: +d.CrippenClogP.toFixed(2),
      hbd: d.lipinskiHBD,
      hba: d.lipinskiHBA,
      tpsa: +d.tpsa.toFixed(1),
      rotb: d.NumRotatableBonds,
      pesados: d.NumHeavyAtoms,
      anillos: d.NumRings,
      carga: (m.get_smiles().match(/\+\]/g)?.length ?? 0) - (m.get_smiles().match(/-\]/g)?.length ?? 0),
    };
    r.lipinski = [r.mw > 500, r.clogp > 5, r.hbd > 5, r.hba > 10].filter(Boolean).length;
    r.veber = r.rotb <= 10 && r.tpsa <= 140;
    return r;
  });
}

function bits(m) {
  const u8 = m.get_morgan_fp_as_uint8array(JSON.stringify({ radius: 2, nBits: 2048 }));
  return u8;
}

const popcount = (b) => {
  let n = 0;
  for (let x of b) for (; x; x &= x - 1) n++;
  return n;
};

/** Similitud de Tanimoto (huellas de Morgan, radio 2, 2048 bits). */
export async function tanimoto(a, b) {
  const RD = await rdkit();
  const fa = conMol(RD, a, bits);
  const fb = conMol(RD, b, bits);
  if (!fa || !fb) return null;
  const inter = popcount(fa.map((x, i) => x & fb[i]));
  const union = popcount(fa.map((x, i) => x | fb[i]));
  return union ? +(inter / union).toFixed(2) : 0;
}

/**
 * Dibujo 2D. Si la referencia está contenida en el análogo, resalta los átomos añadidos.
 * (RDKit.js no trae MCS; para cambios que no son adiciones no se resalta nada.)
 */
export async function svg(smiles, { referencia, ancho = 320, alto = 220 } = {}) {
  const RD = await rdkit();
  return conMol(RD, smiles, (m) => {
    let resaltado = null;
    if (referencia && referencia !== smiles) {
      const q = RD.get_qmol(referencia);
      try {
        const match = q?.is_valid() ? JSON.parse(m.get_substruct_match(q)) : {};
        if (match.atoms?.length) {
          const comunes = new Set(match.atoms);
          const nuevos = [...Array(m.get_num_atoms()).keys()].filter((i) => !comunes.has(i));
          if (nuevos.length) resaltado = nuevos;
        }
      } finally {
        q?.delete();
      }
    }
    const opts = {
      width: ancho,
      height: alto,
      bondLineWidth: 1.6,
      addStereoAnnotation: true,
      clearBackground: false,
      highlightColour: [0.18, 0.83, 0.75],
    };
    if (resaltado) opts.atoms = resaltado;
    return m.get_svg_with_highlights(JSON.stringify(opts));
  });
}

/** Imagen 2D para la tabla (más pequeña, sin resaltado). */
export const miniatura = (smiles) => svg(smiles, { ancho: 150, alto: 100 });
