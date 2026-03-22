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

## Uso

```bash
# clonar
git clone https://github.com/hspencer/constel.git
cd constel

# colocar textos en la carpeta corpus/
cp mis-textos/*.txt corpus/

# iniciar servidor
node server.mjs

# abrir en el navegador
open http://127.0.0.1:8787
```

## Flujo de trabajo

1. **Importar** textos desde `corpus/` en la pestaña Fuentes
2. **Leer** un texto y seleccionar pasajes significativos
3. **Etiquetar** cada pasaje con un concepto (autocomplete fuzzy para vocabulario controlado)
4. **Agrupar** conceptos en temas en la pestaña Mapa
5. **Escribir** notas de síntesis — el texto emergente del investigador

## Origen

con§tel nace como proyecto de investigación en la e[ad] Escuela de Arquitectura y Diseño de la PUCV (2004-2006), preguntándose por la forma escolástica de leer, anotar y extender un corpus textual común en la pantalla digital. La hipótesis: la interacción produce un espacio semántico.

Esta versión generaliza la mecánica original para servir como herramienta de análisis temático (Braun & Clarke) aplicable a cualquier corpus textual.

## Licencia

MIT
