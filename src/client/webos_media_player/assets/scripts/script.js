// --- CONFIGURATION ---
let SERVER_IP = localStorage.getItem('server_ip') || "192.168.1.XX";
const BASE_URL = `http://${SERVER_IP}:3000`;

const settingsUI = document.getElementById('settings-ui');
const ipInput = document.getElementById('ipInput');
const saveBtn = document.getElementById('saveBtn');
const settingsIcon = document.getElementById('settings-icon');

const browserUI = document.getElementById('browser-ui');
const playerUI = document.getElementById('player-ui');
const video = document.getElementById('videoPlayer');
const subTrack = document.getElementById('subTrack');
const mediaList = document.getElementById('media-list');
const statusText = document.getElementById('status');

const overlay = document.getElementById('video-overlay');
const progressBar = document.getElementById('progress-bar');
const elapsedText = document.getElementById('elapsed-time');
const totalText = document.getElementById('total-time');

// Helper: Format seconds to HH:MM:SS
const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
};

const WatchHistory = {
    // Save the current time for a specific movie
    savePosition: function (moviePath, currentTime, duration) {
        let history = JSON.parse(localStorage.getItem('media_history') || '{}');
        history[moviePath] = { time: currentTime, total: duration };
        localStorage.setItem('media_history', JSON.stringify(history));
    },

    // Retrieve the stopped time for a movie
    getPosition: function (moviePath) {
        let history = JSON.parse(localStorage.getItem('media_history') || '{}');
        return history[moviePath] || 0; // Return 0 if never watched
    },

    removeItem: function (moviePath) {
        // 1. Get the current history
        let history = JSON.parse(localStorage.getItem('media_history') || '{}');

        // 2. Remove the key if it exists
        if (history.hasOwnProperty(moviePath)) {
            delete history[moviePath];

            // 3. Save the cleaned object back to storage
            localStorage.setItem('media_history', JSON.stringify(history));
            console.log(`Removed from history: ${moviePath}`);
        }
    },

    clearAll: function () {
        localStorage.removeItem('media_history');
    }
};

let overlayTimer;

let currentlyPlayingMedia;

let currentIndex = 0; // Tracks the currently selected card

let dataSet;

window.onload = function () {
    // Check if IP is set, if not, force settings open
    if (SERVER_IP === "192.168.1.XX") {
        openSettings();
    } else {
        fetchMedias();
    }

    // Settings logic
    settingsIcon.onclick = openSettings;
    saveBtn.onclick = saveSettings;

    // 1. Push a fake state so the 'Back' button has somewhere to go 
    // instead of exiting the app immediately.
    window.history.pushState({ page: 'list' }, null, "");

    // 2. Listen for the PopState (triggered by the Back Button)
    window.onpopstate = function (event) {
        if (playerUI.style.display === "block") {
            console.log("Media playing, Closing the player...");
            // Stay in the app!
            closeOverlay();
            closePlayer();

            // Push the state back in so the NEXT back button press 
            // also doesn't exit the app
            window.history.pushState({ page: 'list' }, null, "");

            renderMedias(dataSet.items);
        } else {
            // We are already on the list, so let it exit
            //window.close();
            console.log("Stay in the list...");
            window.history.pushState({ page: 'list' }, null, "");
        }
    };

    document.addEventListener('keydown', handleKeydown, true);

    // PUSH A FAKE STATE IMMEDIATELY
    window.history.pushState({ page: 'main' }, null, "");
};

// Magic Remote Movement
// window.addEventListener('mousemove', () => {
//     console.log("Mouse moving...");
//     if (playerUI.style.display === "block") {
//         console.log("Showing overlay...");
//         showOverlay();
//     }
// });

// Update Progress
video.addEventListener('timeupdate', () => {
    const percent = (video.currentTime / video.duration) * 100;
    progressBar.style.width = percent + '%';
    elapsedText.innerText = formatTime(video.currentTime);
    totalText.innerText = formatTime(video.duration);
});

// Update showOverlay to be more robust
function showOverlay() {
    overlay.classList.remove('hidden');

    // Clear the existing timer so it doesn't hide too early
    clearTimeout(overlayTimer);

    // Hide after 3 seconds of NO movement
    overlayTimer = setTimeout(() => {
        closeOverlay();
    }, 3000);
}

function handleKeydown(e) {
    console.log("Key pressing deletcted..");
    console.log(e.keyCode);
    const isPlayerActive = (playerUI.style.display === "block");
    const isSettingsActive = (settingsUI.style.display === "flex");

    // Skip/Play logic (only if player is active)
    if (isPlayerActive) {
        console.log("Key pressing deletcted when playing..");
        switch (e.keyCode) {
            case 37: // Left Arrow - Seek Back 10s
                showOverlay();
                video.currentTime = Math.max(0, video.currentTime - 10);
                break;
            case 39: // Right Arrow - Seek Forward 10s
                showOverlay();
                video.currentTime = Math.min(video.duration, video.currentTime + 10);
                break;
            case 13: // Enter - Toggle Play/Pause
                showOverlay();
                if (video.paused) video.play(); else video.pause();
                break;
        }
    } else {
        //TODO add list navigation
        console.log("Key pressing deletcted when not playing..");
        const modal = document.getElementById('resume-modal');
        if (!modal.classList.contains('hidden')) {
            console.log("Navigating resume playback dialog buttons..");
            const modalButtons = [
                document.getElementById('btn-resume'),
                document.getElementById('btn-restart'),
                document.getElementById('btn-cancel')
            ];

            // Find which button currently has focus
            let activeIndex = modalButtons.indexOf(document.activeElement);

            if (e.keyCode === 37) { // Left
                e.preventDefault();
                // Move left, wrap to end if at the start
                activeIndex = (activeIndex <= 0) ? modalButtons.length - 1 : activeIndex - 1;
                modalButtons[activeIndex].focus();
            }
            else if (e.keyCode === 39) { // Right
                e.preventDefault();
                // Move right, wrap to start if at the end
                activeIndex = (activeIndex >= modalButtons.length - 1) ? 0 : activeIndex + 1;
                modalButtons[activeIndex].focus();
            }

            // Block other keys from moving the movie list
            if ([38, 40].includes(e.keyCode)) e.preventDefault();
        } else {
            console.log("Navigating through cards..");
            const cards = document.getElementsByClassName('media-card');
            if (cards.length === 0) return;

            // Calculate how many columns are currently visible
            const containerWidth = document.getElementById('media-list').offsetWidth;
            const cardWidth = cards[0].offsetWidth;

            // Get the computed style to account for gaps
            const style = window.getComputedStyle(document.getElementById('media-list'));
            const gap = parseFloat(style.columnGap) || 0;

            // The math: how many cards + gaps fit into the container
            const cols = Math.floor((containerWidth + gap) / (cardWidth + gap));

            let nextIndex = currentIndex;

            switch (e.keyCode) {
                case 37: // Left
                    nextIndex = currentIndex - 1;
                    break;
                case 39: // Right
                    nextIndex = currentIndex + 1;
                    break;
                case 38: // Up
                    nextIndex = currentIndex - cols;
                    break;
                case 40: // Down
                    nextIndex = currentIndex + cols;
                    break;
            }

            console.log("Next Index to navigate..");
            console.log(nextIndex);
            if (cards[nextIndex]) {
                cards[nextIndex].focus();
            }
        }
    }
}

function openSettings() {
    ipInput.value = SERVER_IP;
    settingsUI.style.display = "flex";
    ipInput.focus();
}

function closeOverlay() {
    overlay.classList.add('hidden');
}

function saveSettings() {
    const newIP = ipInput.value.trim();
    if (newIP) {
        localStorage.setItem('server_ip', newIP);
        location.reload(); // Reloads app with new IP
    }
}

async function fetchMedias() {
    statusText.innerText = "Scanning Media Directories...";
    try {
        const response = await fetch(`${BASE_URL}/api/browse`);
        const data = await response.json();
        dataSet = data;
        currentIndex = 0;
        renderMedias(dataSet.items);
    } catch (err) {
        statusText.innerText = "Error: Cannot connect to the server. Please check `Server IP Address` in settings and server is online.";
        console.error(err);
    }
}

function renderMedias(items) {
    mediaList.innerHTML = "";
    if (!items || items.length === 0) {
        statusText.innerText = "No Media found.";
        return;
    }

    statusText.innerText = `Found ${items.length} items.`;
    // 1. Get the full history object once to avoid multiple localStorage reads
    const history = JSON.parse(localStorage.getItem('media_history') || '{}');

    items.forEach((media, index) => {
        const card = document.createElement('div');
        card.className = "media-card";
        card.tabIndex = index; // Allows remote navigation
        card.dataset.name = media.name;

        // 2. Check if this specific media has a saved time
        const record = history[media.name];

        // Clear any previous innerHTML to start fresh
        card.innerHTML = "";

        if (record && typeof record === 'object') {
            const savedTime = Number(record.time || 0);
            const totalTime = Number(record.total || 0);
            if (savedTime > 10 && savedTime < (totalTime - 10)) {
                // Create the dot
                const dot = document.createElement('div');
                dot.className = "in-progress-dot";
                card.appendChild(dot);

                // Add text content
                const text = document.createTextNode("🎬 " + media.name);
                card.appendChild(text);

                // Optional: Add the "Resume at" label if you still want the timestamp
                const timeLabel = document.createElement('div');
                timeLabel.className = "resume-label";
                timeLabel.innerText = `Resume at ${formatTime(savedTime)} / ${formatTime(totalTime)}`;
                card.appendChild(timeLabel);
            } else {
                card.innerText = "🎬 " + media.name;
            }
        } else {
            card.innerText = "🎬 " + media.name;
        }

        card.onfocus = () => {
            currentIndex = index;
        };
        card.onclick = () => startMedia(media);
        card.onkeydown = (e) => { if (e.keyCode === 13) startMedia(media); };

        mediaList.appendChild(card);
    });

    // Restore focus to the media we were just looking at
    focusSelectedMediaCard();
}

function updateCurrentCardUI() {
    const mediaName = currentlyPlayingMedia.name;
    // Find the card in the list that matches the path
    const cards = document.querySelectorAll('.media-card');
    cards.forEach(card => {
        // We can store the path in a data attribute when rendering
        if (card.dataset.name === mediaName) {
            const record = WatchHistory.getPosition(mediaName);
            const savedTime = Number(record.time || 0);
            const totalTime = Number(record.total || 0);

            // Clear any previous innerHTML to start fresh
            card.innerHTML = "";

            console.log(savedTime);
            console.log(totalTime);
            if (savedTime > 10 && savedTime < (totalTime - 10)) {
                console.log("Saving current playback time...");
                // Create the dot
                const dot = document.createElement('div');
                dot.className = "in-progress-dot";
                card.appendChild(dot);

                // Add text content
                const text = document.createTextNode("🎬 " + mediaName);
                card.appendChild(text);

                // Optional: Add the "Resume at" label if you still want the timestamp
                const timeLabel = document.createElement('div');
                timeLabel.className = "resume-label";
                timeLabel.innerText = `Resume at ${formatTime(savedTime)} / ${formatTime(totalTime)}`;
                card.appendChild(timeLabel);
            } else {
                console.log("Remove current playback time...");
                card.innerText = "🎬 " + mediaName;
                WatchHistory.removeItem(mediaName);
            }
        }
    });
}

function startMedia(media) {
    currentlyPlayingMedia = media;

    const savedTime = WatchHistory.getPosition(media.name).time;
    if (savedTime > 10) {
        console.log("Need to ask resume or restart...");
        showResumeModal(savedTime);
    } else {
        console.log("No saved resume time...");
        playVideo(0);
    }
}

function showResumeModal(time) {
    const modal = document.getElementById('resume-modal');
    document.getElementById('resume-text').innerText = `Resume from ${formatTime(time)}?`;
    modal.classList.remove('hidden');

    // Auto-focus the Resume button for the remote
    document.getElementById('btn-resume').focus();
}

document.getElementById('btn-resume').onclick = () => {
    const savedTime = WatchHistory.getPosition(currentlyPlayingMedia.name).time;
    closeModal();
    playVideo(savedTime);
};

document.getElementById('btn-restart').onclick = () => {
    closeModal();
    playVideo(0);
};

document.getElementById('btn-cancel').onclick = closeModal;

function closeModal() {
    document.getElementById('resume-modal').classList.add('hidden');
    // Return focus to the list
    focusSelectedMediaCard();
}

function focusSelectedMediaCard() {
    const cards = document.getElementsByClassName('media-card');
    if (cards[currentIndex]) {
        cards[currentIndex].focus();
    } else if (mediaList.firstChild) {
        mediaList.firstChild.focus();
    }
}

function playVideo(resumeTime) {
    // We still use the #mediaOption trick for that USB-level 4K quality
    const mediaOption = {
        "mediaTransportType": "URI",
        "option": {
            "transmission": { "adaptive": false, "seamless": true },
            "mediaLayer": { "video": true, "audio": true }
        }
    };

    const streamUrl = `${BASE_URL}/stream?path=${encodeURIComponent(currentlyPlayingMedia.path)}`;
    const configString = encodeURIComponent(JSON.stringify(mediaOption));

    video.src = `${streamUrl}#mediaOption=${configString}`;

    // Set subtitles
    const srtPath = currentlyPlayingMedia.path.replace(/\.[^/.]+$/, ".srt");
    subTrack.src = `${BASE_URL}/sub?path=${encodeURIComponent(srtPath)}`;

    playerUI.style.display = "block";
    browserUI.style.display = "none";

    video.load();
    // video.play();
    // Once metadata is loaded, jump to the saved position
    video.onloadedmetadata = () => {
        console.log(`Resuming from ${resumeTime}s`);
        video.currentTime = resumeTime;
        video.play();
    };

    // IMPORTANT: Focus the video so the bar shows up when you move the remote
    video.focus();
}

function closePlayer() {
    video.pause();

    // Save current possition before exit from playback.
    WatchHistory.savePosition(currentlyPlayingMedia.name, video.currentTime, video.duration);

    // Update UI card
    updateCurrentCardUI();

    video.src = ""; // Release memory
    video.load();

    playerUI.style.display = "none";
    browserUI.style.display = "block";
}

function closeSettingsWithoutSaving() {
    const settingsUI = document.getElementById('settings-ui');
    settingsUI.style.display = 'none';

    // This tells the browser: "The user navigated back to the list"
    // even though we stayed on the same page.
    window.history.pushState({ page: 'list' }, null, "");
}

function triggerExit() {
    // This triggers the LG System Exit dialog safely
    if (window.PalmSystem && window.PalmSystem.platformBack) {
        window.PalmSystem.platformBack();
    } else {
        // Fallback for browser/dev mode
        if (confirm("Exit the application?")) {
            window.close();
        }
    }
}