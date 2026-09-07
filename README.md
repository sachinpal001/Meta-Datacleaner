# 🛡️ MetaClean — Instant Photo Privacy & Metadata Stripper

> **100% Client-Side • Photos Never Leave Your Device • Works Offline (PWA)**

**MetaClean** is a privacy-first web application designed to instantly strip hidden EXIF, GPS location, device model, timestamp, and camera metadata from your photos before sharing them online or sending them in messaging apps.

---

## ✨ Features

- 📸 **Live Laptop / Desktop WebRTC Camera Viewfinder**: Tap to capture directly from your laptop's front camera or webcam with live mirror preview, framing grid, and instant shutter.
- 📱 **Mobile Native Camera & Gallery**: On mobile devices, seamlessly opens the native camera or image picker.
- 🛡️ **100% Client-Side Privacy**: All processing is done locally in your browser using HTML5 Canvas & JavaScript. No server, no uploads, zero tracking.
- 📊 **Detailed Metadata Comparison**: View exact stripped metadata (GPS coordinates, camera specs, exposure settings, timestamps) side-by-side with before & after visual cards.
- ⚡ **Auto-Save & Bulk Download**: Automatically save cleaned photos or download them in bulk.
- 🌐 **PWA & Offline Support**: Fully installable Progressive Web App (PWA) with Service Worker caching so it works offline anywhere.
- 🪟 **Windows Desktop App**: Double-click `MetaClean.bat` to run it — no Python, Node.js, or admin rights needed. Installs as a real Windows app with Explorer *"Open with"*, a taskbar jump list, keyboard shortcuts, and a pick-once save folder. See [Windows setup](#windows-recommended--no-dependencies).
- 🎨 **Modern Glassmorphism UI**: Clean light UI with smooth micro-animations and a responsive layout.

---

## 🔒 What Metadata Gets Stripped?

When you take or upload a photo, standard cameras automatically embed hidden EXIF data. MetaClean completely strips:

| Metadata Field | Description | Status |
| :--- | :--- | :---: |
| 📍 **GPS Coordinates** | Latitude, Longitude, Altitude, GPS timestamp | **Removed** |
| 📷 **Camera & Lens Info** | Camera Make, Model, Lens specs, Focal Length, F-Number, ISO | **Stripped** |
| 📅 **Timestamps** | Date/Time Original, Digitized date, File creation timestamp | **Cleared** |
| ⚙️ **Software & Device** | Device serial numbers, OS build, Firmware version | **Stripped** |
| 🏷️ **EXIF / XMP / IPTC** | Embedded thumbnail images, Adobe XMP tags, Copyright notes | **Cleaned** |

---

## 🚀 How It Works

1. **Capture or Choose**: Click **Tap to Capture** to launch your live webcam/camera, or drag-and-drop photos from your device.
2. **Instant Local Processing**: Photos are rendered directly onto an in-browser HTML5 canvas context, stripping all binary EXIF headers while preserving image quality.
3. **Download Safely**: Review the stripped metadata comparison and download your 100% clean photo.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla JavaScript (ES6+), Vanilla CSS3 (CSS Variables, Flexbox, Grid, Glassmorphic styling)
- **Camera Stream**: WebRTC `navigator.mediaDevices.getUserMedia`
- **Metadata Parsing**: Binary DataView EXIF/XMP header parsing
- **PWA**: Service Worker (`sw.js`), Web App Manifest (`manifest.json`)
- **Windows integration**: Windows PowerShell 5.1 + `System.Net.HttpListener` launcher, Window Controls Overlay, File Handling API, File System Access API
- **Zero Dependencies**: Lightweight, dependency-free codebase for maximum performance & privacy security.

---

## 💻 Local Setup & Running

### Windows (recommended — no dependencies)

Double-click **`MetaClean.bat`**. That's it.

It starts a loopback-only web server and opens MetaClean in Google Chrome. There is
nothing to install first: it uses only Windows PowerShell 5.1 and .NET, so **no Python,
no Node.js, no admin rights, and no firewall prompt** (the listener binds to
`localhost` / `127.0.0.1` only, so nothing is reachable from your network).

`localhost` HTTP counts as a *secure context* in Chrome, so the webcam, Service Worker,
PWA install, File System Access and File Handling APIs all work exactly as they would
over HTTPS.

```powershell
# defaults: port 8085, opens a new Chrome window
.\MetaClean.bat

# frameless "desktop app" window, on a specific port
.\MetaClean.bat -Mode App -Port 9090

# just serve, don't open a browser
.\MetaClean.bat -Mode None
```

| Flag | Meaning |
| :--- | :--- |
| `-Mode Window` | New normal Chrome window (default — this is the mode where Chrome offers the **Install** button) |
| `-Mode App` | Frameless Chrome app window, no tab strip or address bar |
| `-Mode Tab` | New tab in your current Chrome window |
| `-Mode None` | Serve only, launch nothing |
| `-Port <n>` | Preferred port (default `8085`); if busy, the next free port up to `+24` is used |
| `-IdleSeconds <n>` | Idle grace period before auto-shutdown (default `120`) |
| `-NoAutoExit` | Keep serving even after you close the app window |

The server shuts itself down automatically once you close the MetaClean window — the
page sends a heartbeat every 20 s and a quit beacon on unload, so you never end up with
a stray background process. Re-running the launcher while it is already serving just
opens another window instead of starting a second server.

### Windows shortcuts (Desktop + Start Menu)

Double-click **`Install-MetaClean-Shortcuts.bat`** to add *MetaClean* to your Desktop and
Start Menu with a proper multi-resolution icon. This is per-user — it writes only to your
own profile, touches no registry hives, and needs no admin rights. The shortcuts launch
through `windows\MetaClean-Silent.vbs`, so no console window flashes up.

Remove them again with **`Uninstall-MetaClean-Shortcuts.bat`**.

### Install as a Windows app (Chrome PWA)

With MetaClean open in Chrome, click **Install** (or the ⊕ icon in the address bar). That
promotes it to a real Windows app and unlocks OS integration:

- **Explorer integration** — right-click any JPEG/PNG/WebP/GIF/BMP → *Open with → MetaClean*, and the photo is loaded and cleaned straight away.
- **Taskbar jump list** — right-click the taskbar icon for *Open Camera* and *Choose Photos*.
- **Native title bar** — the app uses the Window Controls Overlay API, so the header becomes a draggable title bar.
- **Own window, own icon**, and it runs offline.

### Desktop conveniences

| Action | Shortcut |
| :--- | :--- |
| Choose photos | `Ctrl` + `O` |
| Paste a screenshot (e.g. after `Win` + `Shift` + `S`) | `Ctrl` + `V` |
| Save / download all cleaned photos | `Ctrl` + `S` |

Click **Save folder** in the header to pick a real folder once; cleaned photos are then
written straight there instead of going through the Downloads bar. The folder is
remembered between sessions, and files are never overwritten — a name collision becomes
`photo (1).jpg`.

### Any other platform

Serve the project folder with any static HTTP server:

```bash
# Start a local server (Python 3)
python3 -m http.server 8085

# Or using Node.js / npx
npx serve -l 8085 .
```

Open `http://localhost:8085` in your browser (Google Chrome, Brave, Firefox, Edge, or Safari).

> Note: opening `index.html` directly as a `file://` URL will not work — the Service
> Worker, PWA install and camera all require an `http://localhost` or `https://` origin.

---

## 🗂️ Project Layout

```
index.html                        app shell
app.js                            all application logic
style.css                         styling, incl. Windows title-bar integration
manifest.json  sw.js              PWA manifest + Service Worker
MetaClean.bat                     ← double-click to run on Windows
Install-MetaClean-Shortcuts.bat   ← Desktop + Start Menu shortcuts
Uninstall-MetaClean-Shortcuts.bat
windows/
  Start-MetaClean.ps1             loopback static server + Chrome launcher
  Install-MetaClean.ps1           shortcut + .ico builder
  MetaClean-Silent.vbs            console-free launch wrapper
```


---

## ✅ Accuracy Notes

Two correctness issues were found and fixed while building the Windows distribution; both
were verified against synthetic EXIF fixtures in headless Chrome rather than by
inspection alone:

- **Photos were being rotated twice.** Browsers apply the EXIF `Orientation` tag while
  decoding an image, so `drawImage()` output is *already* upright. The old code re-applied
  the rotation matrix on top of that, so every photo from a phone held any way but
  straight up came out sideways or upside-down. Tested across Orientation values 1–8:
  only `1` survived intact before the fix, all 8 are correct now.
- **The metadata report no longer invents data.** Missing tags used to be filled in with
  placeholder values (a hard-coded camera make, `"Camera Hardware Module"`, and an
  `EXIF Data: Present` line shown even when the file had no EXIF block at all). The report
  now states only what was actually parsed out of the file, says so plainly when a photo
  carries no metadata, and the "removed" badges are derived from the tags that were really
  found instead of being displayed unconditionally.

---

## 📄 License

MIT License — Free to use, modify, and distribute for personal and commercial privacy protection.
