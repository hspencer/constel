// concept-map.js — grafo force-directed D3.js de conceptos
// Modo título: labels como partículas, tamaño = f(frecuencia).
// Sin negrita. forceCollide con bounding box → sin traslape.

import { state, computeConceptGraph, getThemeColor } from "../state.js";

/**
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {string} [opts.sourceId]
 * @param {number} [opts.distance=80]
 * @param {boolean} [opts.showEdges=true]
 * @param {Function} opts.onClickConcept
 * @returns {Object|null} controller
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
  let currentDistance = opts.distance || 80;

  // ── Font size scale (no bold, only size varies) ──
  const maxExc = Math.max(1, ...nodes.map(n => n.excerptCount));
  const maxSrc = Math.max(1, ...nodes.map(n => n.sourceCount));

  function fontSize(d) {
    const score = (d.excerptCount / maxExc) * 0.6 + (d.sourceCount / maxSrc) * 0.4;
    return Math.round(11 + score * 20); // 11px to 31px
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

  // ── Weight normalization ──
  const maxWeight = Math.max(1, ...links.map(l => l.weight));

  // ── Links ──
  const linkG = g.append("g").attr("class", "map-links-group");
  const link = linkG
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", d => `map-link ${d.coExcerpt > 0 ? "strong" : "proximity"}`)
    .attr("stroke-width", d => {
      const norm = d.weight / maxWeight;
      return Math.max(0.5, norm * 3);
    })
    .attr("stroke-dasharray", d => d.coExcerpt > 0 ? null : "3,3");

  // initial edge visibility
  if (opts.showEdges === false) {
    linkG.style("display", "none");
  }

  // ── Nodes (text only, no bold) ──
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
    .style("font-weight", "400")
    .style("fill", d => getThemeColor(d.themeId))
    .style("cursor", "pointer");

  // ── Measure bounding boxes for collision ──
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
  const linkForce = d3.forceLink(links)
    .id(d => d.id)
    .distance(d => {
      // links fuertes → cerca; links débiles → lejos
      const norm = d.weight / maxWeight; // 0..1
      return currentDistance * (1.8 - norm * 1.5); // rango: 0.3x .. 1.8x de la distancia base
    })
    .strength(d => {
      // links fuertes tiran mucho más
      const norm = d.weight / maxWeight;
      return 0.05 + norm * 0.8; // 0.05 .. 0.85
    });

  // Nodos sin links → identificarlos para empujarlos a la periferia
  const linkedIds = new Set();
  for (const l of links) {
    linkedIds.add(typeof l.source === "object" ? l.source.id : l.source);
    linkedIds.add(typeof l.target === "object" ? l.target.id : l.target);
  }

  const simulation = d3.forceSimulation(nodes)
    .force("link", linkForce)
    .force("charge", d3.forceManyBody()
      .strength(d => {
        // nodos conectados se repelen moderadamente
        // nodos sueltos se repelen más fuerte → van a la periferia
        if (!linkedIds.has(d.id)) return -150 - fontSize(d) * 4;
        return -60 - fontSize(d) * 3;
      })
    )
    .force("center", d3.forceCenter(width / 2, height / 2).strength(0.3))
    .force("collide", d3.forceCollide(d => collideRadius(d) + 2).iterations(4))
    .force("x", d3.forceX(width / 2).strength(d => linkedIds.has(d.id) ? 0.02 : 0.01))
    .force("y", d3.forceY(height / 2).strength(d => linkedIds.has(d.id) ? 0.02 : 0.01));

  node.call(makeDrag(d3, simulation));

  // ── Selection ──
  let _selectedId = null;

  function applySelection(conceptId) {
    _selectedId = conceptId;
    if (!conceptId) {
      node.attr("opacity", 1);
      node.select("text")
        .style("fill", d => getThemeColor(d.themeId))
        .style("font-weight", "400");
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
    // selected node gets slightly heavier, not bold
    node.select("text").style("font-weight", d =>
      d.id === conceptId ? "500" : "400"
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

  // ── Controller ──
  return {
    simulation,

    setDistance(dist) {
      currentDistance = dist;
      linkForce.distance(d => {
        const norm = d.weight / maxWeight;
        return dist * (1.8 - norm * 1.5);
      });
      simulation.alpha(0.6).restart();
    },

    setEdgesVisible(visible) {
      linkG.style("display", visible ? null : "none");
    },

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
