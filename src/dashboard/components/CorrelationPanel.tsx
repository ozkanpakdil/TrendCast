/**
 * CorrelationPanel — directed network graph visualization of correlations.
 *
 * Displays a force-directed graph with three node types:
 *   📰 News items (Yahoo Finance, Google News, BBC, CNN)
 *   📊 Market contracts (Polymarket, Kalshi)
 *   👽 Social signals (Reddit, X/Twitter)
 *
 * Edges are DIRECTED — arrows show causal/temporal flow:
 *   News → Social: news published before social post (news triggered discussion)
 *   Social → Market: social signal correlates with market contract
 *   News → Market: news headline correlates with market contract
 *
 * Features: zoom/pan, hover highlights, click to open, filter, list view.
 */

import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import type {
  CorrelationMatch,
  NewsCorrelationMatch,
  NewsNewsCorrelationMatch,
  NewsSocialCorrelationMatch,
  MarketContract,
  NewsItem,
  SocialSignal,
} from '@/types';

interface CorrelationPanelProps {
  matches: CorrelationMatch[];
  newsMatches: NewsCorrelationMatch[];
  newsSocialMatches: NewsSocialCorrelationMatch[];
  newsNewsMatches: NewsNewsCorrelationMatch[];
}

// ── Graph types ─────────────────────────────────────────────────

type NodeType = 'news' | 'market' | 'social';

interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  url?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  data: NewsItem | MarketContract | SocialSignal;
  connections: number;
  timestamp: number; // epoch ms for temporal ordering
}

interface GraphEdge {
  source: string;
  target: string;
  confidence: number;
  keywords: string[];
  edgeType: 'social-market' | 'news-market' | 'news-social' | 'news-news';
  direction: 'forward' | 'reverse'; // forward = source came first
}

// ── Constants ───────────────────────────────────────────────────

const MAX_NODES = 60;
const MAX_EDGES = 80;
const SIMULATION_STEPS = 100; // total steps
const STEPS_PER_FRAME = 5; // steps per rAF chunk — keeps UI responsive
const REPULSION = 14000; // increased to spread nodes further apart
const SPRING_LENGTH = 100;
const SPRING_STRENGTH = 0.05;
const DAMPING = 0.88; // higher damping = settles faster
const CENTER_FORCE = 0.015;
const ZONE_RADIUS = 130; // radius of each type cluster

// Zone centers — News left, Market center, Social right
// This creates a left-to-right causal flow: News → Market → Social
const ZONE_CENTERS: Record<NodeType, { x: number; y: number }> = {
  news: { x: 150, y: 300 },
  market: { x: 400, y: 300 },
  social: { x: 650, y: 300 },
};

const NODE_COLORS: Record<NodeType, string> = {
  news: '#f59e0b',
  market: '#3b82f6',
  social: '#10b981',
};

const EDGE_COLORS: Record<string, string> = {
  'social-market': '#6366f1',
  'news-market': '#f59e0b',
  'news-social': '#ec4899',
  'news-news': '#eab308',
};

const EDGE_LABELS: Record<string, string> = {
  'social-market': 'Social → Market',
  'news-market': 'News → Market',
  'news-social': 'News → Social',
  'news-news': 'News ↔ News',
};

// ── Helpers ──────────────────────────────────────────────────────

/** Get timestamp (epoch ms) from any node data type. */
function getTimestamp(data: NewsItem | MarketContract | SocialSignal): number {
  if ('headline' in data) return new Date(data.publishedAt).getTime();
  if ('question' in data) return data.lastUpdated ?? 0;
  if ('text' in data) return new Date(data.timestamp).getTime();
  return 0;
}

/**
 * Generate a fallback URL for social signals that don't have one.
 * Handles signals collected before the content script URL fix.
 */
function getSocialUrl(signal: SocialSignal): string | undefined {
  if (signal.url) return signal.url;
  // Try to reconstruct from platform + id
  if (signal.platform === 'reddit' && signal.id.startsWith('reddit:')) {
    return `https://www.reddit.com/search/?q=${encodeURIComponent(signal.text.slice(0, 80))}`;
  }
  if (signal.platform === 'x') {
    return `https://x.com/search?q=${encodeURIComponent(signal.text.replace(/^Trending:\s*/, '').slice(0, 80))}&f=live`;
  }
  if (signal.platform === 'tiktok') {
    const tagMatch = signal.text.match(/#([\w]+)/);
    if (tagMatch) return `https://www.tiktok.com/tag/${tagMatch[1]}`;
    return `https://www.tiktok.com/search?q=${encodeURIComponent(signal.text.slice(0, 80))}`;
  }
  return undefined;
}

/** Format relative time (e.g., "2h ago", "3d ago"). */
function timeAgo(epochMs: number): string {
  if (!epochMs) return '';
  const diff = Date.now() - epochMs;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Component ────────────────────────────────────────────────────

export function CorrelationPanelImpl({
  matches,
  newsMatches,
  newsSocialMatches,
  newsNewsMatches,
}: CorrelationPanelProps) {
  const [showGraph, setShowGraph] = useState(false);
  const [filter, setFilter] = useState<NodeType | 'all'>('all');
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const [tick, setTick] = useState(0);
  const [simulated, setSimulated] = useState(false);

  // Zoom & pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Build graph from correlation data
  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];

    const getNode = (
      id: string,
      type: NodeType,
      label: string,
      url: string | undefined,
      data: NewsItem | MarketContract | SocialSignal,
      importance: number,
    ): GraphNode => {
      if (nodeMap.has(id)) {
        const node = nodeMap.get(id)!;
        node.connections++;
        return node;
      }
      // Initialize node position near its type zone center
      const zone = ZONE_CENTERS[type];
      const angle = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 80;
      const node: GraphNode = {
        id,
        type,
        label,
        url,
        x: zone.x + Math.cos(angle) * r,
        y: zone.y + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        radius: 8 + importance * 12,
        color: NODE_COLORS[type],
        data,
        connections: 1,
        timestamp: getTimestamp(data),
      };
      nodeMap.set(id, node);
      return node;
    };

    const sortedSocial = [...matches].sort((a, b) => b.confidence - a.confidence).slice(0, 30);
    const sortedNews = [...newsMatches].sort((a, b) => b.confidence - a.confidence).slice(0, 30);
    const sortedNewsSocial = [...newsSocialMatches].sort((a, b) => b.confidence - a.confidence).slice(0, 30);
    const sortedNewsNews = [...newsNewsMatches].sort((a, b) => b.confidence - a.confidence).slice(0, 30);

    // Social → Market edges (direction: social signal → market contract)
    for (const m of sortedSocial) {
      const sNode = getNode(
        `s:${m.signal.id}`,
        'social',
        m.signal.text.slice(0, 50),
        getSocialUrl(m.signal),
        m.signal,
        m.signal.virality / 100,
      );
      const mNode = getNode(
        `m:${m.contract.id}`,
        'market',
        m.contract.question.slice(0, 50),
        m.contract.url,
        m.contract,
        Math.min(1, (m.contract.volume24h ?? 0) / 100000),
      );
      edgeList.push({
        source: sNode.id,
        target: mNode.id,
        confidence: m.confidence,
        keywords: m.matchedKeywords,
        edgeType: 'social-market',
        direction: 'forward',
      });
    }

    // News → Market edges (direction: news → market)
    for (const m of sortedNews) {
      const nNode = getNode(
        `n:${m.news.id}`,
        'news',
        m.news.headline.slice(0, 50),
        m.news.url,
        m.news,
        0.5,
      );
      const mNode = getNode(
        `m:${m.contract.id}`,
        'market',
        m.contract.question.slice(0, 50),
        m.contract.url,
        m.contract,
        Math.min(1, (m.contract.volume24h ?? 0) / 100000),
      );
      edgeList.push({
        source: nNode.id,
        target: mNode.id,
        confidence: m.confidence,
        keywords: m.matchedKeywords,
        edgeType: 'news-market',
        direction: 'forward',
      });
    }

    // News → Social edges — determine temporal direction
    for (const m of sortedNewsSocial) {
      const nNode = getNode(
        `n:${m.news.id}`,
        'news',
        m.news.headline.slice(0, 50),
        m.news.url,
        m.news,
        0.5,
      );
      const sNode = getNode(
        `s:${m.signal.id}`,
        'social',
        m.signal.text.slice(0, 50),
        getSocialUrl(m.signal),
        m.signal,
        m.signal.virality / 100,
      );
      // If news published before social post → news triggered social (forward)
      // If social post before news → social triggered news coverage (reverse)
      const newsTime = new Date(m.news.publishedAt).getTime();
      const socialTime = new Date(m.signal.timestamp).getTime();
      const direction = newsTime <= socialTime ? 'forward' : 'reverse';
      edgeList.push({
        source: nNode.id,
        target: sNode.id,
        confidence: m.confidence,
        keywords: m.matchedKeywords,
        edgeType: 'news-social',
        direction,
      });
    }

    // News ↔ News edges (CORR-06) — undirected, no temporal direction
    for (const m of sortedNewsNews) {
      const aNode = getNode(
        `n:${m.newsA.id}`,
        'news',
        m.newsA.headline.slice(0, 50),
        m.newsA.url,
        m.newsA,
        0.5,
      );
      const bNode = getNode(
        `n:${m.newsB.id}`,
        'news',
        m.newsB.headline.slice(0, 50),
        m.newsB.url,
        m.newsB,
        0.5,
      );
      edgeList.push({
        source: aNode.id,
        target: bNode.id,
        confidence: m.confidence,
        keywords: m.matchedKeywords,
        edgeType: 'news-news',
        direction: 'forward',
      });
    }

    // Limit graph size
    let nodeList = Array.from(nodeMap.values());
    let finalEdges = edgeList;

    if (nodeList.length > MAX_NODES) {
      nodeList.sort((a, b) => b.connections - a.connections);
      const keepIds = new Set(nodeList.slice(0, MAX_NODES).map((n) => n.id));
      nodeList = nodeList.filter((n) => keepIds.has(n.id));
      finalEdges = edgeList.filter(
        (e) => keepIds.has(e.source) && keepIds.has(e.target),
      );
    }
    if (finalEdges.length > MAX_EDGES) {
      finalEdges.sort((a, b) => b.confidence - a.confidence);
      finalEdges = finalEdges.slice(0, MAX_EDGES);
    }

    return { nodes: nodeList, edges: finalEdges };
  }, [matches, newsMatches, newsSocialMatches, newsNewsMatches]);

  // Run force simulation in chunked rAF frames to keep UI responsive.
  // Instead of running all 100 steps synchronously in one rAF (which blocks
  // the main thread for ~50-100ms), we run STEPS_PER_FRAME steps per rAF
  // and yield back to the browser between chunks. This allows the browser
  // to paint and handle input between simulation chunks.
  useEffect(() => {
    if (!showGraph || nodes.length === 0) {
      setSimulated(false);
      return;
    }

    nodesRef.current = nodes.map((n) => ({ ...n }));
    edgesRef.current = edges;
    setSimulated(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });

    let rafId: number;
    let step = 0;
    const ns = nodesRef.current;
    const es = edgesRef.current;

    // Pre-build node map for edge lookups (reused across chunks)
    const nodeMap = new Map(ns.map((n) => [n.id, n]));

    const runChunk = () => {
      const endStep = Math.min(step + STEPS_PER_FRAME, SIMULATION_STEPS);

      for (; step < endStep; step++) {
        // O(n²) repulsion — n is capped at MAX_NODES (60), so 3600 ops/step max.
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const dx = ns[j].x - ns[i].x;
            const dy = ns[j].y - ns[i].y;
            const distSq = dx * dx + dy * dy + 0.01;
            const dist = Math.sqrt(distSq);
            const force = REPULSION / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            ns[i].vx -= fx;
            ns[i].vy -= fy;
            ns[j].vx += fx;
            ns[j].vy += fy;
          }
        }

        // Spring forces along edges
        for (const e of es) {
          const s = nodeMap.get(e.source);
          const t = nodeMap.get(e.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH * (0.3 + e.confidence * 0.7);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          s.vx += fx;
          s.vy += fy;
          t.vx -= fx;
          t.vy -= fy;
        }

        // Pull each node toward its type zone center + apply damping
        for (const n of ns) {
          const zone = ZONE_CENTERS[n.type];
          n.vx += (zone.x - n.x) * CENTER_FORCE;
          n.vy += (zone.y - n.y) * CENTER_FORCE;
          n.vx *= DAMPING;
          n.vy *= DAMPING;
          n.x += n.vx;
          n.y += n.vy;
        }
      }

      // Update render after each chunk so the user sees progressive layout
      setTick((t) => t + 1);

      if (step < SIMULATION_STEPS) {
        // Schedule next chunk — yields to browser between frames
        rafId = requestAnimationFrame(runChunk);
      } else {
        setSimulated(true);
      }
    };

    rafId = requestAnimationFrame(runChunk);

    return () => cancelAnimationFrame(rafId);
  }, [showGraph, nodes, edges]);

  // Filter nodes for display — depends on tick (post-simulation) and filter
  const visibleNodes = useMemo(() => {
    if (filter === 'all') return nodesRef.current;
    return nodesRef.current.filter((n) => n.type === filter);
  }, [filter, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );

  const visibleEdges = useMemo(
    () =>
      edgesRef.current.filter(
        (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target),
      ),
    [visibleNodeIds, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Find edges connected to hovered node for highlighting
  const hoveredEdgeIds = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    return new Set(
      visibleEdges
        .filter((e) => e.source === hoveredNode.id || e.target === hoveredNode.id)
        .map((e) => `${e.source}-${e.target}`),
    );
  }, [hoveredNode, visibleEdges]);

  // Handle node hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent, node: GraphNode) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
      setHoveredNode(node);
    },
    [],
  );

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (node.url) {
      window.open(node.url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  // Zoom & pan handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.3, Math.min(3, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag if clicking on SVG background (not a node)
    if (e.target === svgRef.current || (e.target as Element).tagName === 'rect') {
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    }
  }, [pan]);

  const handleMouseMoveSvg = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(3, z * 1.2)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.3, z * 0.8)), []);
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Stats
  const stats = useMemo(() => {
    const newsCount = nodes.filter((n) => n.type === 'news').length;
    const marketCount = nodes.filter((n) => n.type === 'market').length;
    const socialCount = nodes.filter((n) => n.type === 'social').length;
    return { newsCount, marketCount, socialCount, total: nodes.length, edges: edges.length };
  }, [nodes, edges]);

  // SVG transform for zoom/pan
  const svgTransform = `translate(${pan.x}, ${pan.y}) scale(${zoom})`;

  // Memoized list-view items — avoid re-sorting on every render
  const socialListItems = useMemo(
    () =>
      [...matches]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 15)
        .map((m) => ({
          id: `sm-${m.signal.id}-${m.contract.id}`,
          confidence: m.confidence,
          keywords: m.matchedKeywords,
          primary: m.contract.question,
          secondary: m.signal.text,
          source: m.signal.platform,
          target: m.contract.platform,
          sourceUrl: getSocialUrl(m.signal),
          targetUrl: m.contract.url,
        })),
    [matches],
  );

  const newsListItems = useMemo(
    () =>
      [...newsMatches]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 15)
        .map((m) => ({
          id: `nm-${m.news.id}-${m.contract.id}`,
          confidence: m.confidence,
          keywords: m.matchedKeywords,
          primary: m.contract.question,
          secondary: m.news.headline,
          source: m.news.source,
          target: m.contract.platform,
          sourceUrl: m.news.url,
          targetUrl: m.contract.url,
        })),
    [newsMatches],
  );

  const newsSocialListItems = useMemo(
    () =>
      [...newsSocialMatches]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 15)
        .map((m) => ({
          id: `ns-${m.news.id}-${m.signal.id}`,
          confidence: m.confidence,
          keywords: m.matchedKeywords,
          primary: m.news.headline,
          secondary: m.signal.text,
          source: m.news.source,
          target: m.signal.platform,
          sourceUrl: m.news.url,
          // Prefer the signal's own URL; fall back to a reconstructed search
          // link so every news→social card is clickable.
          targetUrl: getSocialUrl(m.signal),
        })),
    [newsSocialMatches],
  );

  const newsNewsListItems = useMemo(
    () =>
      [...newsNewsMatches]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 15)
        .map((m) => ({
          id: `nn-${m.newsA.id}-${m.newsB.id}`,
          confidence: m.confidence,
          keywords: m.matchedKeywords,
          primary: m.newsA.headline,
          secondary: m.newsB.headline,
          source: m.newsA.source,
          target: m.newsB.source,
          sourceUrl: m.newsA.url,
          targetUrl: m.newsB.url,
        })),
    [newsNewsMatches],
  );

  // ── Render ────────────────────────────────────────────────────

  if (nodes.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-slate-500 text-sm text-center py-8">
          No correlations found yet. Collect more data to see the network graph.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="font-bold text-slate-300">
            {stats.total} nodes · {stats.edges} edges
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            News {stats.newsCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            Markets {stats.marketCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            Social {stats.socialCount}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-slate-700">
            <button
              onClick={() => setShowGraph(true)}
              className={`px-3 py-1 text-xs font-medium ${
                showGraph ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              Graph
            </button>
            <button
              onClick={() => setShowGraph(false)}
              className={`px-3 py-1 text-xs font-medium ${
                !showGraph ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              List
            </button>
          </div>

          {showGraph && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as NodeType | 'all')}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1"
            >
              <option value="all">All Nodes</option>
              <option value="news">News Only</option>
              <option value="market">Markets Only</option>
              <option value="social">Social Only</option>
            </select>
          )}
        </div>
      </div>

      {/* Graph view */}
      {showGraph ? (
        <div className="relative bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <svg
            ref={svgRef}
            width="100%"
            height="600"
            viewBox="0 0 800 600"
            className="block"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMoveSvg}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Arrowhead markers for directed edges */}
            <defs>
              {Object.entries(EDGE_COLORS).map(([type, color]) => (
                <marker
                  key={type}
                  id={`arrow-${type}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
                </marker>
              ))}
              {/* Highlighted arrow markers */}
              {Object.entries(EDGE_COLORS).map(([type, color]) => (
                <marker
                  key={`arrow-hl-${type}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity="1" />
                </marker>
              ))}
            </defs>

            {/* Invisible background rect for drag detection */}
            <rect x="0" y="0" width="800" height="600" fill="transparent" />

            {/* Transform group for zoom/pan */}
            <g transform={svgTransform}>
              {/* Zone background circles — faint labeled areas for each node type */}
              {(Object.entries(ZONE_CENTERS) as [NodeType, { x: number; y: number }][]).map(
                ([type, center]) => (
                  <g key={`zone-${type}`} style={{ pointerEvents: 'none' }}>
                    <circle
                      cx={center.x}
                      cy={center.y}
                      r={ZONE_RADIUS}
                      fill={NODE_COLORS[type]}
                      opacity={0.04}
                    />
                    <circle
                      cx={center.x}
                      cy={center.y}
                      r={ZONE_RADIUS}
                      fill="none"
                      stroke={NODE_COLORS[type]}
                      strokeWidth="1"
                      opacity={0.15}
                      strokeDasharray="4 4"
                    />
                    <text
                      x={center.x}
                      y={center.y - ZONE_RADIUS - 6}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill={NODE_COLORS[type]}
                      opacity={0.5}
                    >
                      {type === 'news' ? '📰 NEWS' : type === 'market' ? '📊 MARKETS' : '👽 SOCIAL'}
                    </text>
                  </g>
                ),
              )}
              {/* Edges */}
              {visibleEdges.map((edge, i) => {
                const s = nodesRef.current.find((n) => n.id === edge.source);
                const t = nodesRef.current.find((n) => n.id === edge.target);
                if (!s || !t) return null;

                // Calculate edge endpoints offset by node radius
                const dx = t.x - s.x;
                const dy = t.y - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
                const ux = dx / dist;
                const uy = dy / dist;

                // For reverse edges, swap direction
                const fromNode = edge.direction === 'forward' ? s : t;
                const toNode = edge.direction === 'forward' ? t : s;

                const x1 = fromNode.x + ux * fromNode.radius;
                const y1 = fromNode.y + uy * fromNode.radius;
                const x2 = toNode.x - ux * (toNode.radius + 4); // offset for arrowhead
                const y2 = toNode.y - uy * (toNode.radius + 4);

                const edgeId = `${edge.source}-${edge.target}`;
                const isHighlighted = hoveredEdgeIds.has(edgeId);
                const isDimmed = hoveredNode && !isHighlighted;

                return (
                  <line
                    key={`edge-${i}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={EDGE_COLORS[edge.edgeType]}
                    strokeWidth={isHighlighted ? 3 + edge.confidence * 4 : 1 + edge.confidence * 2}
                    opacity={isDimmed ? 0.05 : isHighlighted ? 0.9 : 0.15 + edge.confidence * 0.4}
                    markerEnd={`url(#arrow-${isHighlighted ? 'hl-' : ''}${edge.edgeType})`}
                  />
                );
              })}

              {/* Nodes */}
              {visibleNodes.map((node) => {
                const isHighlighted =
                  hoveredNode?.id === node.id ||
                  (hoveredNode && visibleEdges.some(
                    (e) =>
                      (e.source === hoveredNode.id && e.target === node.id) ||
                      (e.target === hoveredNode.id && e.source === node.id),
                  ));
                const isDimmed = hoveredNode && !isHighlighted;

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    style={{ cursor: node.url ? 'pointer' : 'default' }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseMove={(e) => handleMouseMove(e, node)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNodeClick(node);
                    }}
                    opacity={isDimmed ? 0.3 : 1}
                  >
                    {node.connections > 3 && (
                      <circle
                        r={node.radius + 4}
                        fill="none"
                        stroke={node.color}
                        strokeWidth="1"
                        opacity="0.3"
                      />
                    )}
                    <circle
                      r={node.radius}
                      fill={node.color}
                      opacity={0.85}
                      stroke={hoveredNode?.id === node.id ? '#fff' : 'none'}
                      strokeWidth="2"
                    />
                    <text
                      textAnchor="middle"
                      dy="0.35em"
                      fontSize={node.radius * 0.8}
                      fill="#0f172a"
                      fontWeight="bold"
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.type === 'news' ? '📰' : node.type === 'market' ? '📊' : '👽'}
                    </text>
                    {/* Show label for highlighted or high-connection nodes */}
                    {(isHighlighted || node.connections > 5) && (
                      <text
                        textAnchor="middle"
                        dy={node.radius + 12}
                        fontSize="9"
                        fill="#cbd5e1"
                        style={{ pointerEvents: 'none' }}
                      >
                        {node.label.slice(0, 30)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Zoom controls */}
          <div className="absolute top-2 right-2 flex flex-col gap-1">
            <button
              onClick={zoomIn}
              className="w-8 h-8 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors text-lg"
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={zoomOut}
              className="w-8 h-8 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors text-lg"
              title="Zoom out"
            >
              −
            </button>
            <button
              onClick={resetView}
              className="w-8 h-8 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors text-xs"
              title="Reset view"
            >
              ⊙
            </button>
          </div>

          {/* Zoom level indicator */}
          <div className="absolute top-2 left-2 text-xs text-slate-500 bg-slate-950/80 rounded px-2 py-1">
            {Math.round(zoom * 100)}%
          </div>

          {/* Tooltip */}
          {hoveredNode && (
            <div
              className="absolute pointer-events-none z-10 max-w-xs bg-slate-950 border border-slate-700 rounded-lg p-3 shadow-xl"
              style={{
                left: Math.min(tooltipPos.x + 12, 600),
                top: Math.min(tooltipPos.y + 12, 400),
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: hoveredNode.color }}
                />
                <span className="text-xs font-bold text-slate-300 uppercase">
                  {hoveredNode.type}
                </span>
                <span className="text-xs text-slate-500">
                  {hoveredNode.connections} connections
                </span>
              </div>
              <p className="text-sm text-slate-200 line-clamp-3">
                {hoveredNode.label}
              </p>
              {/* Type-specific details */}
              {'platform' in hoveredNode.data && hoveredNode.type === 'social' && (
                <p className="text-xs text-slate-500 mt-1">
                  {(hoveredNode.data as SocialSignal).platform} · virality {(hoveredNode.data as SocialSignal).virality}
                  {hoveredNode.timestamp > 0 && ` · ${timeAgo(hoveredNode.timestamp)}`}
                </p>
              )}
              {'question' in hoveredNode.data && hoveredNode.type === 'market' && (
                <p className="text-xs text-slate-500 mt-1">
                  {(hoveredNode.data as MarketContract).platform}
                  {(hoveredNode.data as MarketContract).volume24h != null && ` · $${Math.round((hoveredNode.data as MarketContract).volume24h!).toLocaleString()}`}
                </p>
              )}
              {'headline' in hoveredNode.data && hoveredNode.type === 'news' && (
                <p className="text-xs text-slate-500 mt-1">
                  {(hoveredNode.data as NewsItem).source}
                  {hoveredNode.timestamp > 0 && ` · ${timeAgo(hoveredNode.timestamp)}`}
                </p>
              )}
              {hoveredNode.url && (
                <p className="text-xs text-brand-400 mt-1">Click to open ↗</p>
              )}
            </div>
          )}

          {/* Edge legend */}
          <div className="absolute bottom-2 left-2 flex flex-col gap-1 text-[10px] text-slate-500 bg-slate-950/80 rounded-lg p-2">
            {Object.entries(EDGE_LABELS).map(([type, label]) => (
              <span key={type} className="flex items-center gap-1">
                <span
                  className="w-4 h-0.5"
                  style={{ background: EDGE_COLORS[type] }}
                />
                {label}
              </span>
            ))}
            <span className="text-slate-600 mt-1">Arrows show direction</span>
          </div>

          {/* Help text */}
          <div className="absolute bottom-2 right-2 text-[10px] text-slate-600 bg-slate-950/80 rounded px-2 py-1">
            Scroll to zoom · Drag to pan
          </div>

          {!simulated && (
            <div className="absolute top-12 right-2 text-xs text-slate-500 bg-slate-950/80 rounded px-2 py-1">
              Simulating layout…
            </div>
          )}
        </div>
      ) : (
        /* List view */
        <div className="space-y-4">
          <CorrelationList
            title="📊 Social → Market"
            count={matches.length}
            items={socialListItems}
          />

          <CorrelationList
            title="📰 News → Market"
            count={newsMatches.length}
            items={newsListItems}
          />

          <CorrelationList
            title="📰→👽 News → Social"
            count={newsSocialMatches.length}
            items={newsSocialListItems}
          />

          <CorrelationList
            title="📰↔📰 News ↔ News"
            count={newsNewsMatches.length}
            items={newsNewsListItems}
          />
        </div>
      )}
    </div>
  );
}

export const CorrelationPanel = memo(CorrelationPanelImpl);

// ── List view sub-component ──────────────────────────────────────

interface ListItem {
  id: string;
  confidence: number;
  keywords: string[];
  primary: string;
  secondary: string;
  source: string;
  target: string;
  /** Link to the source entity (news article / social post). */
  sourceUrl?: string;
  /** Link to the correlated target entity (market contract / social post). */
  targetUrl?: string;
}

function CorrelationList({
  title,
  count,
  items,
}: {
  title: string;
  count: number;
  items: ListItem[];
}) {
  if (count === 0) {
    return (
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
          {title} (0)
        </h3>
        <p className="text-slate-500 text-sm text-center py-4">No matches found.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
        {title} ({count})
      </h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-lg p-3 bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">
                {item.source} → {item.target}
              </span>
              <span className="text-xs font-bold text-brand-400">
                {Math.round(item.confidence * 100)}% match
              </span>
            </div>
            <p className="text-sm text-slate-200 line-clamp-1">{item.primary}</p>
            <p className="text-xs text-slate-400 line-clamp-1 mt-1">&ldquo;{item.secondary}&rdquo;</p>
            {item.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {item.keywords.slice(0, 5).map((kw) => (
                  <span
                    key={kw}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            )}
            {(item.sourceUrl || item.targetUrl) && (
              <div className="flex flex-wrap gap-2 mt-2">
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] px-2 py-1 rounded bg-slate-800 text-brand-400 hover:bg-slate-700 transition-colors"
                  >
                    Open {item.source} ↗
                  </a>
                )}
                {item.targetUrl && (
                  <a
                    href={item.targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] px-2 py-1 rounded bg-slate-800 text-brand-400 hover:bg-slate-700 transition-colors"
                  >
                    Open {item.target} ↗
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}