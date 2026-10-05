// Cuaderno del grupo: se guarda en este navegador (localStorage) y se comparte entre los
// miembros exportando e importando un .json. No hay servidor: nada sale del equipo.

const CLAVE = "qfdos-sardock-v1";
const VERSION = 1;

function vacio() {
  return { version: VERSION, grupo: "", miembros: "", diana: null, entradas: [], notas: "", actualizado: null };
}

let estado = cargar();
const oyentes = new Set();

function cargar() {
  try {
    const t = localStorage.getItem(CLAVE);
    return t ? { ...vacio(), ...JSON.parse(t) } : vacio();
  } catch {
    return vacio();
  }
}

function guardar() {
  estado.actualizado = new Date().toISOString();
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch (e) {
    console.warn("No se pudo guardar el cuaderno en este navegador", e);
  }
  for (const f of oyentes) f(estado);
}

export const cuaderno = {
  get: () => estado,
  alCambiar(f) {
    oyentes.add(f);
    return () => oyentes.delete(f);
  },
  datos(campos) {
    Object.assign(estado, campos);
    guardar();
  },
  entradas: (diana) => estado.entradas.filter((e) => !diana || e.diana === diana),
  añadir(entrada) {
    const e = { id: crypto.randomUUID(), fecha: new Date().toISOString(), conclusion: "", ...entrada };
    estado.entradas.push(e);
    guardar();
    return e;
  },
  actualizar(id, campos) {
    const e = estado.entradas.find((x) => x.id === id);
    if (e) Object.assign(e, campos);
    guardar();
  },
  borrar(id) {
    estado.entradas = estado.entradas.filter((x) => x.id !== id);
    guardar();
  },
  exportar() {
    return JSON.stringify({ ...estado, exportado: new Date().toISOString(), app: "QFDOS SAR-Dock" }, null, 1);
  },
  /** Importa un cuaderno; con fusionar=true añade las entradas que no estén ya (por id). */
  importar(texto, { fusionar = true } = {}) {
    const d = JSON.parse(texto);
    if (!Array.isArray(d.entradas)) throw new Error("El fichero no es un cuaderno de SAR-Dock");
    if (fusionar) {
      const ids = new Set(estado.entradas.map((e) => e.id));
      const nuevas = d.entradas.filter((e) => !ids.has(e.id));
      estado.entradas.push(...nuevas);
      for (const k of ["grupo", "miembros", "diana", "notas"]) if (!estado[k] && d[k]) estado[k] = d[k];
      guardar();
      return nuevas.length;
    }
    estado = { ...vacio(), ...d };
    guardar();
    return estado.entradas.length;
  },
  vaciar() {
    estado = vacio();
    guardar();
  },
};

export function descargar(nombre, contenido, tipo = "application/json") {
  const url = contenido.startsWith?.("data:") ? contenido : URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!contenido.startsWith?.("data:")) setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function csv(filas) {
  if (!filas.length) return "";
  const cols = Object.keys(filas[0]);
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Punto y coma: Excel en español abre el fichero directamente en columnas
  return "﻿" + [cols.join(";"), ...filas.map((f) => cols.map((c) => esc(f[c])).join(";"))].join("\n");
}
