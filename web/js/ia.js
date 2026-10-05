// Prompts para las IA de la cuenta UGR (Gemini, NotebookLM, Copilot). La página no llama a ningún
// modelo: prepara el texto con el contexto del grupo, lo copia y el estudiante lo pega donde quiera.

export const ENLACES = [
  { nombre: "Gemini", url: "https://gemini.google.com/app", nota: "con tu cuenta @go.ugr.es" },
  { nombre: "NotebookLM", url: "https://notebooklm.google.com/", nota: "cuaderno con las fuentes de tu diana" },
  { nombre: "Copilot", url: "https://copilot.microsoft.com/", nota: "inicia sesión con la cuenta UGR" },
];

const PAUTA =
  "Responde en español. Actúa como profesor de Química Farmacéutica que guía a un grupo de " +
  "estudiantes de Farmacia: no me des la solución cerrada; razona con criterios de relación " +
  "estructura-actividad, señala qué no se puede concluir con un docking y termina con dos " +
  "preguntas que me obliguen a pensar. Si mencionas datos experimentales o artículos, indica " +
  "que debo comprobarlos en la fuente original.";

const linea = (r) => `${r.res}${r.num} (${r.tipo})`;

export function promptDiana(ficha) {
  return `${PAUTA}

Diana: ${ficha.diana} (gen ${ficha.gen}), Tema ${ficha.tema} de Química Farmacéutica II: ${ficha.tema_nombre}.
Estructura de referencia: PDB ${ficha.pdb} (${ficha.metodo}), con ${ficha.ligando} en el centro activo.
SMILES de ${ficha.ligando} a pH 7,4: ${ficha.smiles_ph74}
Residuos del centro activo a menos de 4,5 Å del ligando: ${ficha.centro_activo.slice(0, 20).map(linea).join(", ")}.
Nota del profesor: ${ficha.nota}

Pregunta: ¿cuál es el farmacóforo de ${ficha.ligando} frente a esta diana? Relaciona cada grupo
funcional con el residuo con el que interacciona y explica qué modificaciones estructurales
esperarías que redujeran o mejoraran el reconocimiento molecular, y por qué.`;
}

export function promptDiseño(ficha, analogo) {
  return `${PAUTA}

Diana: ${ficha.diana} (PDB ${ficha.pdb}). Fármaco de partida: ${ficha.ligando}, SMILES ${ficha.smiles_ph74}.
Queremos diseñar un análogo con UN solo cambio estructural respecto al fármaco de partida.
Idea del grupo: ${analogo.hipotesis || "(todavía sin hipótesis)"}
${analogo.smiles ? `SMILES propuesto: ${analogo.smiles}` : ""}

Pregunta: ¿la modificación es químicamente razonable y sintetizable? ¿Qué interacción del
farmacóforo podría verse afectada? Propón dos alternativas (bioisósteros u homólogos) y explica
qué esperaríamos ver en el docking para confirmar o descartar la hipótesis. Escribe cualquier
estructura que propongas en SMILES para poder comprobarla.`;
}

export function promptResultado(ficha, e, comparacion, serie) {
  const ref = serie?.find((s) => s.referencia);
  const tabla = comparacion
    .filter((f) => f.estado !== "conservada" || f.ref !== "hidrofobo")
    .slice(0, 16)
    .map((f) => `${f.res}${f.num}: referencia ${f.ref ?? "—"} → análogo ${f.ana ?? "—"} (${f.estado})`)
    .join("\n");
  return `${PAUTA}

Diana: ${ficha.diana} (PDB ${ficha.pdb}). Referencia: ${ficha.ligando}, SMILES ${ficha.smiles_ph74}
Puntuación Vina de la referencia: ${ref?.vina_kcal_mol ?? ficha.redocking.vina_kcal_mol[0]} kcal/mol${ref?.pchembl ? `; pChEMBL experimental ${ref.pchembl}` : ""}.

Análogo «${e.nombre}»: SMILES ${e.smiles}
Hipótesis previa del grupo: ${e.hipotesis}
Resultado del docking (AutoDock Vina, exhaustividad ${e.exhaustividad}): ${e.kcal} kcal/mol;
eficiencia de ligando ${e.le} kcal/mol por átomo pesado; MW ${e.desc?.mw}, cLogP ${e.desc?.clogp}, TPSA ${e.desc?.tpsa}.
Interacciones por residuo frente a la referencia:
${tabla}

Pregunta: ¿el resultado apoya o contradice nuestra hipótesis? ¿Es significativa la diferencia de
puntuación (el error típico de Vina ronda 1-2 kcal/mol)? ¿Qué experimento o dato de la bibliografía
necesitaríamos para confirmarlo?`;
}

export function promptSerie(ficha, serie, entradas) {
  const filas = [
    ...serie.map((s) => `${s.nombre} (conocido): Vina ${s.vina_kcal_mol}, pChEMBL ${s.pchembl ?? "—"}`),
    ...entradas.map((e) => `${e.nombre} (diseño del grupo): Vina ${e.kcal}, cambio: ${e.hipotesis}`),
  ].join("\n");
  return `${PAUTA}

Diana: ${ficha.diana} (PDB ${ficha.pdb}). Serie estudiada por el grupo:
${filas}

Pregunta: ¿qué relación estructura-actividad se desprende de la serie? ¿Correlaciona la
puntuación de Vina con la potencia experimental (pChEMBL) de los fármacos conocidos? Si no
correlaciona, ¿qué limitaciones del docking lo explican (protonación, flexibilidad del receptor,
solvatación, entropía, farmacocinética)?`;
}

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = texto;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}
