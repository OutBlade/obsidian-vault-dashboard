import {
  App,
  debounce,
  ItemView,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE = "vault-dashboard";

// ── Types ────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  pinned: boolean;
}

interface GraphEdge {
  source: number;
  target: number;
}

interface VaultStats {
  noteCount: number;
  wordCount: number;
  linkCount: number;
  tagFreq: [string, number][];
  recent: TFile[];
}

interface DashboardSettings {
  maxNodes: number;
  showLabels: boolean;
}

const DEFAULT_SETTINGS: DashboardSettings = {
  maxNodes: 150,
  showLabels: true,
};

// ── Force simulation ──────────────────────────────────────────────────────────

function simulateStep(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  alpha: number
): void {
  const cx = width / 2;
  const cy = height / 2;

  // Repulsion between all node pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dist2 = dx * dx + dy * dy + 1;
      const f = (2200 * alpha) / dist2;
      nodes[i].vx -= dx * f;
      nodes[i].vy -= dy * f;
      nodes[j].vx += dx * f;
      nodes[j].vy += dy * f;
    }
  }

  // Spring attraction along edges
  for (const edge of edges) {
    const a = nodes[edge.source];
    const b = nodes[edge.target];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
    const f = ((dist - 90) / dist) * 0.28 * alpha;
    a.vx += dx * f;
    a.vy += dy * f;
    b.vx -= dx * f;
    b.vy -= dy * f;
  }

  // Centering pull
  for (const node of nodes) {
    node.vx += (cx - node.x) * 0.008 * alpha;
    node.vy += (cy - node.y) * 0.008 * alpha;
  }

  // Integrate
  for (const node of nodes) {
    if (node.pinned) continue;
    node.vx *= 0.84;
    node.vy *= 0.84;
    node.x = Math.max(16, Math.min(width - 16, node.x + node.vx));
    node.y = Math.max(16, Math.min(height - 16, node.y + node.vy));
  }
}

function degreeColor(degree: number, maxDegree: number): string {
  const t = maxDegree > 0 ? degree / maxDegree : 0;
  // Blue (#4a9eff) → Purple (#9b59b6) → Orange (#ff6b35)
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(74 + (155 - 74) * s);
    g = Math.round(158 + (89 - 158) * s);
    b = Math.round(255 + (182 - 255) * s);
  } else {
    const s = (t - 0.5) * 2;
    r = Math.round(155 + (255 - 155) * s);
    g = Math.round(89 + (107 - 89) * s);
    b = Math.round(182 + (53 - 182) * s);
  }
  return `rgb(${r},${g},${b})`;
}

// ── Dashboard View ────────────────────────────────────────────────────────────

class DashboardView extends ItemView {
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private alpha = 1;
  private pan = { x: 0, y: 0 };
  private zoom = 1;
  private dragging: GraphNode | null = null;
  private panning = false;
  private lastMouse = { x: 0, y: 0 };
  private settings: DashboardSettings;

  constructor(leaf: WorkspaceLeaf, settings: DashboardSettings) {
    super(leaf);
    this.settings = settings;
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Vault Dashboard"; }
  getIcon(): string { return "layout-dashboard"; }

  async onOpen() {
    this.buildUI();
    await this.refresh();

    const debouncedRefresh = debounce(() => this.refresh(), 1500, true);
    this.registerEvent(this.app.vault.on("create", debouncedRefresh));
    this.registerEvent(this.app.vault.on("delete", debouncedRefresh));
    this.registerEvent(this.app.vault.on("rename", debouncedRefresh));
    this.registerEvent(this.app.metadataCache.on("changed", debouncedRefresh));
  }

  onClose() {
    cancelAnimationFrame(this.raf);
  }

  // ── UI construction ─────────────────────────────────────────────────────────

  private buildUI() {
    const root = this.contentEl;
    root.empty();
    root.addClass("vd-root");

    const header = root.createEl("div", { cls: "vd-header" });
    header.createEl("span", { cls: "vd-title", text: "Vault Dashboard" });
    const btn = header.createEl("button", { cls: "vd-btn", text: "Refresh" });
    btn.addEventListener("click", () => this.refresh());

    root.createEl("div", { cls: "vd-stats", attr: { id: "vd-stats" } });

    const graphSec = root.createEl("div", { cls: "vd-graph-section" });
    graphSec.createEl("div", { cls: "vd-section-label", text: "Knowledge Graph" });
    const hint = graphSec.createEl("div", { cls: "vd-graph-hint" });
    hint.createEl("span", { text: "Drag nodes   Scroll to zoom   Pan with mouse   Double-click to open note" });
    const wrap = graphSec.createEl("div", { cls: "vd-canvas-wrap" });
    this.canvas = wrap.createEl("canvas", { cls: "vd-canvas" });
    this.setupMouseEvents();

    const bottom = root.createEl("div", { cls: "vd-bottom" });

    const tagsPanel = bottom.createEl("div", { cls: "vd-panel" });
    tagsPanel.createEl("div", { cls: "vd-section-label", text: "Top Tags" });
    tagsPanel.createEl("div", { cls: "vd-tag-cloud", attr: { id: "vd-tags" } });

    const recentPanel = bottom.createEl("div", { cls: "vd-panel" });
    recentPanel.createEl("div", { cls: "vd-section-label", text: "Recently Modified" });
    recentPanel.createEl("div", { cls: "vd-recent", attr: { id: "vd-recent" } });
  }

  // ── Mouse interaction ───────────────────────────────────────────────────────

  private setupMouseEvents() {
    const c = this.canvas;
    if (!c) return;

    c.addEventListener("mousedown", (e) => {
      const p = this.toWorld(e.offsetX, e.offsetY);
      const hit = this.hitTest(p.x, p.y);
      if (hit) {
        this.dragging = hit;
        hit.pinned = true;
      } else {
        this.panning = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });

    c.addEventListener("mousemove", (e) => {
      if (this.dragging) {
        const p = this.toWorld(e.offsetX, e.offsetY);
        this.dragging.x = p.x;
        this.dragging.y = p.y;
        this.dragging.vx = 0;
        this.dragging.vy = 0;
      } else if (this.panning) {
        this.pan.x += e.clientX - this.lastMouse.x;
        this.pan.y += e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });

    c.addEventListener("mouseup", () => {
      if (this.dragging) {
        this.dragging.pinned = false;
        this.dragging = null;
        this.alpha = Math.max(this.alpha, 0.3);
      }
      this.panning = false;
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.1, Math.min(8, this.zoom * factor));
    }, { passive: false });

    c.addEventListener("dblclick", (e) => {
      const p = this.toWorld(e.offsetX, e.offsetY);
      const hit = this.hitTest(p.x, p.y);
      if (!hit) return;
      const file = this.app.vault.getAbstractFileByPath(hit.id);
      if (file instanceof TFile) {
        this.app.workspace.getLeaf().openFile(file);
      }
    });
  }

  private toWorld(cx: number, cy: number) {
    return { x: (cx - this.pan.x) / this.zoom, y: (cy - this.pan.y) / this.zoom };
  }

  private hitTest(x: number, y: number): GraphNode | null {
    for (const n of this.nodes) {
      const r = this.nodeRadius(n) + 4;
      const dx = n.x - x, dy = n.y - y;
      if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
  }

  private nodeRadius(n: GraphNode): number {
    return 4 + Math.min(n.degree, 14) * 0.9;
  }

  // ── Data gathering ──────────────────────────────────────────────────────────

  async refresh() {
    const stats = await this.gatherStats();
    this.renderStats(stats);
    this.renderTags(stats.tagFreq);
    this.renderRecent(stats.recent);
    this.buildGraph();
    this.alpha = 1;
    this.startRenderLoop();
  }

  private async gatherStats(): Promise<VaultStats> {
    const files = this.app.vault.getMarkdownFiles();
    let wordCount = 0;
    let linkCount = 0;
    const tagFreqMap = new Map<string, number>();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;

      linkCount += cache.links?.length ?? 0;

      // Approximate word count from section offsets
      for (const section of cache.sections ?? []) {
        wordCount += Math.round(
          (section.position.end.offset - section.position.start.offset) / 5
        );
      }

      const tags = [
        ...(cache.tags?.map(t => t.tag.replace(/^#/, "")) ?? []),
        ...(Array.isArray(cache.frontmatter?.tags) ? cache.frontmatter.tags : []),
      ];
      for (const tag of tags) {
        const t = String(tag).replace(/^#/, "").trim();
        if (t) tagFreqMap.set(t, (tagFreqMap.get(t) ?? 0) + 1);
      }
    }

    const tagFreq = [...tagFreqMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24);

    const recent = [...files]
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 10);

    return { noteCount: files.length, wordCount, linkCount, tagFreq, recent };
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  private renderStats(stats: VaultStats) {
    const el = this.contentEl.querySelector<HTMLElement>("#vd-stats");
    if (!el) return;
    el.empty();

    for (const [value, label] of [
      [stats.noteCount.toLocaleString(), "Notes"],
      [stats.wordCount.toLocaleString(), "Words (est.)"],
      [stats.linkCount.toLocaleString(), "Links"],
      [stats.tagFreq.length.toLocaleString(), "Tags"],
    ] as [string, string][]) {
      const card = el.createEl("div", { cls: "vd-stat" });
      card.createEl("div", { cls: "vd-stat-value", text: value });
      card.createEl("div", { cls: "vd-stat-label", text: label });
    }
  }

  private renderTags(tagFreq: [string, number][]) {
    const el = this.contentEl.querySelector<HTMLElement>("#vd-tags");
    if (!el) return;
    el.empty();

    if (tagFreq.length === 0) {
      el.createEl("span", { cls: "vd-empty", text: "No tags found" });
      return;
    }

    const max = tagFreq[0][1];
    for (const [tag, count] of tagFreq) {
      const t = el.createEl("span", { cls: "vd-tag-chip", text: `#${tag}` });
      t.style.fontSize = `${0.78 + (count / max) * 0.7}em`;
      t.style.opacity = String(0.45 + (count / max) * 0.55);
      t.title = `${count} note${count !== 1 ? "s" : ""}`;
    }
  }

  private renderRecent(files: TFile[]) {
    const el = this.contentEl.querySelector<HTMLElement>("#vd-recent");
    if (!el) return;
    el.empty();

    if (files.length === 0) {
      el.createEl("span", { cls: "vd-empty", text: "No notes yet" });
      return;
    }

    for (const file of files) {
      const row = el.createEl("div", { cls: "vd-recent-row" });
      const name = row.createEl("span", { cls: "vd-recent-name", text: file.basename });
      name.addEventListener("click", () => this.app.workspace.getLeaf().openFile(file));
      row.createEl("span", { cls: "vd-recent-age", text: this.formatAge(file.stat.mtime) });
    }
  }

  private formatAge(mtime: number): string {
    const m = Math.floor((Date.now() - mtime) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  // ── Graph ───────────────────────────────────────────────────────────────────

  private buildGraph() {
    const files = this.app.vault.getMarkdownFiles();
    const maxNodes = this.settings.maxNodes;

    const ranked = files
      .map(f => ({
        file: f,
        links: this.app.metadataCache.getFileCache(f)?.links?.length ?? 0,
      }))
      .sort((a, b) => b.links - a.links)
      .slice(0, maxNodes);

    const nodeMap = new Map<string, number>();
    const w = this.canvas?.width ?? 600;
    const h = this.canvas?.height ?? 400;

    this.nodes = ranked.map(({ file }, i) => {
      nodeMap.set(file.path, i);
      const prev = this.nodes[i];
      return {
        id: file.path,
        label: file.basename,
        x: prev?.x ?? w / 2 + (Math.random() - 0.5) * 300,
        y: prev?.y ?? h / 2 + (Math.random() - 0.5) * 300,
        vx: 0,
        vy: 0,
        degree: 0,
        pinned: false,
      };
    });

    this.edges = [];
    const seen = new Set<string>();

    for (const { file } of ranked) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.links) continue;
      const si = nodeMap.get(file.path);
      if (si === undefined) continue;

      for (const link of cache.links) {
        const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
        if (!target) continue;
        const ti = nodeMap.get(target.path);
        if (ti === undefined || ti === si) continue;

        const key = si < ti ? `${si}-${ti}` : `${ti}-${si}`;
        if (seen.has(key)) continue;
        seen.add(key);

        this.edges.push({ source: si, target: ti });
        this.nodes[si].degree++;
        this.nodes[ti].degree++;
      }
    }
  }

  // ── Render loop ─────────────────────────────────────────────────────────────

  private startRenderLoop() {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      if (this.alpha > 0.002) {
        const steps = this.alpha > 0.6 ? 4 : this.alpha > 0.2 ? 2 : 1;
        for (let i = 0; i < steps; i++) {
          simulateStep(
            this.nodes, this.edges,
            this.canvas?.width ?? 600, this.canvas?.height ?? 400,
            this.alpha
          );
        }
        this.alpha *= 0.992;
      }
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private draw() {
    const canvas = this.canvas;
    if (!canvas) return;

    // Sync canvas size to its container
    const wrap = canvas.parentElement;
    if (wrap && (canvas.width !== wrap.clientWidth || canvas.height !== wrap.clientHeight)) {
      canvas.width = wrap.clientWidth;
      canvas.height = wrap.clientHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;

    // Background fill using Obsidian CSS variable
    const bg = getComputedStyle(this.contentEl)
      .getPropertyValue("--background-secondary").trim() || "#1a1b26";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.pan.x, this.pan.y);
    ctx.scale(this.zoom, this.zoom);

    if (this.nodes.length === 0) {
      ctx.restore();
      ctx.fillStyle = getComputedStyle(this.contentEl)
        .getPropertyValue("--text-faint").trim() || "#555";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No notes in vault", w / 2, h / 2);
      return;
    }

    const maxDeg = Math.max(1, ...this.nodes.map(n => n.degree));

    // Edges
    ctx.strokeStyle = "rgba(140,140,160,0.2)";
    ctx.lineWidth = 0.8 / this.zoom;
    ctx.beginPath();
    for (const edge of this.edges) {
      const a = this.nodes[edge.source], b = this.nodes[edge.target];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // Nodes
    for (const node of this.nodes) {
      const r = this.nodeRadius(node);
      const color = degreeColor(node.degree, maxDeg);

      // Soft glow
      const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3);
      const [rv, gv, bv] = color.match(/\d+/g)!.map(Number);
      grd.addColorStop(0, `rgba(${rv},${gv},${bv},0.22)`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Bright center
      ctx.beginPath();
      ctx.arc(node.x - r * 0.25, node.y - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
    }

    // Labels
    if (this.settings.showLabels) {
      const textColor = getComputedStyle(this.contentEl)
        .getPropertyValue("--text-muted").trim() || "#aaa";
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";

      for (const node of this.nodes) {
        const isHub = node.degree > maxDeg * 0.25;
        if (!isHub && this.zoom < 0.7) continue;
        const r = this.nodeRadius(node);
        const fontSize = Math.round(Math.max(8, Math.min(13, 11 / this.zoom)));
        ctx.font = `${fontSize}px var(--font-interface, sans-serif)`;
        ctx.fillText(
          node.label.length > 22 ? node.label.slice(0, 20) + "…" : node.label,
          node.x,
          node.y + r + fontSize + 1
        );
      }
    }

    ctx.restore();
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default class VaultDashboardPlugin extends Plugin {
  settings: DashboardSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this.settings));

    this.addRibbonIcon("layout-dashboard", "Open Vault Dashboard", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-vault-dashboard",
      name: "Open Vault Dashboard",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new DashboardSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ── Settings tab ──────────────────────────────────────────────────────────────

class DashboardSettingTab extends PluginSettingTab {
  plugin: VaultDashboardPlugin;

  constructor(app: App, plugin: VaultDashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Vault Dashboard Settings" });

    new Setting(containerEl)
      .setName("Maximum graph nodes")
      .setDesc("Limit how many notes appear in the knowledge graph. Lower values improve performance for large vaults.")
      .addSlider(slider =>
        slider
          .setLimits(20, 500, 10)
          .setValue(this.plugin.settings.maxNodes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxNodes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show labels")
      .setDesc("Display note names beneath nodes in the knowledge graph.")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.showLabels)
          .onChange(async (value) => {
            this.plugin.settings.showLabels = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
