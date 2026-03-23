# con§tel

Herramienta de análisis temático de corpus textuales. Sirve tanto para el estudio de textos filosóficos como para el análisis de entrevistas de investigación.

![Pestaña Fuentes](docs/tab1.png)

## Modelo conceptual

con§tel formaliza el acto de lectura activa en 5 entidades:

| Entidad | Símbolo | Descripción |
|---------|---------|-------------|
| **source** | — | Texto fuente (entrevista, texto filosófico, etc.) |
| **excerpt** | § | Pasaje seleccionado dentro de un source |
| **concept** | [a] | Etiqueta o ancla asignada a un excerpt |
| **theme** | — | Agrupación de concepts afines (metacategoría) |
| **note** | {n} | Texto emergente del investigador/lector |

```
source  ──1:N──▸  excerpt
excerpt ◂──N:M──▸ concept    (un excerpt puede tener varios concepts y viceversa)
concept ──N:1──▸  theme      (cada concept pertenece a 1 theme, o ninguno)
theme   ──1:N──▸  note       (un theme puede tener múltiples notas)
```

La relación central `excerpt ◂──▸ concept` es muchos-a-muchos. Los concepts se agrupan en themes, y las notes son la destilación — el texto propio que emerge del análisis.

## Las 3 pestañas

### 1. Fuentes — el corpus

Lista los textos del corpus con sus metadatos (autor, fecha, notas). A la izquierda, las tarjetas de cada fuente muestran cuántos excerpts (§) tiene y una barra de progreso de cobertura. A la derecha, una vista previa del texto seleccionado.

- **Importar**: click en una tarjeta carga el texto desde `corpus/`
- **Editar metadatos**: botón ✎ abre un modal con título, autor, fecha, participante, rol, notas
- **Frontmatter YAML** opcional en cada `.txt` para aportar metadatos automáticamente

### 2. Lector — codificación in vivo

![Pestaña Lector](docs/tab2.png)

Tres paneles: glosa cronológica | minimap | texto.

**Glosa cronológica** (izquierda): lista vertical de todos los conceptos presentes en el texto, ordenados por primera aparición. Los conceptos que aparecen en múltiples pasajes son más prominentes (nivel 0 = más frecuente). El ancho del panel se ajusta con el resizer draggable.

**Minimap** (centro, 32px): barra vertical proporcional al largo del texto. Las bandas de color marcan la posición de cada excerpt. Click en cualquier punto del minimap salta al texto.

**Texto** (derecha): el texto completo con los excerpts subrayados. El flujo de trabajo:

1. **Seleccionar** un pasaje con el mouse
2. Aparece un **popup con input** y autocomplete fuzzy del vocabulario existente
3. **Escribir o elegir** un concepto → se crea el excerpt vinculado
4. El excerpt queda subrayado; al pasar el mouse aparece un **tooltip** con el nombre del concepto y botones para eliminar
5. Click en un concepto de la glosa abre el **panel de detalle** mostrando todas sus secciones separadas en "§ en este texto" y "en otros textos"
6. Desde el detalle se puede **renombrar**, **eliminar** el concepto, o **agregar más secciones**

### 3. Mapa — síntesis temática

![Pestaña Mapa](docs/tab3.png)

Dos paneles: grafo de conceptos | gestión de temas.

**Grafo force-directed** (izquierda): todos los conceptos del corpus como etiquetas de texto. Su tamaño tipográfico refleja la frecuencia (cantidad de excerpts × cantidad de fuentes donde aparece). Sin negrita, solo varía el tamaño (11px–31px).

#### Cómo se calcula la topología del mapa

La proximidad entre conceptos emerge de los datos, no de una definición manual:

- **Enlace fuerte** (co-excerpt): dos concepts etiquetan el mismo excerpt → peso ×3
- **Enlace débil** (co-source): dos concepts aparecen en el mismo texto → peso ×1
- **Enlace por proximidad** (co-window): dos concepts aparecen cerca en el texto (ventana de 500 chars) → peso ×0.5

La **distancia** entre nodos es inversamente proporcional al peso del enlace. Los conceptos semánticamente afines (que tienden a co-ocurrir) se atraen. Los que nunca aparecen juntos quedan en la periferia.

**Controles del mapa**:
- **Slider de distancia**: regula la resorticidad general del grafo
- **Toggle aristas**: mostrar/ocultar las líneas de conexión
- **Zoom y paneo**: rueda del mouse + arrastrar

**Panel de temas** (derecha): espacio de síntesis del investigador.

- **Crear tema**: nombrar una agrupación → seleccionar conceptos para incluir
- **Editar tema**: renombrar inline, toggle colapsable de conceptos contenidos
- **Nota de desarrollo**: textarea libre para escribir la síntesis en markdown
- **Secciones del tema**: lista de todos los excerpts agrupados, mostrando la cita completa, el concepto en negrita, y la fuente con flecha

El flujo es: conceptos sin tema → seleccionar varios → agrupar bajo un nombre → escribir la nota de síntesis. Esto corresponde a las fases 2-4 del análisis temático (Braun & Clarke): de los códigos axiales a la síntesis interpretativa.

## Filosofía: BBDD como texto

Todo el estado vive en un único archivo JSON (`data/constel-db.json`). No hay base de datos relacional. El archivo es legible, versionable con git, y trivial de copiar. Los textos fuente viven como `.txt` en `corpus/` y no se duplican.

Para crear una nueva instancia de análisis, basta copiar la carpeta:

```
~/Sites/constel-amereida/     ← instancia con textos filosóficos
~/Sites/constel-entrevistas/  ← instancia con entrevistas del doctorado
```

## Stack técnico

- Vanilla JavaScript (ES6 modules), HTML5, CSS3
- Node.js con HTTP nativo (sin frameworks)
- D3.js para el grafo de conceptos
- Persistencia en JSON (`data/constel-db.json`)
- Sin build step, sin dependencias npm en el cliente
- Google Fonts: Gabarito (UI) + Sorts Mill Goudy (lectura)

## Instalación y uso

### Requisito previo: Node.js

con§tel necesita [Node.js](https://nodejs.org/) (v18 o superior). Para verificar si ya lo tienes:

```bash
node --version
```

Si dice "command not found", descárgalo desde [nodejs.org](https://nodejs.org/) (versión LTS).

### Puesta en marcha

```bash
git clone https://github.com/hspencer/constel.git
cd constel
node server.mjs
```

Abre [http://127.0.0.1:8787](http://127.0.0.1:8787) en el navegador.

### Iniciar un proyecto propio

El repositorio incluye textos de ejemplo (corpus de Amereida). Para empezar con tus propios textos:

```bash
npm run init
```

Esto limpia los textos de ejemplo y resetea la base de datos (con confirmación). Después, coloca tus textos en `corpus/` y ejecuta `npm start`.

### Estructura de carpetas

```
constel/
├── corpus/          ← tus textos van aquí (.txt o .md)
├── data/
│   └── constel-db.json   ← la base de datos (se genera sola)
├── public/          ← la aplicación web
├── scripts/         ← herramientas de automatización
└── server.mjs       ← el servidor
```

### Metadatos con frontmatter (opcional)

```markdown
---
title: Entrevista participante P-07
author: Equipo de investigación
date: 2026-03-15
participant: P-07
role: diseñador senior
notes: Segunda sesión, contexto laboral
---

El texto del documento comienza aquí...
```

## Anotación asistida por IA

El script `scripts/auto-annotate.mjs` automatiza la marcación de excerpts y conceptos usando Claude Code CLI. El proceso es interactivo: la IA propone, el investigador ajusta.

```bash
# Vista previa sin modificar la base de datos
node scripts/auto-annotate.mjs "mi-texto.txt" --dry-run

# Ejecución real
node scripts/auto-annotate.mjs "mi-texto.txt"
```

El script analiza el texto, propone conceptos existentes y nuevos, permite eliminar o agregar desde el prompt, y genera excerpts con offsets verificados sobre el texto original.

## Origen

con§tel nace como proyecto de investigación en la e[ad] Escuela de Arquitectura y Diseño de la PUCV (2004-2006), preguntándose por la forma escolástica de leer, anotar y extender un corpus textual común en la pantalla digital. La hipótesis: la interacción produce un espacio semántico.

Esta versión generaliza la mecánica original para servir como herramienta de análisis temático (Braun & Clarke) aplicable a cualquier corpus textual.

## Licencia

MIT
