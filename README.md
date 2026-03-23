# con§tel

Herramienta de análisis temático de corpus textuales. Sirve tanto para el estudio de textos filosóficos como para el análisis de entrevistas de investigación.

## Modelo conceptual

con§tel formaliza el acto de lectura activa en 5 entidades:

| Entidad | Símbolo | Descripción |
|---------|---------|-------------|
| **source** | — | Texto fuente (entrevista, texto filosófico, etc.) |
| **excerpt** | § | Pasaje seleccionado dentro de un source |
| **concept** | [a] | Etiqueta o ancla asignada a un excerpt |
| **theme** | — | Agrupación de concepts afines (tesauro) |
| **note** | {n} | Texto emergente del investigador/lector |

La relación central: `excerpt ◂──▸ concept` es muchos-a-muchos. Los concepts se agrupan en themes, y las notes son la destilación — el texto propio que emerge del análisis.

## Arquitectura

- **3 pestañas** con split-view:
  1. **Fuentes**: listado del corpus con metadatos y vista previa
  2. **Lector**: texto completo con selección, etiquetado y minimap de densidad
  3. **Mapa**: grafo force-directed de conceptos + gestión de temas + editor de notas

- **Mapa semántico**: la proximidad entre conceptos emerge de los datos
  - Enlace fuerte: dos concepts etiquetan el mismo excerpt
  - Enlace débil: dos concepts aparecen en el mismo source
  - La distancia es inversamente proporcional al peso → más co-ocurrencia = más cercanía

## Stack técnico

- Vanilla JavaScript (ES6 modules), HTML5, CSS3
- Node.js con HTTP nativo (sin frameworks)
- D3.js para el grafo de conceptos
- Persistencia en JSON (`data/constel-db.json`)
- Sin build step, sin dependencias npm en el cliente

## Instalación y uso

### Requisito previo: Node.js

con§tel necesita [Node.js](https://nodejs.org/) (v18 o superior) para funcionar. Node.js es un programa que permite ejecutar JavaScript fuera del navegador — en este caso, actúa como el servidor local que sirve la aplicación.

**Para verificar si ya lo tienes instalado**, abre la Terminal (macOS) o PowerShell (Windows) y escribe:

```bash
node --version
```

Si aparece algo como `v18.x.x` o superior, ya está listo. Si dice "command not found", descárgalo desde [nodejs.org](https://nodejs.org/) (elige la versión LTS) e instálalo como cualquier aplicación.

### Puesta en marcha

1. **Descarga el proyecto.** Puedes [descargar el ZIP](https://github.com/hspencer/constel/archive/refs/heads/main.zip) y descomprimirlo, o si usas git:

    ```bash
    git clone https://github.com/hspencer/constel.git
    ```

2. **Coloca tus textos** en la carpeta `corpus/` dentro del proyecto. Pueden ser archivos `.txt` o `.md`. El proyecto incluye textos de ejemplo que puedes reemplazar o complementar.

3. **Abre la Terminal** y navega hasta la carpeta del proyecto:

    ```bash
    cd ruta/a/constel
    ```

    En macOS puedes arrastrar la carpeta a la Terminal para obtener la ruta automáticamente.

4. **Inicia el servidor:**

    ```bash
    node server.mjs
    ```

    Verás un mensaje como:

    ```text
      con§tel — http://127.0.0.1:8787
    ```

5. **Abre el navegador** (Chrome, Firefox, Safari) y ve a la dirección que aparece:

    [http://127.0.0.1:8787](http://127.0.0.1:8787)

6. **Para detener el servidor**, vuelve a la Terminal y presiona `Ctrl + C`.

### Iniciar un proyecto propio

El repositorio incluye textos de ejemplo (corpus de Amereida) para que puedas explorar la interfaz. Cuando quieras empezar tu propio análisis con tus propios textos, ejecuta:

```bash
npm run init
```

Esto borra los textos de ejemplo y resetea la base de datos. El script te muestra qué se va a eliminar y pide confirmación antes de proceder:

```text
  con§tel — inicializar proyecto nuevo

  Se eliminará:
    9 textos en corpus/
    Base de datos (9 fuentes, 176 excerpts, 57 conceptos)
    3 snapshots en data/versions/

  ¿Continuar? (s/n)
```

Después de inicializar, solo coloca tus textos (`.txt` o `.md`) en la carpeta `corpus/` y ejecuta `npm start`.

### Estructura de carpetas

```text
constel/
├── corpus/          ← tus textos van aquí (.txt o .md)
├── data/
│   └── constel-db.json   ← la base de datos (se genera sola)
├── public/          ← la aplicación web (no tocar)
├── scripts/         ← herramientas de automatización
└── server.mjs       ← el servidor
```

### Metadatos con frontmatter (opcional)

Los archivos de texto pueden incluir un encabezado YAML para aportar metadatos. Esto es especialmente útil para entrevistas anonimizadas:

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

Los campos del frontmatter se importan automáticamente al agregar el texto en la pestaña Fuentes. También pueden editarse después desde el botón de edición (✎) en cada tarjeta.

## Flujo de trabajo

1. **Importar** textos desde `corpus/` en la pestaña Fuentes
2. **Leer** un texto y seleccionar pasajes significativos
3. **Etiquetar** cada pasaje con un concepto (autocomplete fuzzy para vocabulario controlado)
4. **Agrupar** conceptos en temas en la pestaña Mapa
5. **Escribir** notas de síntesis — el texto emergente del investigador

## Anotación asistida por IA

El script `scripts/auto-annotate.mjs` automatiza la marcación de excerpts y conceptos en un documento usando [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). El proceso es interactivo en dos pasos: la IA propone, el investigador ajusta.

### Requisitos

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) instalado y autenticado (`claude` disponible en el PATH)
- El documento debe estar importado como source en la pestaña Fuentes

### Uso básico

```bash
# Prueba sin modificar la base de datos
node scripts/auto-annotate.mjs "1983 - América, Américas Mías.txt" --dry-run

# Ejecución real (modifica constel-db.json, con backup automático)
node scripts/auto-annotate.mjs "1983 - América, Américas Mías.txt"
```

### Flujo del script

#### Paso 1 — Propuesta de conceptos

Claude analiza el texto completo y devuelve dos listas:

```text
── Conceptos existentes detectados ──
  1. identidad americana — pregunta recurrente por el ser americano
  2. nostalgia — "las nostalgias matan"
  3. la proeza — cruce poético de Tierra del Fuego a Caracas
  4. fundar — Santa Cruz como capital poética de América Latina

── Conceptos nuevos sugeridos ──
  a. salvacionismo — anhelo salvífico que permea todo discurso americano
  b. guerra de buhardillas — metáfora del trabajo creativo silencioso
  c. imperio — concepto virgiliano de apertura, no dominio
```

#### Paso 2 — Revisión interactiva

Después de la propuesta, el script muestra la lista completa y espera tu input en el prompt `>`. Tienes 5 opciones:

| Comando | Acción | Ejemplo |
|---------|--------|---------|
| `ok` | **Aceptar la lista tal cual** y pasar a generar excerpts | `> ok` |
| `Enter` | Igual que `ok` — acepta todo | _(solo presionar Enter)_ |
| `-N` | Eliminar un concepto existente por su número | `> -3` elimina el #3 |
| `-a` | Eliminar un concepto nuevo sugerido por su letra | `> -b` elimina el (b) |
| `+palabra` | Agregar un concepto manualmente | `> +el juego` |
| `abort` | Cancelar todo el proceso | `> abort` |

Puedes ejecutar varios comandos seguidos antes de confirmar. El script muestra la lista actualizada después de cada cambio.

**Aceptar todo sin cambios** (caso más común):

```text
── Lista actual ──
  Existentes: identidad americana, nostalgia, la proeza, fundar
  Nuevos: salvacionismo, guerra de buhardillas, imperio

  > ok

✅ 7 conceptos confirmados
```

**Ajustar la lista antes de confirmar:**

```text
── Lista actual ──
  Existentes: identidad americana, nostalgia, la proeza, fundar
  Nuevos: salvacionismo, guerra de buhardillas, imperio

  > -2                              # eliminar "nostalgia" (número 2)
    ✕ Eliminado: "nostalgia"

── Lista actual ──
  Existentes: identidad americana, la proeza, fundar
  Nuevos: salvacionismo, guerra de buhardillas, imperio

  > -c                              # eliminar "imperio" (letra c)
    ✕ Eliminado nuevo: "imperio"

  > +el juego                       # agregar (ya existe en la DB)
    ✓ Agregado (existente): "el juego"

  > +la unidad perdida              # agregar (no existe → se creará)
    ✓ Agregado (nuevo): "la unidad perdida"

  > ok                              # confirmar lista final

✅ 6 conceptos confirmados: identidad americana, la proeza, fundar,
   el juego, salvacionismo, la unidad perdida
```

#### Paso 3 — Generación de excerpts

Claude recorre el texto con la lista curada y genera excerpts con:

- Texto exacto copiado del original (validado por offset de caracteres)
- 1-3 conceptos asignados de la lista aprobada
- Sin solapamiento entre excerpts
- Cobertura objetivo: 60-70% del texto significativo

```text
═══ PASO 2: Generación de excerpts ═══

  ✅ [0-312] identidad americana
     "Querido Godofredo: En verdad, sólo a ti puedo escribirte..."
  ✅ [315-620] identidad americana, salvacionismo
     "¿No te sedujo a ti, alguna vez, la sensualidad de un origen..."
  ✅ [1840-2105] fundar, la proeza
     "¿no hiciste tú junto a poetas, artistas, arquitectos..."
  🆕 Nuevo concepto: "la unidad perdida"
  ✅ [2340-2580] la unidad perdida
     "Tal vez parecemos o parecíamos fantasmas que desde la independencia..."

═══ Resultados ═══
  Excerpts agregados:  18
  Conceptos creados:   2
  Omitidos (overlap):  1
  Fallidos (offset):   0
  Total excerpts:      18 (este documento)
  Cobertura del texto: 64.2%
  Total conceptos DB:  59
```

### Notas

- El script **requiere que el servidor esté corriendo** (`node server.mjs`) — guarda los cambios via API, lo que evita conflictos con el navegador abierto
- Los conceptos que ya existen en la DB se reutilizan por label (sin duplicados)
- Usa `--dry-run` para inspeccionar los resultados sin escribir nada
- Si un excerpt no se localiza exactamente en el texto original, se omite (sin datos corruptos)
- Los conceptos se procesan en tandas de 3 para evitar respuestas truncadas
- Después de ejecutar el script, **recarga la página** del navegador para ver los cambios

## Origen

con§tel nace como proyecto de investigación en la e[ad] Escuela de Arquitectura y Diseño de la PUCV (2004-2006), preguntándose por la forma escolástica de leer, anotar y extender un corpus textual común en la pantalla digital. La hipótesis: la interacción produce un espacio semántico.

Esta versión generaliza la mecánica original para servir como herramienta de análisis temático (Braun & Clarke) aplicable a cualquier corpus textual.

## Licencia

MIT
