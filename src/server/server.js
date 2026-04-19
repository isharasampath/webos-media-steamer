const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());

// ADD THESE TWO LINES:
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = 3000;
const getRootDir = () => config.movieDir;

// --- MIME TYPES ---
const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime'
};

const CONFIG_FILE = './config.json';
const { exec } = require('child_process');

// Initialize config
let config = {
    movieDir: "C:/" // Your default fallback path
};

// Load settings from file if they exist
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const fileData = fs.readFileSync(CONFIG_FILE, 'utf8');
        config = JSON.parse(fileData);
        console.log("Config loaded from file:", config.movieDir);
    } catch (err) {
        console.error("Error reading config.json, using defaults.");
    }
}

// --- GET LOCAL IP ---
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (let name in interfaces) {
        for (let iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// --- SAFE PATH JOIN (prevents path traversal) ---
function safeJoin(base, target) {
    const targetPath = path.normalize(path.join(base, target));
    if (!targetPath.startsWith(path.normalize(base))) {
        throw new Error("Access denied");
    }
    return targetPath;
}

// --- RECURSIVE VIDEO SCAN ---
function getEveryVideo(dirPath, allFiles = []) {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });

    files.forEach(file => {
        const fullPath = path.join(dirPath, file.name);

        if (file.isDirectory()) {
            getEveryVideo(fullPath, allFiles);
        } else if (file.name.match(/\.(mp4|mkv|avi|mov)$/i)) {

            const relativePath = path.relative(getRootDir(), fullPath).replace(/\\/g, '/');

            allFiles.push({
                name: file.name,
                path: relativePath,
                videoUrl: `http://${getLocalIp()}:${PORT}/stream?path=${encodeURIComponent(relativePath)}`,
                subUrl: `http://${getLocalIp()}:${PORT}/sub?path=${encodeURIComponent(relativePath.replace(/\.[^/.]+$/, ".srt"))}`
            });
        }
    });

    return allFiles;
}

// --- BROWSE API ---
app.get('/api/browse', (req, res) => {
    console.log("Scanning:", getRootDir());
    try {
        const videos = getEveryVideo(getRootDir());
        res.json({
            count: videos.length,
            items: videos
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Scan failed" });
    }
});

// --- VIDEO STREAM ---
app.get('/stream', (req, res) => {
    try {
        const relativePath = decodeURIComponent(req.query.path);
        const filePath = safeJoin(getRootDir(), relativePath);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File not found");
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        console.log(`Streaming: ${filePath}`);
        console.log(`Range: ${range || "FULL"}`);

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize || end >= fileSize) {
                return res.status(416).send("Requested range not satisfiable");
            }

            const chunkSize = (end - start) + 1;
            const stream = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunkSize,
                "Content-Type": contentType,
                "Connection": "keep-alive",
                "Cache-Control": "no-cache"
            });

            stream.pipe(res);
        } else {
            res.writeHead(200, {
                "Content-Length": fileSize,
                "Content-Type": contentType,
                "Accept-Ranges": "bytes",
                "Connection": "keep-alive",
                "Cache-Control": "no-cache"
            });

            fs.createReadStream(filePath).pipe(res);
        }

    } catch (err) {
        console.error("Stream error:", err);
        res.status(500).send("Streaming error");
    }
});

// --- SUBTITLE (SRT → VTT) ---
app.get('/sub', (req, res) => {
    try {
        const relativePath = decodeURIComponent(req.query.path);
        const filePath = safeJoin(getRootDir(), relativePath);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("Subtitle not found");
        }

        const raw = fs.readFileSync(filePath, 'utf8');

        // Remove BOM if exists
        const clean = raw.replace(/^\uFEFF/, "");

        // Convert SRT → VTT
        const vtt = "WEBVTT\n\n" + clean.replace(/(\d+),(\d+)/g, '$1.$2');

        res.writeHead(200, {
            "Content-Type": "text/vtt; charset=utf-8",
            "Cache-Control": "no-cache"
        });

        res.end(vtt);

    } catch (err) {
        console.error("Subtitle error:", err);
        res.status(500).send("Subtitle error");
    }
});

// --- START SERVER ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running at: http://${getLocalIp()}:${PORT}`);
});

// 1. Get current config
app.get('/api/get-config', (req, res) => {
    res.json(config);
});

// 2. Browse filesystem (Only returns folders)
app.get('/api/browse-fs', (req, res) => {
    const browsePath = req.query.path || config.movieDir;
    try {
        const items = fs.readdirSync(browsePath, { withFileTypes: true });
        const folders = items
            .filter(item => item.isDirectory())
            .map(item => item.name);
        res.json(folders);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 3. Save New Directory (As we wrote before)
app.post('/api/set-directory', (req, res) => {
    // If the middleware above is missing, 'req.body' is undefined, causing your error
    const newPath = req.body && req.body.path;

    if (!newPath) {
        return res.status(400).json({ success: false, message: "Path missing in request body" });
    }

    if (fs.existsSync(newPath)) {
        config.movieDir = newPath;
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, message: "Path does not exist" });
    }
});

app.get('/config', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

// Endpoint to list all available Windows drives
app.get('/api/get-drives', (req, res) => {
    // This command returns drive letters like "C: D: F:"
    exec('wmic logicaldisk get name', (err, stdout) => {
        if (err) return res.json(['C:']); // Fallback to C: if it fails

        const drives = stdout.split('\r\n')
            .filter(line => line.includes(':'))
            .map(line => line.trim());

        res.json(drives);
    });
});