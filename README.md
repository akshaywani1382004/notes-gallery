# Notes Gallery

A personal, nested **block workspace**. Every block sits on an infinite canvas,
can be connected to other blocks with lines, and can be **opened to reveal its
own inner canvas** — blocks inside blocks, as deep as you like. Each block holds
a title, accent colour, description, notes, and file attachments (PDFs, images,
diagrams, anything).

Minimal editorial look. Pure HTML / CSS / JavaScript. No build step, no
dependencies, works offline.

---

## Start here

**On your computer** — just double-click **`index.html`**. That's it.

**On your phone (optional)** — double-click **`Start Notes Gallery.bat`** on the
PC (uses your existing Python). It prints an address like
`http://192.168.x.x:8765/` — open that on your phone while it's on the **same
Wi-Fi**. Keep the window open while you use it.

---

## Workspaces

The app opens on a **workspaces** screen. Each workspace is a completely separate
canvas of blocks/lists/files.

- **New workspace** / **Import** buttons are top-right on that screen.
- Each workspace card has **rename**, **export**, and **delete** actions on hover.
- Click a card to open it. Click the **Notes Gallery** logo (top-left) anytime to
  go back to the workspaces screen.
- **Export workspace** (card action, or More menu inside a workspace) writes a
  single portable `*.notesgallery.json` — it contains everything, including your
  uploaded files. **Import** it on any device to recreate that exact workspace.

## How to use

| Action | Do this |
|---|---|
| Add a block | Click **Block**, double-click empty canvas, or press `N` |
| Move a block | Drag it |
| Pan the canvas | Drag empty space (one finger on phone) |
| Zoom | Mouse wheel, pinch, or the zoom buttons |
| Fit everything | Frame button, or press `F` |
| Open a block (go inside) | Double-click it, or **Open inside** in the editor |
| Edit a block | Single-click it — the editor opens and **autosaves** |
| Attach files | In the editor: **Upload** or drag files onto the drop zone |
| View / download a file | Use the buttons on the file row |
| Connect two blocks | Toggle the link tool, tap block A then block B. Click a line to remove it |
| Go back up | Use the breadcrumb trail (Home / … ) top-left |
| Search everything | Top search box (titles, notes, file names), or press `/` |
| Delete a block | Editor → **Delete** (removes everything inside it too) |
| Switch theme | Sun / moon button |

Keyboard: `N` new · `L` link · `F` fit · `/` search · `Del` delete selected · `Esc` close.

---

## Where is my data? (important)

Your notes and files are stored **inside the browser** (IndexedDB) on the device
you're using. Private and offline — but it is **not** the same copy across
devices, and it lives in the browser profile, not as loose files in `Storage/`.

To back up or move between phone and computer:

1. **More → Export workspace** downloads one `.json` containing everything
   (blocks, connections, and all attached files).
2. Save that file into your **`Storage/`** folder to keep it versioned.
3. On another device, **More → Import workspace** and pick that `.json`.

> Export every so often — it's your backup. Clearing browser data would
> otherwise wipe the workspace.

---

## Folder layout

```
Notes/
├─ Interface/     ← this app (open index.html)
│  ├─ index.html
│  ├─ css/styles.css
│  ├─ js/db.js          (IndexedDB storage layer)
│  ├─ js/app.js         (canvas, blocks, editor, search…)
│  ├─ serve.py          (optional phone-access launcher)
│  └─ Start Notes Gallery.bat
├─ Storage/       ← keep your exported .json backups here
└─ Documents/     ← untouched
```

---

## Notes & limits

- Best in Chrome or Edge. Some browsers restrict storage for `file://` pages —
  if you ever see "Storage unavailable", use the `Start Notes Gallery.bat`
  launcher.
- Very large files (big videos) are impractical to store in-browser; PDFs,
  images and diagrams are fine.
- Data is per-browser-profile. Use Export / Import to sync devices.
