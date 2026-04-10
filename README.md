# Vault Dashboard

**Live Demo:** [https://outblade.github.io/obsidian-vault-dashboard/demo.html](https://outblade.github.io/obsidian-vault-dashboard/demo.html)

An Obsidian plugin that replaces the blank new-tab with an interactive dashboard: live vault stats, a force-directed knowledge graph, a tag cloud, and a recently modified file list — all updating in real time as you write.

```
┌─ Vault Dashboard ────────────────────────────────── demo-vault ─┐
│                                                                  │
│  88 Notes    36,112 Words    126 Links    34 Tags               │
│                                                                  │
├──────────────────────────────────────┬───────────────────────── │
│                                      │ Top Tags                 │
│    ·  Writing MOC                    │                          │
│   /|\                                │ #javascript  #reading    │
│  · · ·  ←── cluster                 │ #fiction  #reflection    │
│     |        (colored                │ #algorithms  #ethics     │
│  · Science MOC ·                     │ #writing  #daily         │
│   \   /                              │                          │
│    · ·  Programming MOC              ├──────────────────────────│
│         /    \                       │ Recently Modified        │
│        ·      ·                      │                          │
│                                      │ ● The Problem of Evil 5m │
│  [drag] [scroll=zoom] [pan]          │ ● Database Indexing  6h  │
│  [dblclick = open note]              │ ● The Essay Form    21h  │
└──────────────────────────────────────┴──────────────────────────┘
```

## Features

- Force-directed knowledge graph with topic clustering — notes in the same folder/topic attract each other
- Nodes colored and sized by topic and connection count; hub notes (MOCs) are ringed and larger
- Drag nodes to reposition, scroll to zoom, pan freely, double-click to open a note
- Click any legend entry to dim/hide an entire topic cluster
- Hover a node to highlight its connections and see a metadata tooltip
- Live stats: total notes, estimated word count, total links, unique tags
- Tag cloud scaled by frequency
- Recently modified list with relative timestamps, click to navigate
- All panels update automatically as you create, delete, or modify notes
- Configurable max graph nodes and label visibility via plugin settings

## Browser Demo

The standalone `demo.html` runs entirely in the browser with no build step and no Obsidian required. It generates a synthetic 88-note vault across 8 topic clusters and lets you interact with the full graph.

Open it locally:

```
obsidian-vault-dashboard/demo.html
```

Or try it live: [outblade.github.io/obsidian-vault-dashboard/demo.html](https://outblade.github.io/obsidian-vault-dashboard/demo.html)

The "Simulate Writing" button adds a new note every 1.2 seconds and re-runs the physics simulation live.

## Installation (Obsidian Plugin)

**From source:**

```bash
git clone https://github.com/OutBlade/obsidian-vault-dashboard
cd obsidian-vault-dashboard
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into your vault:

```
<YourVault>/.obsidian/plugins/vault-dashboard/
```

Then in Obsidian: Settings → Community plugins → enable **Vault Dashboard**.

A grid icon appears in the ribbon. You can also use the command palette: `Open Vault Dashboard`.

**Manual (no build):**

Download `main.js`, `manifest.json`, and `styles.css` from the latest release and drop them into the plugin folder above.

## Settings

| Setting | Default | Description |
|---|---|---|
| Maximum graph nodes | 150 | Limits nodes shown; top-N by link count are selected |
| Show labels | on | Toggle note name labels on the graph |

## License

MIT
