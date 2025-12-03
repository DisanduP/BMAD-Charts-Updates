/**
 * Draw.io XML Converter
 * Converts parsed Mermaid diagrams to Draw.io XML format
 */

const { SHAPE_MAPPINGS } = require('./mermaid-parser');

/**
 * Generate a unique ID for Draw.io elements
 */
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Calculate positions for flowchart nodes using an improved algorithm
 * Uses an improved algorithm that handles cycles and branches properly
 */
function calculatePositions(nodes, direction, edges) {
  const positions = new Map();
  const nodeWidth = 140;
  const nodeHeight = 50;
  const horizontalGap = 200;  // Increased gap for better spacing
  const verticalGap = 90;
  const startX = 100;
  const startY = 40;

  // Build adjacency maps
  const outEdges = new Map(); // source -> [targets]
  const inEdges = new Map();  // target -> [sources]
  
  nodes.forEach((node) => {
    outEdges.set(node.id, []);
    inEdges.set(node.id, []);
  });
  
  edges.forEach((edge) => {
    if (outEdges.has(edge.source)) {
      outEdges.get(edge.source).push(edge.target);
    }
    if (inEdges.has(edge.target)) {
      inEdges.get(edge.target).push(edge.source);
    }
  });

  // Step 1: Assign levels using longest path from roots (handles cycles)
  const nodeLevel = new Map();
  
  // Find root nodes
  const roots = nodes.filter((n) => inEdges.get(n.id).length === 0);
  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0]);
  }

  // Use DFS with cycle detection to assign levels
  function assignLevels(nodeId, level, visited, inStack) {
    if (inStack.has(nodeId)) {
      // Back-edge detected (cycle), don't update level
      return;
    }
    if (visited.has(nodeId)) {
      // Already visited, but update if we found a longer path
      if (level > nodeLevel.get(nodeId)) {
        nodeLevel.set(nodeId, level);
      } else {
        return; // Don't re-traverse if not a longer path
      }
    }
    
    visited.add(nodeId);
    inStack.add(nodeId);
    nodeLevel.set(nodeId, Math.max(nodeLevel.get(nodeId) || 0, level));
    
    const children = outEdges.get(nodeId) || [];
    children.forEach((childId) => {
      assignLevels(childId, level + 1, visited, inStack);
    });
    
    inStack.delete(nodeId);
  }
  
  const visited = new Set();
  const inStack = new Set();
  roots.forEach((root) => {
    assignLevels(root.id, 0, visited, inStack);
  });
  
  // Handle any unvisited nodes
  nodes.forEach((node) => {
    if (!nodeLevel.has(node.id)) {
      nodeLevel.set(node.id, 0);
    }
  });

  // Step 2: Group by level and identify tree edges (non-back-edges)
  const levels = new Map();
  nodeLevel.forEach((level, nodeId) => {
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(nodeId);
  });

  // Tree edges are edges where target level > source level
  const treeChildren = new Map();
  nodes.forEach((node) => treeChildren.set(node.id, []));
  
  edges.forEach((edge) => {
    const srcLevel = nodeLevel.get(edge.source) || 0;
    const tgtLevel = nodeLevel.get(edge.target) || 0;
    // Only include forward edges in tree structure
    if (tgtLevel > srcLevel) {
      treeChildren.get(edge.source).push(edge.target);
    }
  });

  // Step 3: Calculate subtree widths using only tree edges
  const subtreeWidth = new Map();
  
  function calcSubtreeWidth(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return 0;
    if (subtreeWidth.has(nodeId)) return subtreeWidth.get(nodeId);
    
    visited.add(nodeId);
    
    const children = treeChildren.get(nodeId) || [];
    if (children.length === 0) {
      subtreeWidth.set(nodeId, 1);
      return 1;
    }
    
    let totalWidth = 0;
    children.forEach((childId) => {
      totalWidth += calcSubtreeWidth(childId, new Set(visited));
    });
    
    const width = Math.max(1, totalWidth);
    subtreeWidth.set(nodeId, width);
    return width;
  }
  
  roots.forEach((root) => calcSubtreeWidth(root.id, new Set()));
  
  // Ensure all nodes have a width
  nodes.forEach((node) => {
    if (!subtreeWidth.has(node.id)) {
      subtreeWidth.set(node.id, 1);
    }
  });

  // Step 4: Position nodes using subtree widths - center parents over children
  const nodeCol = new Map();
  const positioned = new Set();
  
  function positionNode(nodeId, startCol) {
    if (positioned.has(nodeId)) return startCol;
    positioned.add(nodeId);
    
    const children = treeChildren.get(nodeId) || [];
    
    if (children.length === 0) {
      // Leaf node - position at startCol
      nodeCol.set(nodeId, startCol);
      return startCol + 1;
    }
    
    // Position all children first
    let childCol = startCol;
    const childPositions = [];
    
    children.forEach((childId) => {
      if (!positioned.has(childId)) {
        const childStart = childCol;
        childCol = positionNode(childId, childCol);
        childPositions.push({
          id: childId,
          col: nodeCol.get(childId)
        });
      } else {
        childPositions.push({
          id: childId,
          col: nodeCol.get(childId)
        });
      }
    });
    
    // Center this node over its children
    if (childPositions.length > 0) {
      const minChildCol = Math.min(...childPositions.map(c => c.col));
      const maxChildCol = Math.max(...childPositions.map(c => c.col));
      nodeCol.set(nodeId, (minChildCol + maxChildCol) / 2);
    } else {
      nodeCol.set(nodeId, startCol);
    }
    
    return childCol;
  }
  
  let col = 0;
  roots.forEach((root) => {
    col = positionNode(root.id, col);
  });
  
  // Position any unpositioned nodes
  nodes.forEach((node) => {
    if (!nodeCol.has(node.id)) {
      nodeCol.set(node.id, col++);
    }
  });

  // Step 5: Convert to coordinates
  const isHorizontal = direction === 'LR' || direction === 'RL';
  const isReversed = direction === 'BT' || direction === 'RL';
  
  nodes.forEach((node) => {
    const level = nodeLevel.get(node.id) || 0;
    const c = nodeCol.get(node.id) || 0;
    
    let x, y;
    
    if (isHorizontal) {
      x = startX + (isReversed ? -1 : 1) * level * horizontalGap;
      y = startY + c * verticalGap;
    } else {
      x = startX + c * horizontalGap;
      y = startY + (isReversed ? -1 : 1) * level * verticalGap;
    }
    
    // Grid-align to multiples of 10
    x = Math.round(x / 10) * 10;
    y = Math.round(y / 10) * 10;
    
    positions.set(node.id, { x, y, width: nodeWidth, height: nodeHeight });
  });

  return positions;
}

/**
 * Generate Draw.io style string for a node
 */
function getNodeStyle(node) {
  let style = node.style || SHAPE_MAPPINGS.rectangle.style;
  const fillColor = node.fillColor || '#dae8fc';
  const strokeColor = node.strokeColor || '#6c8ebf';
  
  return `${style}fillColor=${fillColor};strokeColor=${strokeColor};`;
}

/**
 * Generate edge style string
 */
function getEdgeStyle(edge, sourceNode, targetNode, positions) {
  // Clean orthogonal lines - professional flowchart look
  let style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;';
  
  if (edge.arrowType) {
    if (edge.arrowType.type === 'dashed') {
      style += 'dashed=1;';
    }
    if (edge.arrowType.arrow === 'none') {
      style += 'endArrow=none;';
    } else {
      style += 'endArrow=classic;';
    }
  } else {
    style += 'endArrow=classic;';
  }
  
  // Only one arrow at the end, none at start
  style += 'startArrow=none;';
  
  return style;
}

/**
 * Convert parsed diagram to Draw.io XML
 */
function convertToDrawio(parsedDiagram, options = {}) {
  const { name = 'Converted Diagram' } = options;
  const diagramId = generateId();
  const direction = parsedDiagram.direction || 'TD';
  
  // Calculate positions
  const positions = calculatePositions(
    parsedDiagram.nodes,
    direction,
    parsedDiagram.edges
  );
  
  // Build nodes XML - adjust size based on shape type
  const nodesXml = parsedDiagram.nodes.map((node) => {
    const pos = positions.get(node.id) || { x: 340, y: 40, width: 140, height: 50 };
    const style = getNodeStyle(node);
    const label = escapeXml(node.label);
    
    // Make diamonds bigger to fit text (they display text in a smaller area)
    let width = pos.width;
    let height = pos.height;
    if (node.shape === 'diamond') {
      width = Math.max(160, label.length * 8);
      height = 80;
    }
    
    return `        <mxCell id="${node.id}" value="${label}" style="${style}" vertex="1" parent="1">
          <mxGeometry x="${pos.x}" y="${pos.y}" width="${width}" height="${height}" as="geometry"/>
        </mxCell>`;
  }).join('\n');
  
  // Build edges XML - filter out duplicate edges and add smart routing
  const seenEdges = new Set();
  const nodeMap = new Map();
  parsedDiagram.nodes.forEach((n) => nodeMap.set(n.id, n));
  
  const edgesXml = parsedDiagram.edges
    .filter((edge) => {
      const key = `${edge.source}->${edge.target}`;
      if (seenEdges.has(key)) return false;
      seenEdges.add(key);
      return true;
    })
    .map((edge) => {
      const sourcePos = positions.get(edge.source);
      const targetPos = positions.get(edge.target);
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      
      let style = getEdgeStyle(edge);
      const label = edge.label ? escapeXml(edge.label) : '';
      
      let exitX = 0.5, exitY = 1, entryX = 0.5, entryY = 0;
      let waypoints = [];
      
      // Calculate relative positions to determine exit/entry points
      if (sourcePos && targetPos) {
        const sourceWidth = sourceNode?.shape === 'diamond' ? 160 : 140;
        const sourceHeight = sourceNode?.shape === 'diamond' ? 80 : 50;
        const targetWidth = targetNode?.shape === 'diamond' ? 160 : 140;
        const targetHeight = targetNode?.shape === 'diamond' ? 80 : 50;
        
        const sourceCenterX = sourcePos.x + sourceWidth / 2;
        const sourceCenterY = sourcePos.y + sourceHeight / 2;
        const targetCenterX = targetPos.x + targetWidth / 2;
        const targetCenterY = targetPos.y + targetHeight / 2;
        
        const dx = targetCenterX - sourceCenterX;
        const dy = targetCenterY - sourceCenterY;
        
        // For diamond (decision) nodes, route left/right exits properly
        if (sourceNode && sourceNode.shape === 'diamond') {
          if (dx > 80) {
            // Target is to the right - exit from right side of diamond
            exitX = 1; exitY = 0.5;
            // Enter from TOP of target (not left side) to avoid arrow going inside
            entryX = 0.5; entryY = 0;
            
            // Route: go right from diamond, then down to top of target
            const exitPointX = sourcePos.x + sourceWidth;
            const exitPointY = sourceCenterY;
            
            waypoints.push({ x: targetCenterX, y: exitPointY });
            
          } else if (dx < -80) {
            // Target is to the left - exit from left side
            exitX = 0; exitY = 0.5;
            // Enter from TOP of target
            entryX = 0.5; entryY = 0;
            
            // Route: go left from diamond, then down to top of target
            const exitPointX = sourcePos.x;
            const exitPointY = sourceCenterY;
            
            waypoints.push({ x: targetCenterX, y: exitPointY });
            
          } else {
            // Target is mostly below - exit from bottom, enter from top
            exitX = 0.5; exitY = 1;
            entryX = 0.5; entryY = 0;
          }
        } else {
          // Non-diamond nodes - simple top-to-bottom or side routing
          if (dy > 20) {
            // Target is below
            exitX = 0.5; exitY = 1;
            entryX = 0.5; entryY = 0;
          } else if (dy < -20) {
            // Target is above
            exitX = 0.5; exitY = 0;
            entryX = 0.5; entryY = 1;
          } else if (dx > 0) {
            // Target is to the right
            exitX = 1; exitY = 0.5;
            entryX = 0; entryY = 0.5;
          } else {
            // Target is to the left
            exitX = 0; exitY = 0.5;
            entryX = 1; entryY = 0.5;
          }
        }
      }
      
      style += `exitX=${exitX};exitY=${exitY};exitDx=0;exitDy=0;`;
      style += `entryX=${entryX};entryY=${entryY};entryDx=0;entryDy=0;`;
      
      // Build waypoints XML if we have any
      let waypointsXml = '';
      if (waypoints.length > 0) {
        waypointsXml = `
            <Array as="points">
${waypoints.map(wp => `              <mxPoint x="${Math.round(wp.x)}" y="${Math.round(wp.y)}"/>`).join('\n')}
            </Array>`;
      }
      
      // Add label offset
      let labelOffset = label ? '\n            <mxPoint as="offset" x="0" y="-10"/>' : '';
    
    return `        <mxCell id="${edge.id}" value="${label}" style="${style}" edge="1" parent="1" source="${edge.source}" target="${edge.target}">
          <mxGeometry relative="1" as="geometry">${waypointsXml}${labelOffset}
          </mxGeometry>
        </mxCell>`;
  }).join('\n');
  
  // Build subgraphs XML (as groups)
  let subgraphsXml = '';
  if (parsedDiagram.subgraphs && parsedDiagram.subgraphs.length > 0) {
    subgraphsXml = parsedDiagram.subgraphs.map((subgraph, index) => {
      // Calculate bounding box for subgraph
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      subgraph.nodes.forEach((nodeId) => {
        const pos = positions.get(nodeId);
        if (pos) {
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x + pos.width);
          maxY = Math.max(maxY, pos.y + pos.height);
        }
      });
      
      const padding = 20;
      const x = minX - padding;
      const y = minY - padding - 30; // Extra space for label
      const width = maxX - minX + padding * 2;
      const height = maxY - minY + padding * 2 + 30;
      
      return `        <mxCell id="sg${index}" value="${escapeXml(subgraph.label)}" style="swimlane;startSize=30;fillColor=#f5f5f5;strokeColor=#666666;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/>
        </mxCell>`;
    }).join('\n');
  }
  
  // Assemble final XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="BMAD-CLI" version="21.0.0">
  <diagram name="${escapeXml(name)}" id="${diagramId}">
    <mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${subgraphsXml}
${nodesXml}
${edgesXml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
  
  return xml;
}

/**
 * Convert sequence diagram to Draw.io
 */
function convertSequenceToDrawio(parsedDiagram, options = {}) {
  const { name = 'Sequence Diagram' } = options;
  const diagramId = generateId();
  
  const participants = parsedDiagram.participants || parsedDiagram.nodes;
  const messages = parsedDiagram.messages || [];
  
  const participantWidth = 120;
  const participantHeight = 40;
  const horizontalGap = 180;
  const verticalGap = 60;
  const startX = 100;
  const startY = 40;
  const lifelineHeight = (messages.length + 2) * verticalGap;
  
  // Position participants
  const positions = new Map();
  participants.forEach((p, index) => {
    positions.set(p.id, {
      x: startX + index * horizontalGap,
      y: startY,
      width: participantWidth,
      height: participantHeight,
    });
  });
  
  // Build participants XML
  const participantsXml = participants.map((p) => {
    const pos = positions.get(p.id);
    const style = p.isActor
      ? 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;'
      : 'rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;';
    
    return `        <mxCell id="${p.id}" value="${escapeXml(p.label)}" style="${style}" vertex="1" parent="1">
          <mxGeometry x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" as="geometry"/>
        </mxCell>`;
  }).join('\n');
  
  // Build lifelines XML
  const lifelinesXml = participants.map((p) => {
    const pos = positions.get(p.id);
    const lifelineX = pos.x + pos.width / 2;
    const lifelineY = pos.y + pos.height;
    
    return `        <mxCell id="${p.id}_lifeline" value="" style="endArrow=none;dashed=1;html=1;strokeWidth=1;strokeColor=#999999;" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry">
            <mxPoint x="${lifelineX}" y="${lifelineY}" as="sourcePoint"/>
            <mxPoint x="${lifelineX}" y="${lifelineY + lifelineHeight}" as="targetPoint"/>
          </mxGeometry>
        </mxCell>`;
  }).join('\n');
  
  // Build messages XML
  const messagesXml = messages.map((msg, index) => {
    const fromPos = positions.get(msg.from);
    const toPos = positions.get(msg.to);
    if (!fromPos || !toPos) return '';
    
    const y = startY + participantHeight + (index + 1) * verticalGap;
    const style = msg.type === 'dashed'
      ? 'html=1;dashed=1;endArrow=open;'
      : 'html=1;endArrow=block;endFill=1;';
    
    return `        <mxCell id="msg${index}" value="${escapeXml(msg.message)}" style="${style}" edge="1" parent="1">
          <mxGeometry relative="1" as="geometry">
            <mxPoint x="${fromPos.x + fromPos.width / 2}" y="${y}" as="sourcePoint"/>
            <mxPoint x="${toPos.x + toPos.width / 2}" y="${y}" as="targetPoint"/>
          </mxGeometry>
        </mxCell>`;
  }).filter(Boolean).join('\n');
  
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="BMAD-CLI" version="21.0.0">
  <diagram name="${escapeXml(name)}" id="${diagramId}">
    <mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${participantsXml}
${lifelinesXml}
${messagesXml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
  
  return xml;
}

/**
 * Convert ER diagram to Draw.io
 */
function convertERToDrawio(parsedDiagram, options = {}) {
  const { name = 'ER Diagram' } = options;
  const diagramId = generateId();
  
  const entities = parsedDiagram.entities || parsedDiagram.nodes;
  const relationships = parsedDiagram.relationships || parsedDiagram.edges;
  
  const entityWidth = 180;
  const rowHeight = 24;
  const headerHeight = 28;
  const horizontalGap = 280;
  const verticalGap = 180;
  const startX = 50;
  const startY = 40;
  
  // Calculate entity heights based on number of attributes
  const entityHeights = new Map();
  entities.forEach((entity) => {
    const attrCount = entity.attributes?.length || 0;
    const height = headerHeight + Math.max(1, attrCount) * rowHeight;
    entityHeights.set(entity.id, height);
  });
  
  // Build adjacency list for graph analysis
  const adjacency = new Map();
  entities.forEach((e) => adjacency.set(e.id, new Set()));
  relationships.forEach((rel) => {
    adjacency.get(rel.source)?.add(rel.target);
    adjacency.get(rel.target)?.add(rel.source);
  });
  
  // Count connections per entity
  const connectionCount = new Map();
  entities.forEach((e) => connectionCount.set(e.id, adjacency.get(e.id)?.size || 0));
  
  // Find the most connected entity (hub)
  let hubId = null;
  let maxConnections = 0;
  entities.forEach((e) => {
    const count = connectionCount.get(e.id) || 0;
    if (count > maxConnections) {
      maxConnections = count;
      hubId = e.id;
    }
  });
  
  // Position using BFS from hub - place hub in center, neighbors around it
  const positions = new Map();
  const positioned = new Set();
  
  // Calculate grid dimensions
  const totalEntities = entities.length;
  const cols = Math.ceil(Math.sqrt(totalEntities * 1.5));
  const rows = Math.ceil(totalEntities / cols);
  
  // Pre-calculate max height per potential row
  const defaultRowHeight = 180;
  
  if (hubId) {
    // Place hub in center-ish position
    const hubRow = Math.floor(rows / 2);
    const hubCol = Math.floor(cols / 2);
    
    positions.set(hubId, {
      x: startX + hubCol * horizontalGap,
      y: startY + hubRow * (defaultRowHeight + verticalGap),
      width: entityWidth,
      height: entityHeights.get(hubId),
    });
    positioned.add(hubId);
    
    // Place direct neighbors of hub around it
    const hubNeighbors = Array.from(adjacency.get(hubId) || []);
    const neighborPositions = [
      { row: hubRow - 1, col: hubCol },     // above
      { row: hubRow, col: hubCol + 1 },     // right
      { row: hubRow + 1, col: hubCol },     // below
      { row: hubRow, col: hubCol - 1 },     // left
      { row: hubRow - 1, col: hubCol + 1 }, // top-right
      { row: hubRow + 1, col: hubCol + 1 }, // bottom-right
      { row: hubRow + 1, col: hubCol - 1 }, // bottom-left
      { row: hubRow - 1, col: hubCol - 1 }, // top-left
    ];
    
    hubNeighbors.forEach((neighborId, index) => {
      if (index < neighborPositions.length && !positioned.has(neighborId)) {
        const pos = neighborPositions[index];
        positions.set(neighborId, {
          x: startX + pos.col * horizontalGap,
          y: startY + pos.row * (defaultRowHeight + verticalGap),
          width: entityWidth,
          height: entityHeights.get(neighborId),
        });
        positioned.add(neighborId);
      }
    });
    
    // Place remaining entities (neighbors of neighbors)
    let nextPosIndex = hubNeighbors.length;
    entities.forEach((entity) => {
      if (!positioned.has(entity.id)) {
        // Find an empty spot
        for (let attempt = 0; attempt < 20; attempt++) {
          const row = Math.floor(nextPosIndex / cols);
          const col = nextPosIndex % cols;
          nextPosIndex++;
          
          // Check if position is already taken
          let taken = false;
          positions.forEach((pos) => {
            const posRow = Math.round((pos.y - startY) / (defaultRowHeight + verticalGap));
            const posCol = Math.round((pos.x - startX) / horizontalGap);
            if (posRow === row && posCol === col) taken = true;
          });
          
          if (!taken) {
            positions.set(entity.id, {
              x: startX + col * horizontalGap,
              y: startY + row * (defaultRowHeight + verticalGap),
              width: entityWidth,
              height: entityHeights.get(entity.id),
            });
            positioned.add(entity.id);
            break;
          }
        }
      }
    });
  } else {
    // No hub found, simple grid layout
    entities.forEach((entity, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      positions.set(entity.id, {
        x: startX + col * horizontalGap,
        y: startY + row * (defaultRowHeight + verticalGap),
        width: entityWidth,
        height: entityHeights.get(entity.id),
      });
    });
  }
  
  // Build entities XML with attributes
  const entitiesXml = entities.map((entity) => {
    const pos = positions.get(entity.id);
    
    const headerStyle = 'swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=30;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=12;';
    
    let attributesXml = '';
    if (entity.attributes && entity.attributes.length > 0) {
      attributesXml = entity.attributes.map((attr, i) => {
        // Format: type name with PK/FK indicator
        let displayText = `${attr.type} ${attr.name}`;
        let fontStyle = '';
        
        if (attr.keyType === 'PK') {
          displayText = `🔑 ${displayText} PK`;
          fontStyle = 'fontStyle=1;'; // Bold for primary key
        } else if (attr.keyType === 'FK') {
          displayText = `🔗 ${displayText} FK`;
          fontStyle = 'fontStyle=2;'; // Italic for foreign key
        }
        
        return `        <mxCell id="${entity.id}_attr${i}" value="${escapeXml(displayText)}" style="text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=4;overflow=hidden;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;rotatable=0;${fontStyle}fontSize=11;" vertex="1" parent="${entity.id}">
          <mxGeometry y="${headerHeight + i * rowHeight}" width="${pos.width}" height="${rowHeight}" as="geometry"/>
        </mxCell>`;
      }).join('\n');
    } else {
      // Empty row if no attributes
      attributesXml = `        <mxCell id="${entity.id}_empty" value="(no attributes)" style="text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=4;overflow=hidden;fontStyle=2;fontColor=#999999;fontSize=10;" vertex="1" parent="${entity.id}">
          <mxGeometry y="${headerHeight}" width="${pos.width}" height="${rowHeight}" as="geometry"/>
        </mxCell>`;
    }
    
    return `        <mxCell id="${entity.id}" value="${escapeXml(entity.label)}" style="${headerStyle}" vertex="1" parent="1">
          <mxGeometry x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" as="geometry"/>
        </mxCell>
${attributesXml}`;
  }).join('\n');
  
  // Track which ports are used on each entity to avoid overlap
  const usedPorts = new Map(); // entityId -> { top: count, bottom: count, left: count, right: count }
  entities.forEach((e) => usedPorts.set(e.id, { top: 0, bottom: 0, left: 0, right: 0 }));
  
  // Build relationships XML with smart edge routing
  const relationshipsXml = relationships.map((rel) => {
    const sourcePos = positions.get(rel.source);
    const targetPos = positions.get(rel.target);
    if (!sourcePos || !targetPos) return '';
    
    // Calculate best exit/entry points based on relative positions
    const sourceCenterX = sourcePos.x + sourcePos.width / 2;
    const sourceCenterY = sourcePos.y + sourcePos.height / 2;
    const targetCenterX = targetPos.x + targetPos.width / 2;
    const targetCenterY = targetPos.y + targetPos.height / 2;
    
    const dx = targetCenterX - sourceCenterX;
    const dy = targetCenterY - sourceCenterY;
    
    let exitSide, entrySide;
    
    // Determine primary direction
    if (Math.abs(dx) > Math.abs(dy) * 0.5) {
      // Primarily horizontal
      if (dx > 0) {
        exitSide = 'right';
        entrySide = 'left';
      } else {
        exitSide = 'left';
        entrySide = 'right';
      }
    } else {
      // Primarily vertical
      if (dy > 0) {
        exitSide = 'bottom';
        entrySide = 'top';
      } else {
        exitSide = 'top';
        entrySide = 'bottom';
      }
    }
    
    // Get port offset to spread multiple connections on same side
    const sourcePortCount = usedPorts.get(rel.source);
    const targetPortCount = usedPorts.get(rel.target);
    
    const exitCount = sourcePortCount[exitSide];
    const entryCount = targetPortCount[entrySide];
    
    // Increment counters
    sourcePortCount[exitSide]++;
    targetPortCount[entrySide]++;
    
    // Calculate actual exit/entry coordinates with offset
    let exitX, exitY, entryX, entryY;
    const portSpread = 0.2; // How much to spread ports (0.2 = 20% of side)
    
    switch (exitSide) {
      case 'right':
        exitX = 1;
        exitY = 0.3 + (exitCount * portSpread);
        break;
      case 'left':
        exitX = 0;
        exitY = 0.3 + (exitCount * portSpread);
        break;
      case 'bottom':
        exitX = 0.3 + (exitCount * portSpread);
        exitY = 1;
        break;
      case 'top':
        exitX = 0.3 + (exitCount * portSpread);
        exitY = 0;
        break;
    }
    
    switch (entrySide) {
      case 'right':
        entryX = 1;
        entryY = 0.3 + (entryCount * portSpread);
        break;
      case 'left':
        entryX = 0;
        entryY = 0.3 + (entryCount * portSpread);
        break;
      case 'bottom':
        entryX = 0.3 + (entryCount * portSpread);
        entryY = 1;
        break;
      case 'top':
        entryX = 0.3 + (entryCount * portSpread);
        entryY = 0;
        break;
    }
    
    // Clamp values to valid range
    exitY = Math.min(0.8, Math.max(0.2, exitY));
    exitX = Math.min(0.8, Math.max(0.2, exitSide === 'left' || exitSide === 'right' ? exitX : exitX));
    entryY = Math.min(0.8, Math.max(0.2, entryY));
    entryX = Math.min(0.8, Math.max(0.2, entrySide === 'left' || entrySide === 'right' ? entryX : entryX));
    
    // Fix edge values for sides
    if (exitSide === 'right') exitX = 1;
    if (exitSide === 'left') exitX = 0;
    if (exitSide === 'bottom') exitY = 1;
    if (exitSide === 'top') exitY = 0;
    if (entrySide === 'right') entryX = 1;
    if (entrySide === 'left') entryX = 0;
    if (entrySide === 'bottom') entryY = 1;
    if (entrySide === 'top') entryY = 0;
    
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;startArrow=ERone;startFill=0;endArrow=ERmany;endFill=0;strokeWidth=1;exitX=${exitX};exitY=${exitY};exitDx=0;exitDy=0;entryX=${entryX};entryY=${entryY};entryDx=0;entryDy=0;labelBackgroundColor=#ffffff;`;
    
    return `        <mxCell id="${rel.id}" value="${escapeXml(rel.label || '')}" style="${style}" edge="1" parent="1" source="${rel.source}" target="${rel.target}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`;
  }).filter(Boolean).join('\n');
  
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="BMAD-CLI" version="21.0.0">
  <diagram name="${escapeXml(name)}" id="${diagramId}">
    <mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${entitiesXml}
${relationshipsXml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
  
  return xml;
}

/**
 * Convert mindmap to Draw.io
 */
function convertMindmapToDrawio(parsedDiagram, options = {}) {
  const { name = 'Mindmap' } = options;
  const diagramId = generateId();

  const nodes = parsedDiagram.nodes;
  const edges = parsedDiagram.edges;

  // Build parent-child relationships
  const children = new Map();
  const parent = new Map();
  edges.forEach((edge) => {
    if (!children.has(edge.source)) {
      children.set(edge.source, []);
    }
    children.get(edge.source).push(edge.target);
    parent.set(edge.target, edge.source);
  });

  // Find root node (node with no parent)
  const rootNode = nodes.find((n) => !parent.has(n.id));
  
  // Calculate positions using a tree layout
  const positions = new Map();
  const nodeWidth = 120;
  const nodeHeight = 36;
  const levelGap = 200; // Horizontal gap between levels
  const siblingGap = 15; // Vertical gap between siblings

  // Calculate subtree heights for proper spacing
  function getSubtreeHeight(nodeId) {
    const nodeChildren = children.get(nodeId) || [];
    if (nodeChildren.length === 0) {
      return nodeHeight;
    }
    let totalHeight = 0;
    nodeChildren.forEach((childId) => {
      totalHeight += getSubtreeHeight(childId) + siblingGap;
    });
    return Math.max(totalHeight - siblingGap, nodeHeight);
  }

  // Position nodes recursively
  function positionNode(nodeId, x, yStart, yEnd) {
    const yCenter = (yStart + yEnd) / 2;
    
    positions.set(nodeId, {
      x: Math.round(x / 10) * 10,
      y: Math.round((yCenter - nodeHeight / 2) / 10) * 10,
      width: nodeWidth,
      height: nodeHeight,
    });

    const nodeChildren = children.get(nodeId) || [];
    if (nodeChildren.length === 0) return;

    // Calculate total height needed for children
    const childHeights = nodeChildren.map((childId) => getSubtreeHeight(childId));
    const totalChildHeight = childHeights.reduce((sum, h) => sum + h + siblingGap, 0) - siblingGap;

    // Position children
    let currentY = yCenter - totalChildHeight / 2;
    nodeChildren.forEach((childId, index) => {
      const childHeight = childHeights[index];
      positionNode(
        childId,
        x + levelGap,
        currentY,
        currentY + childHeight
      );
      currentY += childHeight + siblingGap;
    });
  }

  // Start positioning from root
  if (rootNode) {
    const totalHeight = getSubtreeHeight(rootNode.id);
    const startY = 50;
    positionNode(rootNode.id, 50, startY, startY + totalHeight);
  }

  // Build nodes XML
  const nodesXml = nodes.map((node) => {
    const pos = positions.get(node.id) || { x: 100, y: 100, width: nodeWidth, height: nodeHeight };
    const style = `${node.style}fillColor=${node.fillColor};strokeColor=${node.strokeColor};fontStyle=1;fontSize=11;`;
    const label = escapeXml(node.label);

    return `        <mxCell id="${node.id}" value="${label}" style="${style}" vertex="1" parent="1">
          <mxGeometry x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" as="geometry"/>
        </mxCell>`;
  }).join('\n');

  // Build edges XML - use exitX/exitY and entryX/entryY to connect at box edges
  const edgesXml = edges.map((edge) => {
    // Exit from right side of source (x=1), enter left side of target (x=0)
    // Y position at middle (y=0.5)
    return `        <mxCell id="${edge.id}" value="" style="edgeStyle=orthogonalEdgeStyle;curved=1;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=none;strokeWidth=2;strokeColor=#666666;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="${edge.source}" target="${edge.target}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`;
  }).join('\n');

  // Calculate canvas size based on positions
  let maxX = 800, maxY = 600;
  positions.forEach((pos) => {
    maxX = Math.max(maxX, pos.x + pos.width + 100);
    maxY = Math.max(maxY, pos.y + pos.height + 100);
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="BMAD-CLI" version="21.0.0">
  <diagram name="${escapeXml(name)}" id="${diagramId}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.max(1100, maxX)}" pageHeight="${Math.max(850, maxY)}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${nodesXml}
${edgesXml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

  return xml;
}

/**
 * Main conversion function - detects diagram type and converts
 */
function toDrawio(parsedDiagram, options = {}) {
  switch (parsedDiagram.type) {
    case 'sequence':
      return convertSequenceToDrawio(parsedDiagram, options);
    case 'erDiagram':
      return convertERToDrawio(parsedDiagram, options);
    case 'mindmap':
      return convertMindmapToDrawio(parsedDiagram, options);
    case 'flowchart':
    default:
      return convertToDrawio(parsedDiagram, options);
  }
}

module.exports = {
  toDrawio,
  convertToDrawio,
  convertSequenceToDrawio,
  convertERToDrawio,
  convertMindmapToDrawio,
  escapeXml,
};
