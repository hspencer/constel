// concept-map.js — grafo force-directed D3.js de conceptos
// Patrón basado en logseq-constel/src/render.ts

import { state, computeConceptGraph, getThemeColor } from "../state.js";

// D3 se carga via CDN en index.html (sin build step)
// Referencia global: window.d3

/**
 * Renderiza el mapa de conceptos.
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {"circular"|"title"} opts.style
 * @param {string} [opts.sourceId] - filtrar grafo a un source específico
 * @param {Function} opts.onClickConcept - (conceptId) => void
 */
export function renderConceptMap(container, opts = {}) {
  const d3 = window.d3;
  if (!d3) {
    container.innerHTML = `<p class="placeholder">D3.js no está cargado</p>`;
    return;
  }

  const { nodes, links } = computeConceptGraph(opts.sourceId || null);
  if (!nodes.length) {
    container.innerHTML = `<p class="placeholder">Marca pasajes con conceptos para ver el mapa</p>`;
    return;
  }

  container.innerHTML = "";
  const style = opts.style || "circular";
  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3.select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height]);

  // zoom
  const g = svg.append("g");
  svg.call(d3.zoom()
    .scaleExtent([0.2, 4])
    .on("zoom", (e) => g.attr("transform", e.transform))
  );

  // fuerzas
  const maxWeight = Math.max(1, ...links.map(l => l.weight));

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links)
      .id(d => d.id)
      .distance(d => 100 / (1 + d.weight / maxWeight))
    )
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(d => nodeRadius(d, style) + 5));

  // enlaces
  const link = g.append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", d => `map-link ${d.shared > 0 ? "strong" : ""}`)
    .attr("stroke-width", d => Math.max(1, Math.min(4, d.weight)));

  // nodos
  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "map-node")
    .call(drag(simulation));

  if (style === "circular") {
    node.append("circle")
      .attr("r", d => nodeRadius(d, style))
      .attr("fill", d => getThemeColor(d.themeId))
      .attr("opacity", 0.85);

    node.append("text")
      .text(d => d.label)
      .attr("dy", d => nodeRadius(d, style) + 14)
      .attr("text-anchor", "middle")
      .style("font-size", "11px")
      .style("fill", "var(--ink)");
  } else {
    // modo título
    node.append("text")
      .text(d => d.label)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .style("font-size", d => `${Math.max(11, Math.min(18, 11 + d.excerptCount * 1.5))}px`)
      .style("font-weight", d => d.excerptCount > 3 ? "600" : "400")
      .style("fill", d => getThemeColor(d.themeId))
      .style("cursor", "pointer");
  }

  // hover
  node.on("mouseenter", function(e, d) {
    d3.select(this).select("circle").attr("opacity", 1).attr("stroke", "var(--ink)").attr("stroke-width", 2);
    // resaltar links conectados
    link.attr("stroke-opacity", l =>
      (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.15
    );
    // atenuar otros nodos
    node.attr("opacity", n =>
      n.id === d.id || links.some(l =>
        (l.source.id === d.id && l.target.id === n.id) ||
        (l.target.id === d.id && l.source.id === n.id)
      ) ? 1 : 0.3
    );
  });

  node.on("mouseleave", function() {
    d3.select(this).select("circle").attr("opacity", 0.85).attr("stroke", "none");
    link.attr("stroke-opacity", 0.5);
    node.attr("opacity", 1);
  });

  // click
  node.on("click", (e, d) => {
    if (opts.onClickConcept) opts.onClickConcept(d.id);
  });

  // tick
  simulation.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  return simulation;
}

function nodeRadius(d, style) {
  if (style === "title") return 0;
  return Math.max(6, Math.min(20, 6 + d.excerptCount * 2));
}

function drag(simulation) {
  const d3 = window.d3;
  return d3.drag()
    .on("start", (e, d) => {
      if (!e.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on("drag", (e, d) => {
      d.fx = e.x; d.fy = e.y;
    })
    .on("end", (e, d) => {
      if (!e.active) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
}
