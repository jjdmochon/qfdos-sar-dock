// Worker clásico: OpenBabel (WASM, GPL-2) convierte SMILES → 3D (MMFF94) → PDBQT sin bloquear la página.
const BASE = new URL("../vendor/openbabel/", self.location).href;
importScripts(BASE + "openbabel.js");

const listo = new Promise((ok) => {
  // Emscripten antiguo: el módulo es «thenable»; onRuntimeInitialized no se dispara.
  const M = self.OpenBabelModule({ locateFile: (p) => BASE + p, print: () => {}, printErr: () => {} });
  M.then(() => {
    delete M.then;
    ok(M);
  });
});

self.onmessage = async ({ data: { id, smiles, corregirPH } }) => {
  const OB = await listo;
  const conv = new OB.ObConversionWrapper();
  const mol = new OB.OBMol();
  try {
    conv.setInFormat("", "smi");
    conv.readString(mol, smiles);
    if (mol.NumAtoms() === 0) throw new Error("OpenBabel no entiende este SMILES");
    mol.AddHydrogensWithParam(false, !!corregirPH, 7.4);
    const gen = new OB.OB3DGenWrapper();
    gen.generate3DStructure(mol, "MMFF94");
    conv.setOutFormat("", "pdbqt");
    const pdbqt = conv.writeString(mol, false);
    if (!/ROOT/.test(pdbqt)) throw new Error("No se pudo generar el PDBQT del ligando");
    self.postMessage({ id, pdbqt });
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  } finally {
    mol.delete();
    conv.delete();
  }
};
