# QFDOS SAR-Dock

Panel de relaciones estructura-actividad y docking en el navegador para el trabajo SAR-Dock de
Química Farmacéutica II (Grupo E, Facultad de Farmacia, Universidad de Granada, curso 2026/2027).

Cada grupo de estudiantes elige una diana de uno de los temas, estudia el centro activo con el
ligando del cristal, compara la serie de fármacos del tema (docking frente a pChEMBL de ChEMBL) y
diseña análogos que acopla con AutoDock Vina en su propio ordenador.

## Estructura

```
web/                 sitio estático que se publica (GitHub Pages, .github/workflows/pages.yml)
  index.html, css/, js/, img/
  data/              dianas preparadas (receptor, ligando del cristal, caja, ficha, serie SAR)
  vendor/            librerías servidas desde el propio dominio (lo exige COEP)
tools/serve.py       servidor local con las cabeceras COOP/COEP
prep/                entorno de preparación (no se versiona salvo este README)
vercel.json          alternativa: despliegue en Vercel con cabeceras COOP/COEP reales
```

Los scripts que generan `web/data/` viven en el repositorio del curso (`jjdmochon/qfdos-2627`):
`scripts/preparar_dianas_dock.py` (receptor, caja, ficha y redocking de validación) y
`scripts/series_sar_dock.py` (serie de fármacos del tema con pChEMBL y su mejor pose).

## Publicación

Cada push a `main` publica `web/` en GitHub Pages. Pages no permite cabeceras propias, y el docking
necesita aislamiento entre orígenes (COOP/COEP) para usar SharedArrayBuffer: lo aporta
`web/coi-serviceworker.js`, que en la primera visita registra un service worker y recarga la página.

## Desarrollo local

```bash
py -3.14 tools/serve.py 8642
```

y abrir http://localhost:8642. El docking necesita `crossOriginIsolated === true` (Chrome o Edge
de escritorio).

## Regenerar las dianas

```bash
cd prep
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe rdkit meeko gemmi pdbfixer openmm requests scipy numpy
gh release download v1.2.7 --repo ccsb-scripps/AutoDock-Vina -p vina_1.2.7_win.exe -D bin
cd ..
prep/.venv/Scripts/python.exe "<repo del curso>/scripts/preparar_dianas_dock.py" --out web/data --vina C:/dev/qfdos-sar-dock/prep/bin/vina_1.2.7_win.exe
prep/.venv/Scripts/python.exe "<repo del curso>/scripts/series_sar_dock.py" --out web/data --vina C:/dev/qfdos-sar-dock/prep/bin/vina_1.2.7_win.exe
```

## Librerías de terceros (en `web/vendor/`)

| Librería | Versión | Licencia | Uso |
| --- | --- | --- | --- |
| Webina (AutoDock Vina 1.2.3 en WebAssembly), Durrant lab | 1.0.5 | Apache-2.0 | Docking |
| OpenBabel (WASM, distribuido con Webina 1.0.5) | la de Webina | GPL-2.0 | SMILES → 3D → PDBQT |
| 3Dmol.js | 2.5.5 | BSD-3-Clause | Visor 3D |
| RDKit.js (MinimalLib) | 2025.03.4 | BSD-3-Clause | Descriptores, dibujo 2D, similitud |
| JSME | 2024-04-29 | BSD-3-Clause | Editor de estructuras 2D |
| Montserrat y Roboto Mono (Fontsource) | variable | OFL-1.1 | Tipografía |
| coi-serviceworker | 0.1.7 | MIT | Cabeceras COOP/COEP en GitHub Pages |

Estructuras de RCSB PDB y datos de actividad de ChEMBL (CC BY-SA 3.0).
