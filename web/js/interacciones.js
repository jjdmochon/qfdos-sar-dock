// Interacciones ligando-receptor a partir de PDBQT (tipos de átomo AutoDock).
// Criterios geométricos sencillos, pensados para docencia: no sustituyen a PLIP ni a un análisis
// con ángulos, pero bastan para ver qué se gana y qué se pierde al modificar el ligando.

const CARGADOS_NEG = { ASP: ["OD1", "OD2"], GLU: ["OE1", "OE2"] };
const CARGADOS_POS = { ARG: ["NE", "NH1", "NH2"], LYS: ["NZ"], HIS: ["ND1", "NE2"] };
const AROMATICOS = new Set(["PHE", "TYR", "TRP", "HIS"]);
const METALES = new Set(["Zn", "ZN", "Mg", "MG", "Ca", "CA", "Fe", "FE", "Mn", "MN"]);

export const TIPOS = {
  metal: { etiqueta: "coordinación metálica", corto: "metal", prioridad: 6, color: "#8b5cf6" },
  salino: { etiqueta: "puente salino", corto: "salino", prioridad: 5, color: "#f97316" },
  cationpi: { etiqueta: "catión-π", corto: "catión-π", prioridad: 4, color: "#1e3a8a" },
  hbond: { etiqueta: "puente de H", corto: "puente H", prioridad: 3, color: "#0d9488" },
  pi: { etiqueta: "aromática (π)", corto: "π", prioridad: 2, color: "#3b82f6" },
  hidrofobo: { etiqueta: "hidrófoba", corto: "hidrófoba", prioridad: 1, color: "#94a3b8" },
};

/** Átomos de un PDBQT: {nombre, res, cadena, num, x, y, z, tipo, carga, el} */
export function leerPdbqt(txt) {
  const at = [];
  for (const l of txt.split("\n")) {
    if (!l.startsWith("ATOM") && !l.startsWith("HETATM")) continue;
    const tipo = l.slice(77, 79).trim() || l.slice(76).trim();
    at.push({
      nombre: l.slice(12, 16).trim(),
      res: l.slice(17, 20).trim(),
      cadena: l.slice(21, 22).trim(),
      num: parseInt(l.slice(22, 26), 10),
      x: +l.slice(30, 38),
      y: +l.slice(38, 46),
      z: +l.slice(46, 54),
      carga: +l.slice(70, 76) || 0,
      tipo,
      el: elemento(tipo),
    });
  }
  return at;
}

function elemento(t) {
  if (t === "A" || t === "C") return "C";
  if (t === "OA" || t === "O") return "O";
  if (t === "NA" || t === "N") return "N";
  if (t === "SA" || t === "S") return "S";
  if (t === "HD" || t === "H") return "H";
  return t.length === 2 ? t[0] + t[1].toLowerCase() : t;
}

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/** Rejilla espacial para no comparar todos con todos (receptores de ~3000 átomos). */
function rejilla(atomos, celda = 5) {
  const g = new Map();
  for (const a of atomos) {
    const k = `${Math.floor(a.x / celda)},${Math.floor(a.y / celda)},${Math.floor(a.z / celda)}`;
    (g.get(k) ?? g.set(k, []).get(k)).push(a);
  }
  return {
    cerca(p, r) {
      const out = [];
      const [i, j, k] = [p.x, p.y, p.z].map((v) => Math.floor(v / celda));
      const n = Math.ceil(r / celda);
      for (let a = -n; a <= n; a++)
        for (let b = -n; b <= n; b++)
          for (let c = -n; c <= n; c++) {
            const lst = g.get(`${i + a},${j + b},${k + c}`);
            if (lst) for (const x of lst) if (d2(p, x) <= r * r) out.push(x);
          }
      return out;
    },
  };
}

/** Marca qué átomos pesados llevan un H polar (donadores) dentro de cada conjunto. */
function marcarDonadores(atomos, idx) {
  for (const h of atomos) {
    if (h.tipo !== "HD") continue;
    for (const x of idx.cerca(h, 1.15)) if (x !== h && (x.el === "N" || x.el === "O")) x.donador = true;
  }
}

let cacheRec = null;
function prepararReceptor(rec) {
  if (cacheRec?.rec === rec) return cacheRec;
  const idx = rejilla(rec);
  marcarDonadores(rec, idx);
  cacheRec = { rec, idx };
  return cacheRec;
}

const claveRes = (a) => `${a.res}${a.num}${a.cadena ? ":" + a.cadena : ""}`;

/**
 * Calcula las interacciones de un ligando con el receptor.
 * Devuelve { residuos: Map(clave → {clave, res, num, cadena, tipo, d}), pares: [{a, b, tipo, d}] }
 */
export function calcular(receptorAtomos, ligandoAtomos) {
  const { idx } = prepararReceptor(receptorAtomos);
  const lig = ligandoAtomos.map((a) => ({ ...a }));
  marcarDonadores(lig, rejilla(lig, 3));
  // Amonio (protonado o cuaternario): N no aceptor con cuatro vecinos. Las cargas parciales de
  // Gasteiger no sirven aquí (dejan el N del amonio con carga negativa).
  for (const n of lig) {
    if (n.el !== "N" || n.tipo !== "N") continue;
    const hs = lig.filter((h) => h.tipo === "HD" && d2(h, n) < 1.15 ** 2).length;
    const pesados = lig.filter((x) => x !== n && x.el !== "H" && d2(x, n) < 1.75 ** 2).length;
    n.positivo = hs + pesados === 4;
  }
  // Carboxilato / ácido desprotonado: O aceptor unido a C que lleva otro O aceptor y sin H
  for (const o of lig) {
    if (o.el !== "O" || o.donador) continue;
    const c = lig.find((x) => x.el === "C" && d2(x, o) < 1.4 ** 2);
    if (!c) continue;
    const otros = lig.filter((x) => x !== o && x.el === "O" && !x.donador && d2(x, c) < 1.4 ** 2);
    o.negativo = otros.length >= 1 && o.carga < -0.4;
  }

  const residuos = new Map();
  const pares = [];
  const anotar = (r, l, tipo, d) => {
    const k = claveRes(r);
    const prev = residuos.get(k);
    if (!prev || TIPOS[tipo].prioridad > TIPOS[prev.tipo].prioridad || (prev.tipo === tipo && d < prev.d)) {
      residuos.set(k, { clave: k, res: r.res, num: r.num, cadena: r.cadena, tipo, d: +d.toFixed(2) });
    }
    if (tipo !== "hidrofobo" && tipo !== "pi") pares.push({ a: l, b: r, tipo, d });
  };

  const piContactos = new Map();
  const cationContactos = new Map();
  for (const l of lig) {
    if (l.el === "H") continue;
    for (const r of idx.cerca(l, 4.6)) {
      if (r.el === "H") continue;
      const d = Math.sqrt(d2(l, r));
      if (METALES.has(r.tipo) || METALES.has(r.el)) {
        if (d <= 2.8 && ["N", "O", "S"].includes(l.el)) anotar(r, l, "metal", d);
        continue;
      }
      if (d <= 4.0 && l.positivo && CARGADOS_NEG[r.res]?.includes(r.nombre)) { anotar(r, l, "salino", d); continue; }
      if (d <= 4.6 && l.positivo && r.tipo === "A" && AROMATICOS.has(r.res) && r.res !== "HIS") {
        // Amonio frente a un anillo aromático: se exige que varios átomos del anillo estén cerca
        const k = claveRes(r);
        const lst = cationContactos.get(k) ?? cationContactos.set(k, []).get(k);
        lst.push({ r, d });
        if (lst.length === 3) {
          const cerca = lst.reduce((a, b) => (a.d < b.d ? a : b));
          anotar(cerca.r, l, "cationpi", cerca.d);
        }
        continue;
      }
      if (d <= 4.0 && l.negativo && CARGADOS_POS[r.res]?.includes(r.nombre)) { anotar(r, l, "salino", d); continue; }
      if (d <= 3.5 && (l.el === "N" || l.el === "O") && (r.el === "N" || r.el === "O")) {
        const ligDona = l.donador && (r.tipo === "OA" || r.tipo === "NA");
        const recDona = r.donador && (l.tipo === "OA" || l.tipo === "NA");
        if (ligDona || recDona) { anotar(r, l, "hbond", d); continue; }
      }
      if (d <= 4.5 && l.tipo === "A" && r.tipo === "A" && AROMATICOS.has(r.res)) {
        const k = claveRes(r);
        piContactos.set(k, (piContactos.get(k) ?? 0) + 1);
        if (piContactos.get(k) >= 4) anotar(r, l, "pi", d);
        continue;
      }
      if (d <= 4.0 && (l.tipo === "C" || l.tipo === "A") && (r.tipo === "C" || r.tipo === "A")) anotar(r, l, "hidrofobo", d);
    }
  }
  return { residuos, pares };
}

/** Compara las interacciones de un análogo con las del ligando de referencia, residuo a residuo. */
export function comparar(ref, ana) {
  const claves = new Set([...ref.residuos.keys(), ...ana.residuos.keys()]);
  const filas = [];
  for (const k of claves) {
    const r = ref.residuos.get(k);
    const a = ana.residuos.get(k);
    let estado;
    if (r && a) estado = r.tipo === a.tipo ? "conservada" : TIPOS[a.tipo].prioridad > TIPOS[r.tipo].prioridad ? "reforzada" : "debilitada";
    else estado = r ? "perdida" : "nueva";
    const base = r ?? a;
    filas.push({ clave: k, res: base.res, num: base.num, ref: r?.tipo ?? null, ana: a?.tipo ?? null, estado });
  }
  const peso = (f) => Math.max(f.ref ? TIPOS[f.ref].prioridad : 0, f.ana ? TIPOS[f.ana].prioridad : 0);
  return filas.sort((x, y) => peso(y) - peso(x) || x.num - y.num);
}
