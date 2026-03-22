// concept-map.js — grafo force-directed D3.js de conceptos
// Modo título: los labels son las partículas, sin círculos.
// Tamaño tipográfico = f(excerptCount, sourceCount).
// forceCollide con bounding box del texto → sin traslape.

import { state, computeConceptGraph, getThemeColor } from "../state.js";

/**
 * Renderiza el mapa de conceptos en modo título.
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {string} [opts.sourceId] - filtrar a un source
 * @param {Function} opts.onClickConcept - (conceptId) => void
 * @returns {{ simulation, highlightNode(id), clearHighlight() } | null}
 */
export function renderConceptMap(container, opts = {}) {
  const d3 = window.d3;
  if (!d3) {
    container.innerHTML = `<p class="placeholder">D3.js no está cargado</p>`;
    return null;
  }

  const { nodes, links } = computeConceptGraph(opts.sourceId || null);
  if (!nodes.length) {
    container.innerHTML = `<p class="placeholder">Marca pasajes con conceptos para ver el mapa</p>`;
    return null;
  }

  container.innerHTML = "";
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 400;

  // ── Font size scale ──
  // Based on excerptCount (how many §) weighted by sourceCount (how many texts)
  const maxExc = Math.max(1, ...nodes.map(n => n.excerptCount));
  const maxSrc = Math.max(1, ...nodes.map(n => n.sourceCount));

  function fontSize(d) {
    // composite score: excerptCount contributes 60%, sourceCount 40%
    const score = (d.excerptCount / maxExc) * 0.6 + (d.sourceCount / maxSrc) * 0.4;
    return Math.round(11 + score * 20); // 11px to 31px
  }

  function fontWeight(d) {
    return d.sourceCount > 1 ? "700" : (d.excerptCount > 2 ? "600" : "400");
  }

  // ── SVG ──
  const svg = d3.select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height]);

  const g = svg.append("g");
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.3, 3])
    .on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoomBehavior);

  // ── Links ──
  const link = g.append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", d => `map-link ${d.shared > 0 ? "strong" : ""}`)
    .attr("stroke-width", d => Math.max(0.5, Math.min(3, d.weight * 0.5)));

  // ── Nodes (text only) ──
  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "map-node");

  node.append("text")
    .text(d => d.label)
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .style("font-size", d => `${fontSize(d)}px`)
    .style("font-weight", d => fontWeight(d))
    .style("fill", d => getThemeColor(d.themeId))
    .style("cursor", "pointer");

  // ── Measure text bounding boxes for collision ──
  const textSizes = new Map();
  node.each(function(d) {
    const textEl = this.querySelector("text");
    if (textEl) {
      const bbox = textEl.getBBox();
      textSizes.set(d.id, { w: bbox.width, h: bbox.height });
    }
  });

  function collideRadius(d) {
    const s = textSizes.get(d.id);
    if (!s) return 20;
    return Math.sqrt(s.w * s.w + s.h * s.h) / 2 + 4;
  }

  // ── Simulation ──
  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links)
      .id(d => d.id)
      .distance(80)
      .strength(d => Math.min(0.5, d.weight * 0.1))
    )
    .force("charge", d3.forceManyBody()
      .strength(d => -50 - fontSize(d) * 3)
    )
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(d => collideRadius(d)).iterations(3))
    .force("x", d3.forceX(width / 2).strength(0.03))
    .force("y", d3.forceY(height / 2).strength(0.03));

  // attach drag now that simulation exists
  node.call(makeDrag(d3, simulation));

  // ── Selection state ──
  let _selectedId = null;

  function applySelection(conceptId) {
    _selectedId = conceptId;
    if (!conceptId) {
      node.attr("opacity", 1);
      node.select("text")
        .style("fill", d => getThemeColor(d.themeId))
        .style("font-weight", d => fontWeight(d));
      link.attr("stroke-opacity", 0.4);
      return;
    }
    node.attr("opacity", d =>
      d.id === conceptId || links.some(l =>
        (l.source.id === conceptId && l.target.id === d.id) ||
        (l.target.id === conceptId && l.source.id === d.id)
      ) ? 1 : 0.2
    );
    node.select("text").style("fill", d =>
      d.id === conceptId ? "var(--accent)" : getThemeColor(d.themeId)
    );
    node.select("text").style("font-weight", d =>
      d.id === conceptId ? "700" : fontWeight(d)
    );
    link.attr("stroke-opacity", l =>
      (l.source.id === conceptId || l.target.id === conceptId) ? 0.8 : 0.05
    );
  }

  function centerOnNode(conceptId) {
    const target = nodes.find(n => n.id === conceptId);
    if (!target || target.x == null) return;
    const scale = 1.5;
    svg.transition().duration(500)
      .call(zoomBehavior.transform,
        d3.zoomIdentity
          .translate(width / 2 - target.x * scale, height / 2 - target.y * scale)
          .scale(scale)
      );
  }

  // ── Hover ──
  node.on("mouseenter", function(e, d) {
    if (_selectedId) return;
    link.attr("stroke-opacity", l =>
      (l.source.id === d.id || l.target.id === d.id) ? 0.8 : 0.1
    );
    node.attr("opacity", n =>
      n.id === d.id || links.some(l =>
        (l.source.id === d.id && l.target.id === n.id) ||
        (l.target.id === d.id && l.source.id === n.id)
      ) ? 1 : 0.25
    );
  });

  node.on("mouseleave", function() {
    if (_selectedId) { applySelection(_selectedId); return; }
    link.attr("stroke-opacity", 0.4);
    node.attr("opacity", 1);
  });

  // ── Click ──
  node.on("click", (e, d) => {
    if (opts.onClickConcept) opts.onClickConcept(d.id);
  });

  // ── Tick ──
  simulation.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  return {
    simulation,
    highlightNode(conceptId) {
      applySelection(conceptId);
      if (simulation.alpha() > 0.1) {
        simulation.on("end.center", () => {
          centerOnNode(conceptId);
          simulation.on("end.center", null);
        });
      } else {
        centerOnNode(conceptId);
      }
    },
    clearHighlight() {
      applySelection(null);
    },
  };
}

function makeDrag(d3, simulation) {
  return d3.drag()
    .on("start", (e, d) => {
      if (!e.active && simulation) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on("drag", (e, d) => {
      d.fx = e.x; d.fy = e.y;
    })
    .on("end", (e, d) => {
      if (!e.active && simulation) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
}
