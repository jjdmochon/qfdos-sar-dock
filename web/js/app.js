// QFDOS SAR-Dock · panel de relaciones estructura-actividad y docking en el navegador.
import { analizar, svg, miniatura, tanimoto, rdkit } from "./chem.js";
import { acoplar, smilesAPdbqt, separarPoses, dockingDisponible } from "./dock.js";
import { leerPdbqt, calcular, comparar, TIPOS } from "./interacciones.js";
import { Visor, COLOR_POSE, COLOR_SERIE } from "./viewer.js";
import { cuaderno, descargar, csv } from "./cuaderno.js";
import { ENLACES, promptDiana, promptDiseño, promptResultado, promptSerie, copiar } from "./ia.js";

// ---------------------------------------------------------------- utilidades
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? "—" : (+x).toFixed(d).replace(".", ","));
const app = $("#app");

function toast(t, ms = 2600) {
  const el = $("#toast");
  el.textContent = t;
  el.classList.add("on");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("on"), ms);
}

async function getJSON(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return r.json();
}
async function getText(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return r.text();
}

function dialogoIA(titulo, texto) {
  const d = $("#dlg");
  $("#dlg-in").innerHTML = `
    <h3>${esc(titulo)}</h3>
    <p class="sub">El texto ya está copiado. Pégalo en la IA de tu cuenta UGR y guarda en el cuaderno lo que te sirva.
    Recuerda declarar en el informe qué preguntaste y qué usaste.</p>
    <pre>${esc(texto)}</pre>
    <div class="fila">${enlaceCuadernoTema(E.ficha?.tema, "btn teal")}${ENLACES.map((e) => `<a class="btn ia" href="${e.url}" target="_blank" rel="noopener">${e.nombre}</a>`).join("")}
      <button class="btn" id="dlg-cerrar" style="margin-left:auto">Cerrar</button></div>`;
  $("#dlg-cerrar").onclick = () => d.close();
  d.showModal();
}

/** Cuaderno de NotebookLM del curso para un tema (data/notebooks.json), si ya está publicado. */
function enlaceCuadernoTema(tema, clase = "btn teal peq") {
  const nb = tema != null ? E.notebooks[String(tema)] : null;
  return nb ? `<a class="${clase}" href="${esc(nb.url)}" target="_blank" rel="noopener"
    title="Cuaderno de NotebookLM del curso con el material del Tema ${tema}">Cuaderno del Tema ${tema} (NotebookLM)</a>` : "";
}

async function preguntarIA(titulo, texto) {
  await copiar(texto);
  const c = cuaderno.get();
  cuaderno.datos({ ia: [...(c.ia ?? []), { fecha: new Date().toISOString(), titulo, prompt: texto }] });
  dialogoIA(titulo, texto);
}

// ---------------------------------------------------------------- estado
const E = {
  dianas: [],
  notebooks: {},
  clave: null,
  ficha: null,
  recPdb: null,
  recPdbqt: null,
  recAtomos: null,
  cristal: null,
  refInter: null,
  serie: [],
  visor: null,
  jsme: null,
  resultado: null, // último docking (sin guardar todavía)
  poseSel: 0,
};

const secciones = {};
function seccion(nombre) {
  if (!secciones[nombre]) {
    const s = document.createElement("section");
    s.id = "s-" + nombre;
    s.hidden = true;
    app.appendChild(s);
    secciones[nombre] = s;
  }
  return secciones[nombre];
}

// ---------------------------------------------------------------- router
const RUTAS = { dianas: pantallaDianas, lab: pantallaLab, sar: pantallaSAR, cuaderno: pantallaCuaderno, guia: pantallaGuia };

async function navegar() {
  const ruta = (location.hash.replace(/^#\//, "") || "dianas").split("/")[0];
  const f = RUTAS[ruta] ?? pantallaDianas;
  for (const a of document.querySelectorAll("nav.tabs a")) {
    if (a.dataset.ruta === ruta) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  for (const [n, s] of Object.entries(secciones)) s.hidden = n !== ruta;
  try {
    await f(seccion(ruta));
  } catch (e) {
    console.error(e);
    seccion(ruta).innerHTML = `<div class="aviso warn">Error: ${esc(e.message)}</div>`;
  }
  seccion(ruta).hidden = false;
  if (ruta === "lab") E.visor?.redimensionar();
}

function cabecera() {
  const c = cuaderno.get();
  const d = E.dianas.find((x) => x.clave === c.diana);
  $("#cab-grupo").textContent = [c.grupo && `Grupo: ${c.grupo}`, d && `Diana: ${d.diana}`].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- carga de la diana
async function cargarDiana(clave) {
  if (E.clave === clave && E.ficha) return;
  const base = `data/${clave}/`;
  const [ficha, recPdb, recPdbqt, cristal, serie] = await Promise.all([
    getJSON(base + "ficha.json"),
    getText(base + "receptor.pdb"),
    getText(base + "receptor.pdbqt"),
    getText(base + "ref_cristal.pdbqt"),
    getJSON(base + "serie.json").catch(() => []),
  ]);
  Object.assign(E, { clave, ficha, recPdb, recPdbqt, cristal, serie, resultado: null });
  E.recAtomos = leerPdbqt(recPdbqt);
  E.refInter = calcular(E.recAtomos, leerPdbqt(cristal));
  E.labListo = false;
}

// ================================================================ 1 · DIANAS
async function pantallaDianas(s) {
  const c = cuaderno.get();
  if (s.dataset.ok) {
    for (const el of s.querySelectorAll(".diana")) el.classList.toggle("sel", el.dataset.clave === c.diana);
    return;
  }
  s.innerHTML = `
    <div class="dos" style="margin-bottom:16px">
      <div class="card">
        <h2>Vuestro grupo</h2>
        <p class="sub">El cuaderno se guarda en este navegador. Para trabajar entre varios, exportadlo e importadlo desde «Cuaderno».</p>
        <label for="g-nombre">Nombre del grupo</label>
        <input type="text" id="g-nombre" value="${esc(c.grupo)}" placeholder="Ej.: E-07">
        <label for="g-miembros">Miembros (nombre y correo @go.ugr.es)</label>
        <textarea id="g-miembros" rows="3">${esc(c.miembros)}</textarea>
      </div>
      <div class="card">
        <h2>Cómo funciona</h2>
        <ol style="margin:0;padding-left:1.2em">
          <li>Elegid <b>una diana</b> (una por grupo).</li>
          <li>En <b>Laboratorio</b>, estudiad el ligando del cristal y los fármacos del tema ya acoplados.</li>
          <li>Diseñad análogos con <b>un solo cambio</b>, escribid antes la hipótesis y acopladlos.</li>
          <li>Comparad interacciones ganadas y perdidas, y construid la <b>Tabla SAR</b>.</li>
          <li>Usad Gemini, NotebookLM o Copilot como interlocutores, y declaradlo.</li>
        </ol>
      </div>
    </div>
    <h2>Dianas: una por tema</h2>
    <div class="grid-dianas" id="lista-dianas"></div>`;
  $("#g-nombre", s).oninput = (e) => { cuaderno.datos({ grupo: e.target.value.trim() }); cabecera(); };
  $("#g-miembros", s).oninput = (e) => cuaderno.datos({ miembros: e.target.value });

  const lista = $("#lista-dianas", s);
  for (const d of E.dianas) {
    const b = document.createElement("button");
    b.className = "card diana" + (d.clave === c.diana ? " sel" : "");
    b.dataset.clave = d.clave;
    b.innerHTML = `
      <span class="tema">Tema ${d.tema} · ${esc(d.tema_nombre)}</span>
      <h3>${esc(d.diana)}</h3>
      <div class="mini"></div>
      <span class="lig">Ligando del cristal: <b>${esc(d.ligando)}</b></span>
      <span class="pie"><span class="chip">PDB ${d.pdb}</span><span class="chip teal">${esc(d.metodo)}</span>
      ${d.organismo && d.organismo !== "humano" ? `<span class="chip amber">proteína de ${esc(d.organismo)}</span>` : ""}
      ${E.notebooks[String(d.tema)] ? `<span class="chip teal" title="El tema tiene cuaderno de NotebookLM del curso">NotebookLM</span>` : ""}
      <span class="chip ${d.rmsd_ref < 2 ? "" : "amber"}" title="Redocking: RMSD de la mejor pose de Vina frente al cristal">RMSD ${fmt(d.rmsd_ref)} Å</span></span>`;
    b.onclick = async () => {
      const actual = cuaderno.get().diana;
      if (actual && actual !== d.clave && cuaderno.entradas(actual).length &&
          !confirm(`Vuestro cuaderno tiene análogos de otra diana. ¿Cambiar a ${d.diana}? (No se borra nada.)`)) return;
      cuaderno.datos({ diana: d.clave });
      cabecera();
      location.hash = "#/lab";
    };
    lista.appendChild(b);
    miniatura(d.smiles_ph74).then((x) => { if (x) $(".mini", b).innerHTML = x; });
  }
  s.dataset.ok = "1";
}

// ================================================================ 2 · LABORATORIO
function sinDiana(s) {
  s.innerHTML = `<div class="card vacio"><h2>Primero elegid una diana</h2><p><a class="btn primario" href="#/dianas">Ir a Dianas</a></p></div>`;
}

let labEnCurso = null;
async function pantallaLab(s) {
  const clave = cuaderno.get().diana;
  if (!clave) return sinDiana(s);
  if (!s.dataset.ok) construirLab(s);
  if (labEnCurso?.clave === clave) return labEnCurso.p;
  if (E.clave !== clave || !E.labListo) {
    $("#lab-cab", s).innerHTML = `<h2>Cargando la diana…</h2>`;
    const p = (async () => {
      await cargarDiana(clave);
      await prepararLab(s);
    })();
    labEnCurso = { clave, p };
    try { await p; } finally { labEnCurso = null; }
  }
}

function construirLab(s) {
  const docking = dockingDisponible();
  s.innerHTML = `
    <div class="cab-diana" id="lab-cab"></div>
    ${docking ? "" : `<div class="aviso warn"><b>Este navegador no puede ejecutar el docking</b> (falta SharedArrayBuffer).
      Podéis ver estructuras y resultados, pero para acoplar usad Chrome o Edge en un ordenador.</div>`}
    ${docking && matchMedia("(pointer: coarse)").matches ? `<div class="aviso info">En un móvil o tableta el docking funciona, pero puede tardar
      más de 10 minutos y calentar el dispositivo. Para diseñar y acoplar, mejor un ordenador.</div>` : ""}
    <div class="lab">
      <div class="card col-diseno">
        <h3>1 · Diseño del análogo</h3>
        <div id="jsme"></div>
        <label for="smi">SMILES</label>
        <input type="text" id="smi" class="mono" spellcheck="false" autocomplete="off">
        <div class="fila" style="margin-top:8px">
          <button class="btn peq" id="b-ref">Cargar referencia</button>
          <select id="sel-serie" style="flex:1;min-width:140px"><option value="">Fármaco de la serie…</option></select>
        </div>
        <div class="estructura" id="dibujo2d" style="margin-top:8px"></div>
        <div class="props" id="props"></div>
        <label for="nombre">Nombre del análogo</label>
        <input type="text" id="nombre" placeholder="Ej.: E-07-03, des-metoxi">
        <label for="hip">Hipótesis (antes de acoplar): qué cambio hacéis y qué esperáis</label>
        <textarea id="hip" rows="3" placeholder="Ej.: Sustituimos el OCH₃ en 5 por F. Esperamos perder el puente de H con… y mantener…"></textarea>
        <div class="fila" style="margin-top:10px">
          <label for="exh" style="margin:0">Exhaustividad</label>
          <select id="exh" style="width:auto"><option>4</option><option selected>8</option><option>16</option></select>
          <button class="btn primario" id="b-dock" ${docking ? "" : "disabled"} style="margin-left:auto">Acoplar</button>
        </div>
        <div class="progreso" id="prog" hidden><div></div></div>
        <p class="sub" id="estado-dock"></p>
        <button class="btn ia" id="b-ia-diseno" style="width:100%;margin-top:6px">Pedir ideas de diseño a la IA</button>
      </div>

      <div class="col-visor">
        <div id="visor"></div>
        <div class="visor-ctl">
          <label><input type="checkbox" id="v-cristal" checked> Ligando del cristal</label>
          <label><input type="checkbox" id="v-inter" checked> Interacciones</label>
          <label><input type="checkbox" id="v-etiq" checked> Etiquetas</label>
          <label><input type="checkbox" id="v-sup"> Superficie del bolsillo</label>
          <select id="v-serie" style="width:auto"><option value="">Superponer fármaco de la serie…</option></select>
          <button class="btn peq" id="v-centrar">Centrar</button>
          <button class="btn peq" id="v-png">PNG</button>
        </div>
        <div class="leyenda">
          <span><i style="background:#10b981"></i>Cristal</span>
          <span><i style="background:${COLOR_POSE}"></i>Vuestro análogo</span>
          <span><i style="background:${COLOR_SERIE}"></i>Fármaco de la serie</span>
          ${Object.values(TIPOS).filter((t) => t.prioridad > 2).map((t) => `<span><i style="background:${t.color}"></i>${t.etiqueta}</span>`).join("")}
        </div>
        <div class="poses" id="poses"></div>
      </div>

      <div class="card col-res">
        <h3>2 · Resultado e interacciones</h3>
        <div id="res-resumen"></div>
        <div class="tabla-scroll" style="max-height:360px"><table id="t-inter"></table></div>
        <div id="res-acciones" style="margin-top:10px"></div>
      </div>
    </div>`;

  const smi = $("#smi", s);
  smi.addEventListener("change", () => cambiarSmiles(smi.value.trim(), { desdeJSME: false }));
  smi.addEventListener("keydown", (e) => { if (e.key === "Enter") smi.blur(); });
  $("#b-ref", s).onclick = () => cambiarSmiles(E.ficha.smiles_ph74);
  $("#sel-serie", s).onchange = (e) => {
    const f = E.serie.find((x) => x.slug === e.target.value);
    if (f) cambiarSmiles(f.smiles_ph74);
    e.target.value = "";
  };
  $("#b-dock", s).onclick = () => lanzarDocking();
  $("#b-ia-diseno", s).onclick = () =>
    preguntarIA("Ideas de diseño", promptDiseño(E.ficha, { smiles: smi.value.trim(), hipotesis: $("#hip").value.trim() }));

  $("#v-cristal", s).onchange = (e) => E.visor.opcion("cristal", e.target.checked);
  $("#v-inter", s).onchange = (e) => { E.visor.opcion("interacciones", e.target.checked); pintarInteracciones(); };
  $("#v-etiq", s).onchange = (e) => E.visor.opcion("etiquetas", e.target.checked);
  $("#v-sup", s).onchange = (e) => E.visor.opcion("superficie", e.target.checked);
  $("#v-centrar", s).onclick = () => E.visor.centrar();
  $("#v-png", s).onclick = () => descargar(`${E.clave}_${Date.now()}.png`, E.visor.png());
  $("#v-serie", s).onchange = (e) => superponerSerie(e.target.value);
  s.dataset.ok = "1";
  addEventListener("resize", () => E.visor?.redimensionar());
}

async function prepararLab(s) {
  const f = E.ficha;
  $("#lab-cab", s).innerHTML = `
    <h2>${esc(f.diana)}</h2>
    <span class="chip">Tema ${f.tema} · ${esc(f.tema_nombre)}</span>
    <span class="chip teal">PDB ${f.pdb} · ${esc(f.metodo)}</span>
    ${f.organismo && f.organismo !== "humano" ? `<span class="chip amber" title="La secuencia del bolsillo puede diferir de la humana">proteína de ${esc(f.organismo)}</span>` : ""}
    <span class="chip">${esc(f.ligando)}: ${fmt(f.redocking.vina_kcal_mol[0])} kcal/mol</span>
    <button class="btn ia peq" id="b-ia-diana">Preguntar a la IA por el farmacóforo</button>
    ${enlaceCuadernoTema(f.tema)}
    <p class="sub" style="width:100%;margin:4px 0 0">${esc(f.nota)}</p>
    ${avisoRedocking(f)}`;
  $("#b-ia-diana", s).onclick = () => preguntarIA("Farmacóforo de la diana", promptDiana(f));

  const opciones = E.serie.map((x) => `<option value="${x.slug}">${esc(x.nombre)}${x.pchembl ? ` · pChEMBL ${fmt(x.pchembl)}` : ""}</option>`).join("");
  $("#sel-serie", s).innerHTML = `<option value="">Fármaco de la serie…</option>${opciones}`;
  $("#v-serie", s).innerHTML = `<option value="">Superponer fármaco de la serie…</option>${opciones}`;

  if (!E.visor) E.visor = await new Visor($("#visor", s)).iniciar();
  E.visor.cargarDiana(f, E.recPdb, E.cristal);
  E.resultado = null;
  $("#poses", s).innerHTML = "";
  mostrarInteracciones(null);
  pintarInteracciones();
  await iniciarJSME();
  await cambiarSmiles(f.smiles_ph74);
  E.labListo = true;
}

function avisoRedocking(f) {
  const { rmsd, vina_kcal_mol: e, exhaustividad } = f.redocking;
  if (rmsd[0] < 2) {
    return `<div class="aviso ok" style="width:100%;margin:6px 0 0">Validación: al reacoplar ${esc(f.ligando)}, la mejor pose de Vina
      queda a ${fmt(rmsd[0])} Å del cristal. El protocolo reproduce el modo de unión experimental.</div>`;
  }
  const i = rmsd.indexOf(Math.min(...rmsd));
  return `<div class="aviso warn" style="width:100%;margin:6px 0 0"><b>Atención, validación incompleta:</b> al reacoplar ${esc(f.ligando)}
    (exhaustividad ${exhaustividad}), la pose mejor puntuada (${fmt(e[0])} kcal/mol) queda a ${fmt(rmsd[0])} Å del cristal;
    la pose ${i + 1} (${fmt(e[i])} kcal/mol) sí lo reproduce (${fmt(rmsd[i])} Å). Revisad siempre varias poses y
    discutid en el informe por qué la función de puntuación de Vina falla aquí.
    ${anclas().some((x) => x.tipo === "metal") ? "Vina no modela bien la coordinación con el Zn²⁺: quedaos con las poses marcadas con ⚓, que mantienen el anclaje al metal, y tratad las puntuaciones con más cautela que en otras dianas." : "Las poses marcadas con ⚓ conservan las interacciones ancla del cristal."}</div>`;
}

// ---- JSME (editor 2D)
let jsmePromesa = null;
function iniciarJSME() {
  if (!jsmePromesa) {
    jsmePromesa = new Promise((ok) => {
      globalThis.jsmeOnLoad = () => {
        // eslint-disable-next-line no-undef
        E.jsme = new JSApplet.JSME("jsme", "100%", "300px", { options: "query,hydrogens,fullScreenIcon,zoom" });
        E.jsme.setCallBack("AfterStructureModified", () => {
          const smi = E.jsme.smiles();
          if (smi && smi !== $("#smi").value) cambiarSmiles(smi, { desdeJSME: true });
        });
        ok(E.jsme);
      };
      const sc = document.createElement("script");
      sc.src = "vendor/jsme/jsme.nocache.js";
      document.head.appendChild(sc);
      setTimeout(() => ok(null), 15000); // si JSME no carga, el SMILES sigue funcionando
    });
  }
  return jsmePromesa;
}

let cambioId = 0;
async function cambiarSmiles(smi, { desdeJSME = false } = {}) {
  const id = ++cambioId;
  $("#smi").value = smi;
  if (!desdeJSME && E.jsme) {
    try { E.jsme.readGenericMolecularInput(smi); } catch { /* SMILES no válido: se avisa abajo */ }
  }
  const [d, dib, tan] = await Promise.all([
    analizar(smi),
    svg(smi, { referencia: E.ficha.smiles_ph74 }),
    tanimoto(smi, E.ficha.smiles_ph74),
  ]);
  if (id !== cambioId) return;
  if (!d) {
    $("#props").innerHTML = `<div class="aviso warn" style="grid-column:1/-1;margin:0">SMILES no válido</div>`;
    $("#dibujo2d").innerHTML = "";
    $("#b-dock").disabled = true;
    return;
  }
  $("#b-dock").disabled = !dockingDisponible();
  $("#dibujo2d").innerHTML = dib ?? "";
  const p = (v, t, alerta) => `<div class="prop" ${alerta ? 'style="border-color:#fcd34d;background:#fffbeb"' : ""}><b>${v}</b><span>${t}</span></div>`;
  $("#props").innerHTML =
    p(fmt(d.mw, 1), "MW (g/mol)", d.mw > 500) + p(fmt(d.clogp), "cLogP", d.clogp > 5) + p(fmt(d.tpsa, 1), "TPSA (Å²)", d.tpsa > 140) +
    p(d.hbd, "Donadores de H", d.hbd > 5) + p(d.hba, "Aceptores de H", d.hba > 10) + p(d.rotb, "Enlaces rotables", d.rotb > 10) +
    p(d.pesados, "Átomos pesados") + p(fmt(tan), "Tanimoto vs ref.") +
    p(d.lipinski === 0 ? "Cumple" : `${d.lipinski} fallo${d.lipinski > 1 ? "s" : ""}`, "Lipinski", d.lipinski > 1);
  E.desc = d;
  E.tanimoto = tan;
}

// ---- docking
async function lanzarDocking() {
  const smi = $("#smi").value.trim();
  const hip = $("#hip").value.trim();
  const nombre = $("#nombre").value.trim() || `Análogo ${cuaderno.entradas(E.clave).length + 1}`;
  if (hip.length < 20) {
    toast("Escribid primero la hipótesis: qué cambiáis y qué esperáis ver.");
    $("#hip").focus();
    return;
  }
  const d = await analizar(smi);
  if (!d) return toast("El SMILES no es válido");
  if (d.pesados > 60 || d.rotb > 15) {
    if (!confirm("La molécula es grande o muy flexible: el docking será lento y poco fiable. ¿Continuar?")) return;
  }
  const exh = +$("#exh").value;
  const btn = $("#b-dock");
  const prog = $("#prog");
  const est = $("#estado-dock");
  btn.disabled = true;
  prog.hidden = false;
  prog.classList.add("indet");
  const t0 = performance.now();
  const reloj = setInterval(() => (est.textContent = `${est.dataset.fase} · ${Math.round((performance.now() - t0) / 1000)} s`), 500);
  try {
    est.dataset.fase = "Generando la estructura 3D (OpenBabel)";
    const yaCargado = /[+-]\]/.test(smi);
    const lig = await smilesAPdbqt(smi, { corregirPH: !yaCargado });
    est.dataset.fase = `Acoplando con Vina (exhaustividad ${exh}; suele tardar 1-3 min)`;
    const r = await acoplar({ receptor: E.recPdbqt, ligando: lig, caja: E.ficha.caja, exhaustividad: exh });
    const poses = separarPoses(r.pdbqt);
    E.resultado = {
      diana: E.clave, nombre, smiles: smi, hipotesis: hip, exhaustividad: exh,
      kcal: r.poses[0].kcal, le: +(-r.poses[0].kcal / d.pesados).toFixed(3),
      energias: r.poses.map((p) => p.kcal), poses, desc: d, tanimoto: E.tanimoto, segundos: Math.round(r.segundos),
    };
    E.poseSel = 0;
    mostrarPoses();
    toast(`Docking terminado en ${Math.round(r.segundos)} s`);
  } catch (e) {
    console.error(e);
    est.dataset.fase = "Error: " + e.message;
    toast("El docking ha fallado: " + e.message, 6000);
  } finally {
    clearInterval(reloj);
    est.textContent = est.dataset.fase.startsWith("Error") ? est.dataset.fase : `Listo (${Math.round((performance.now() - t0) / 1000)} s en total)`;
    prog.hidden = true;
    btn.disabled = false;
  }
}

/** Interacciones ancla del cristal: coordinación metálica, puentes salinos y catión-π. */
function anclas() {
  return [...E.refInter.residuos.values()].filter((x) => TIPOS[x.tipo].prioridad >= TIPOS.cationpi.prioridad);
}

function conservaAnclas(pdbqt) {
  const a = anclas();
  if (!a.length) return null;
  const inter = calcular(E.recAtomos, leerPdbqt(pdbqt));
  return a.every((x) => inter.residuos.get(x.clave)?.tipo === x.tipo);
}

function mostrarPoses() {
  const r = E.resultado;
  r.anclaje ??= r.poses.map(conservaAnclas);
  const a = anclas();
  const titulo = a.length ? `Marcadas con ⚓: conservan ${a.map((x) => `${TIPOS[x.tipo].etiqueta} con ${x.res}${x.num}`).join(" y ")}, como el cristal` : "";
  $("#poses").innerHTML = `<span class="sub" style="align-self:center" title="${esc(titulo)}">Poses${a.length ? " (⚓ = anclaje del cristal)" : ""}:</span>` + r.energias
    .map((k, i) => `<button class="btn peq ${i === E.poseSel ? "teal" : ""}" data-i="${i}" title="${r.anclaje[i] ? esc(titulo) : ""}">${i + 1} · ${fmt(k, 1)}${r.anclaje[i] ? " ⚓" : ""}</button>`)
    .join("");
  for (const b of document.querySelectorAll("#poses button")) b.onclick = () => { E.poseSel = +b.dataset.i; mostrarPoses(); };
  E.visor.pose("analogo", r.poses[E.poseSel], COLOR_POSE);
  const inter = calcular(E.recAtomos, leerPdbqt(r.poses[E.poseSel]));
  r.comparacion = comparar(E.refInter, inter);
  r.kcalSel = r.energias[E.poseSel];
  E.paresActuales = inter.pares;
  mostrarInteracciones(r);
  pintarInteracciones();
}

function pintarInteracciones() {
  const pares = E.paresActuales ?? E.refInter.pares;
  E.visor.interacciones(pares);
}

function mostrarInteracciones(r) {
  const f = E.ficha;
  const filas = r ? r.comparacion : comparar(E.refInter, E.refInter);
  const ref = E.serie.find((x) => x.referencia);
  const badge = (t) => (t ? `<span class="punto" style="background:${TIPOS[t].color}"></span>${TIPOS[t].etiqueta}` : "—");
  $("#t-inter").innerHTML = `<thead><tr><th>Residuo</th><th>${esc(f.ligando)} (cristal)</th>${r ? "<th>Análogo</th><th>Cambio</th>" : ""}</tr></thead><tbody>` +
    filas.map((x) => `<tr><td class="mono">${x.res}${x.num}</td><td>${badge(x.ref)}</td>${r ? `<td>${badge(x.ana)}</td><td class="estado ${x.estado}">${x.estado}</td>` : ""}</tr>`).join("") +
    "</tbody>";
  if (!r) {
    E.paresActuales = null;
    $("#res-resumen").innerHTML = `<p class="sub">Interacciones del ligando del cristal (${esc(f.ligando)}). Vina lo puntúa con
      <b class="num">${fmt(ref?.vina_kcal_mol ?? f.redocking.vina_kcal_mol[0])}</b> kcal/mol${ref?.pchembl ? ` y su pChEMBL experimental es <b class="num">${fmt(ref.pchembl)}</b>` : ""}.
      Al acoplar un análogo, esta tabla mostrará qué interacciones se conservan, se pierden o aparecen.</p>`;
    $("#res-acciones").innerHTML = "";
    return;
  }
  const refKcal = ref?.vina_kcal_mol ?? f.redocking.vina_kcal_mol[0];
  const dif = r.kcalSel - refKcal;
  const n = (e) => filas.filter((x) => x.estado === e).length;
  $("#res-resumen").innerHTML = `
    <div class="props" style="grid-template-columns:repeat(3,1fr)">
      <div class="prop"><b>${fmt(r.kcalSel)}</b><span>kcal/mol (pose ${E.poseSel + 1})</span></div>
      <div class="prop"><b>${dif > 0 ? "+" : ""}${fmt(dif)}</b><span>Δ frente a ${esc(f.ligando)}</span></div>
      <div class="prop"><b>${fmt(-r.kcalSel / r.desc.pesados, 3)}</b><span>Eficiencia de ligando</span></div>
    </div>
    <p class="sub">${n("perdida")} perdidas · ${n("nueva")} nuevas · ${n("debilitada")} debilitadas · ${n("reforzada")} reforzadas.
    ${Math.abs(dif) < 1 ? "La diferencia es menor que el error típico de Vina (1-2 kcal/mol): no la sobreinterpretéis." : ""}</p>`;
  $("#res-acciones").innerHTML = `
    <label for="concl">Conclusión del grupo (se puede completar después)</label>
    <textarea id="concl" rows="3" placeholder="¿Se confirma la hipótesis? ¿Qué interacción explica el cambio?"></textarea>
    <div class="fila" style="margin-top:8px">
      <button class="btn teal" id="b-guardar">Guardar en el cuaderno</button>
      <button class="btn ia" id="b-ia-res">Discutir el resultado con la IA</button>
    </div>`;
  $("#b-guardar").onclick = () => {
    const e = cuaderno.añadir({
      ...r, poseSel: E.poseSel, kcal: r.kcalSel, le: +(-r.kcalSel / r.desc.pesados).toFixed(3),
      conclusion: $("#concl").value.trim(),
    });
    toast(`«${e.nombre}» guardado en el cuaderno`);
    $("#nombre").value = "";
  };
  $("#b-ia-res").onclick = () => preguntarIA("Discusión del resultado", promptResultado(f, { ...r, kcal: r.kcalSel }, filas, E.serie));
}

async function superponerSerie(slug) {
  E.visor.quitarPose("serie");
  if (!slug) return;
  try {
    const txt = await getText(`data/${E.clave}/serie/${slug}.pdbqt`);
    E.visor.pose("serie", txt, COLOR_SERIE);
    const f = E.serie.find((x) => x.slug === slug);
    toast(`${f.nombre}: ${fmt(f.vina_kcal_mol)} kcal/mol${f.pchembl ? ` · pChEMBL ${fmt(f.pchembl)}` : ""}`);
  } catch {
    toast("No hay pose precalculada para este fármaco");
  }
}

/** Abre en el laboratorio un análogo guardado. */
async function verEntrada(id) {
  const e = cuaderno.get().entradas.find((x) => x.id === id);
  if (!e) return;
  cuaderno.datos({ diana: e.diana });
  cabecera();
  if (location.hash !== "#/lab") location.hash = "#/lab";
  await pantallaLab(seccion("lab"));
  $("#nombre").value = e.nombre;
  $("#hip").value = e.hipotesis;
  await cambiarSmiles(e.smiles);
  E.resultado = { ...e };
  E.poseSel = e.poseSel ?? 0;
  mostrarPoses();
}

// ================================================================ 3 · TABLA SAR
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b) / n;
  const my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

function grafico(puntos) {
  const W = 400, H = 300, m = { l: 46, r: 14, t: 14, b: 40 };
  if (puntos.length < 2) return `<p class="sub">Hacen falta al menos dos fármacos con pChEMBL para el gráfico.</p>`;
  const xs = puntos.map((p) => p.x), ys = puntos.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs) - 0.5, Math.max(...xs) + 0.5];
  const [y0, y1] = [Math.floor(Math.min(...ys) - 0.3), Math.ceil(Math.max(...ys) + 0.3)];
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ticks = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const r = pearson(xs, ys);
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Puntuación Vina frente a pChEMBL">
    ${ticks(y0, y1, 4).map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="#e2e8f0"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, 1)}</text>`).join("")}
    ${ticks(x0, x1, 4).map((t) => `<text x="${X(t)}" y="${H - m.b + 16}" text-anchor="middle">${fmt(t, 1)}</text>`).join("")}
    <text x="${(W + m.l) / 2}" y="${H - 6}" text-anchor="middle">Vina (kcal/mol) · más negativo = mejor</text>
    <text transform="translate(12 ${(H - m.b) / 2}) rotate(-90)" text-anchor="middle">pChEMBL (experimental)</text>
    ${puntos.map((p) => `<g><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="5.5" fill="${p.ref ? "#10b981" : "#1e3a8a"}" stroke="#fff" stroke-width="1.5"><title>${esc(p.n)}: ${fmt(p.x)} kcal/mol · pChEMBL ${fmt(p.y)}</title></circle>
      <text x="${X(p.x) + 8}" y="${Y(p.y) - 6}" style="font-size:10px">${esc(p.n)}</text></g>`).join("")}
  </svg>
  <p class="sub">Correlación de Pearson: <b class="num">r = ${r == null ? "—" : fmt(r)}</b> (n = ${puntos.length}).
  Esperamos r negativo si Vina ordena bien (más negativo, más potente). Con docking, |r| &lt; 0,5 es lo habitual.</p>`;
}

async function pantallaSAR(s) {
  const clave = cuaderno.get().diana;
  if (!clave) return sinDiana(s);
  await cargarDiana(clave);
  const f = E.ficha;
  const ent = cuaderno.entradas(clave);
  const ref = E.serie.find((x) => x.referencia);
  const filas = [
    ...E.serie.map((x) => ({ tipo: "serie", nombre: x.nombre, smiles: x.smiles_ph74, kcal: x.vina_kcal_mol, le: x.le, pchembl: x.pchembl, tipos: x.tipos?.join("/"), mw: x.mw, ref: x.referencia })),
    ...ent.map((e) => ({ tipo: "diseño", nombre: e.nombre, smiles: e.smiles, kcal: e.kcal, le: e.le, pchembl: null, mw: e.desc?.mw, clogp: e.desc?.clogp, tpsa: e.desc?.tpsa, hip: e.hipotesis, tan: e.tanimoto })),
  ];
  s.innerHTML = `
    <div class="cab-diana"><h2>Tabla SAR · ${esc(f.diana)}</h2>
      <button class="btn peq" id="b-csv">Exportar CSV</button>
      <button class="btn ia peq" id="b-ia-serie">Analizar la serie con la IA</button></div>
    <div class="sar-grid">
      <div class="card" style="padding:0"><div class="tabla-scroll" style="max-height:none;border:none">
        <table><thead><tr><th>Estructura</th><th>Nombre</th><th>Origen</th><th class="num">Vina</th><th class="num">EL</th><th class="num">ΔVina</th><th class="num">pChEMBL</th><th class="num">MW</th><th>Cambio / hipótesis</th></tr></thead>
        <tbody>${filas.map((x, i) => `<tr class="${x.ref ? "ref" : ""} ${x.tipo === "diseño" ? "diseno" : ""}">
          <td class="mol" data-i="${i}"></td><td><b>${esc(x.nombre)}</b></td>
          <td>${x.tipo === "serie" ? `<span class="chip">${x.ref ? "cristal" : "fármaco"}</span>` : `<span class="chip amber">diseño</span>`}</td>
          <td class="num">${fmt(x.kcal)}</td><td class="num">${fmt(x.le, 3)}</td>
          <td class="num">${ref ? (x.kcal - ref.vina_kcal_mol > 0 ? "+" : "") + fmt(x.kcal - ref.vina_kcal_mol) : "—"}</td>
          <td class="num">${x.pchembl ? `${fmt(x.pchembl)} <small>${esc(x.tipos ?? "")}</small>` : "—"}</td>
          <td class="num">${fmt(x.mw, 0)}</td><td><small>${esc(x.hip ?? "")}</small></td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="card"><h3>¿Ordena Vina como el experimento?</h3>
        ${grafico(E.serie.filter((x) => x.pchembl).map((x) => ({ x: x.vina_kcal_mol, y: x.pchembl, n: x.nombre, ref: x.referencia })))}
        <p class="sub">EL: eficiencia de ligando, −ΔG/átomos pesados (kcal/mol). pChEMBL: −log₁₀ de Ki, IC₅₀, Kd o EC₅₀ (mediana de ChEMBL, proteína humana).
        La puntuación de Vina no es una afinidad: sirve para comparar poses y tendencias dentro de una serie.</p>
      </div>
    </div>`;
  filas.forEach((x, i) => miniatura(x.smiles).then((v) => { const td = s.querySelector(`td.mol[data-i="${i}"]`); if (td && v) td.innerHTML = v; }));
  $("#b-csv", s).onclick = () =>
    descargar(`SAR_${clave}_${cuaderno.get().grupo || "grupo"}.csv`, csv(filas.map((x) => ({
      nombre: x.nombre, origen: x.tipo, smiles: x.smiles, vina_kcal_mol: x.kcal, eficiencia_ligando: x.le,
      pchembl: x.pchembl ?? "", mw: x.mw ?? "", hipotesis: x.hip ?? "",
    }))), "text/csv;charset=utf-8");
  $("#b-ia-serie", s).onclick = () => preguntarIA("Análisis de la serie", promptSerie(f, E.serie, ent));
}

// ================================================================ 4 · CUADERNO
function pdbqtAPdb(pdbqt, resn = "LIG") {
  return pdbqt.split("\n").filter((l) => /^(ATOM|HETATM)/.test(l)).map((l) => {
    const t = l.slice(77, 79).trim();
    const el = ({ A: "C", OA: "O", NA: "N", HD: "H", SA: "S" }[t] ?? t).toUpperCase().padStart(2);
    return `HETATM${l.slice(6, 17)}${resn} L 900${l.slice(26, 54)}  1.00  0.00          ${el}`;
  }).join("\n");
}

async function pantallaCuaderno(s) {
  const c = cuaderno.get();
  const ent = c.entradas;
  s.innerHTML = `
    <div class="cab-diana"><h2>Cuaderno del grupo ${esc(c.grupo)}</h2>
      <button class="btn primario peq" id="b-exp">Exportar cuaderno (.json)</button>
      <label class="btn peq" style="margin:0">Importar / fusionar<input type="file" id="f-imp" accept=".json,application/json" hidden></label>
      <button class="btn peq" id="b-vaciar" style="margin-left:auto">Vaciar este navegador</button></div>
    <div class="aviso info">El cuaderno vive en este navegador. Exportadlo al terminar cada sesión y compartid el .json en el grupo;
      al importarlo se añaden las entradas que falten. En la entrega final adjuntad el .json exportado.</div>
    <div class="card" style="margin-bottom:14px">
      <label for="c-notas" style="margin-top:0">Notas del grupo (farmacóforo, decisiones, reparto de tareas)</label>
      <textarea id="c-notas" rows="4">${esc(c.notas)}</textarea>
      <p class="sub" style="margin-top:6px">Consultas a la IA registradas: <b>${(c.ia ?? []).length}</b>. Se exportan con el cuaderno para la declaración de uso de IA.</p>
    </div>
    <div id="lista-ent">${ent.length ? "" : `<div class="card vacio">Todavía no hay análogos guardados. Acoplad uno en el Laboratorio y pulsad «Guardar en el cuaderno».</div>`}</div>`;
  $("#c-notas", s).oninput = (e) => cuaderno.datos({ notas: e.target.value });
  $("#b-exp", s).onclick = () => descargar(`cuaderno_SARDock_${c.grupo || "grupo"}_${new Date().toISOString().slice(0, 10)}.json`, cuaderno.exportar());
  $("#f-imp", s).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const n = cuaderno.importar(await file.text());
      toast(`${n} entradas nuevas importadas`);
      cabecera();
      pantallaCuaderno(s);
    } catch (err) {
      toast("No se pudo importar: " + err.message, 5000);
    }
  };
  $("#b-vaciar", s).onclick = () => {
    if (confirm("Se borrará el cuaderno de ESTE navegador. ¿Habéis exportado una copia?")) { cuaderno.vaciar(); cabecera(); pantallaCuaderno(s); }
  };
  const lista = $("#lista-ent", s);
  for (const e of [...ent].reverse()) {
    const d = E.dianas.find((x) => x.clave === e.diana);
    const div = document.createElement("div");
    div.className = "entrada";
    div.innerHTML = `
      <div class="estructura"></div>
      <div>
        <div class="fila"><h3 style="margin:0">${esc(e.nombre)}</h3>
          <span class="chip">${esc(d?.diana ?? e.diana)}</span>
          <span class="chip teal num">${fmt(e.kcal)} kcal/mol</span>
          <span class="chip num">EL ${fmt(e.le, 3)}</span>
          <span class="sub">${new Date(e.fecha).toLocaleString("es-ES")}</span></div>
        <p class="mono" style="font-size:.78rem;word-break:break-all;margin:4px 0">${esc(e.smiles)}</p>
        <p><b>Hipótesis:</b> ${esc(e.hipotesis)}</p>
        <label>Conclusión</label><textarea rows="2" data-id="${e.id}">${esc(e.conclusion)}</textarea>
        <div class="fila" style="margin-top:8px">
          <button class="btn peq" data-ver="${e.id}">Ver en el laboratorio</button>
          <button class="btn peq" data-pdb="${e.id}">Complejo (.pdb)</button>
          <button class="btn peq" data-borrar="${e.id}" style="margin-left:auto">Borrar</button>
        </div>
      </div>`;
    lista.appendChild(div);
    miniatura(e.smiles).then((v) => v && ($(".estructura", div).innerHTML = v));
  }
  lista.oninput = (ev) => { if (ev.target.dataset.id) cuaderno.actualizar(ev.target.dataset.id, { conclusion: ev.target.value }); };
  lista.onclick = async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.ver) verEntrada(b.dataset.ver);
    if (b.dataset.borrar && confirm("¿Borrar este análogo del cuaderno?")) { cuaderno.borrar(b.dataset.borrar); pantallaCuaderno(s); }
    if (b.dataset.pdb) {
      const e = ent.find((x) => x.id === b.dataset.pdb);
      const rec = await getText(`data/${e.diana}/receptor.pdb`);
      const atomos = rec.split("\n").filter((l) => /^(ATOM|HETATM)/.test(l)).join("\n");
      descargar(`${e.diana}_${e.nombre.replace(/\W+/g, "_")}.pdb`,
        `REMARK   QFDOS SAR-Dock · ${e.nombre} · ${e.kcal} kcal/mol\n${atomos}\nTER\n${pdbqtAPdb(e.poses[e.poseSel ?? 0])}\nEND\n`, "chemical/x-pdb");
    }
  };
}

// ================================================================ 5 · GUÍA
async function pantallaGuia(s) {
  if (s.dataset.ok) return;
  s.innerHTML = `<div class="dos guia">
    <div class="card">
      <h2>Cómo trabajar</h2>
      <h3>Fase 1 · Diana y validación</h3>
      <ul><li>Leed la ficha de la diana y localizad en el visor los residuos clave.</li>
        <li>Pedid a la IA (botón «Preguntar a la IA por el farmacóforo») una primera propuesta de farmacóforo y contrastadla con el visor y con el artículo del cristal.</li>
        <li>Fijaos en el RMSD del redocking: indica si Vina reproduce la pose del cristal en esta diana.</li></ul>
      <h3>Fase 2 · SAR conocido</h3>
      <ul><li>Superponed los fármacos de la serie (ya acoplados) y comparad sus interacciones con las del cristal.</li>
        <li>En la Tabla SAR, comparad la puntuación de Vina con la potencia experimental (pChEMBL).</li></ul>
      <h3>Fase 3 · Diseño</h3>
      <ul><li>Partid de la referencia y haced <b>un solo cambio</b> por análogo: bioisóstero, eliminar o mover un grupo, homólogo, rigidización, estereoisómero.</li>
        <li>Escribid la hipótesis <b>antes</b> de acoplar. El panel no deja acoplar sin ella.</li>
        <li>Acoplad, revisad varias poses, comparad interacciones y guardad la conclusión.</li></ul>
      <h3>Fase 4 · Defensa</h3>
      <ul><li>Exportad el cuaderno (.json), la Tabla SAR (.csv) y las imágenes que uséis.</li></ul>
      <h3>Lo que el docking no dice</h3>
      <p>Vina estima una energía de unión con una función empírica: no ve el agua, apenas la entropía, trata el receptor
      como rígido y su error ronda 1-2 kcal/mol. Usadlo para generar y descartar hipótesis estructurales, no para predecir
      potencias. Diferencias menores de 1 kcal/mol no significan nada por sí solas.</p>
    </div>
    <div class="card">
      <h2>IA con vuestra cuenta UGR</h2>
      <p>Con la cuenta <b>@go.ugr.es</b> tenéis Gemini y NotebookLM (Google Workspace de la UGR) y Microsoft Copilot.
      Esta página no envía nada a ninguna IA: los botones «IA» copian un texto con el contexto de vuestra diana y lo pegáis vosotros.</p>
      <div class="fila" style="margin:10px 0">${Object.keys(E.notebooks).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((t) => enlaceCuadernoTema(t, "btn teal")).join("")}${ENLACES.map((e) => `<a class="btn ia" href="${e.url}" target="_blank" rel="noopener" title="${esc(e.nota)}">${e.nombre}</a>`).join("")}</div>
      <h3>Para qué sí</h3>
      <ul><li><b>NotebookLM</b>: los temas que ya tienen cuaderno del curso aparecen enlazados aquí y en el laboratorio. Usadlo como punto de partida
        y cread además vuestro propio cuaderno con el artículo del cristal y una revisión de SAR de la familia, para preguntar con fuentes citadas.</li>
        <li><b>Gemini o Copilot</b>: proponer modificaciones razonadas, discutir resultados, revisar la química de una idea.</li>
        <li>Pedidle estructuras <b>en SMILES</b> y comprobadlas aquí: si el SMILES no es válido o la molécula no es la que dice, se ve al instante.</li></ul>
      <h3>Para qué no</h3>
      <ul><li>Redactar el informe o la presentación.</li>
        <li>Inventar datos: cualquier Ki, IC₅₀ o referencia que dé la IA se comprueba en ChEMBL, PubMed o el artículo original.</li></ul>
      <h3>Declaración</h3>
      <p>El cuaderno registra los textos enviados desde los botones de IA. En el informe, una tabla con qué herramienta,
      para qué y qué parte del resultado usasteis.</p>
    </div></div>`;
  s.dataset.ok = "1";
}

// ---------------------------------------------------------------- arranque
async function iniciar() {
  try {
    E.dianas = await getJSON("data/dianas.json");
    E.notebooks = await getJSON("data/notebooks.json").catch(() => ({}));
  } catch (e) {
    app.innerHTML = `<div class="aviso warn">No se pudieron cargar los datos de las dianas (${esc(e.message)}).</div>`;
    return;
  }
  rdkit(); // empieza a cargar RDKit.js en segundo plano
  cabecera();
  addEventListener("hashchange", navegar);
  navegar();
}

iniciar();
