/**
 * KaliBot Floating Widget & Chat Interface
 * SDN Kalibaru 05 Pagi
 */

document.addEventListener('DOMContentLoaded', () => {
    initKaliBotUI();
});

let kalibotHistory = [];
let isVoiceEnabled = false;

function initKaliBotUI() {
    if (document.getElementById('kalibot-widget-container')) return;

    // Create Container
    const container = document.createElement('div');
    container.id = 'kalibot-widget-container';
    container.className = 'kalibot-wrapper';

    container.innerHTML = `
        <!-- Floating Launcher Button -->
        <button id="kalibot-launcher" class="kalibot-launcher-btn" title="Tanya KaliBot AI" aria-label="Tanya KaliBot AI">
            <div class="kalibot-launcher-icon">
                <i class="fas fa-robot"></i>
            </div>
            <span class="kalibot-launcher-badge">AI Assistant</span>
        </button>

        <!-- Chat Modal Window -->
        <div id="kalibot-chat-window" class="kalibot-chat-window hidden">
            <!-- Header -->
            <div class="kalibot-header">
                <div class="kalibot-header-info">
                    <div class="kalibot-avatar">
                        <i class="fas fa-robot"></i>
                        <span class="kalibot-online-dot"></span>
                    </div>
                    <div>
                        <h4 class="kalibot-title">KaliBot AI <span class="kalibot-tag">SDN 05</span></h4>
                        <p class="kalibot-subtitle">Asisten Virtual Sekolah</p>
                    </div>
                </div>
                <div class="kalibot-header-actions">
                    <button id="kalibot-voice-toggle" class="kalibot-icon-btn" title="Aktifkan Suara Narasi">
                        <i class="fas fa-volume-mute"></i>
                    </button>
                    <button id="kalibot-close-btn" class="kalibot-icon-btn" title="Tutup Chat">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>

            <!-- Body Chat Area -->
            <div id="kalibot-messages" class="kalibot-messages">
                <!-- Welcome Message -->
                <div class="kalibot-msg bot">
                    <div class="kalibot-msg-avatar"><i class="fas fa-robot"></i></div>
                    <div class="kalibot-msg-bubble">
                        Halo! Saya <strong>KaliBot</strong> 🤖, asisten AI resmi SDN Kalibaru 05 Pagi.<br>
                        Ada yang bisa saya bantu terkait info PPDB, kegiatan sekolah, ekskul, atau jadwal?
                        <div class="kalibot-msg-time">${getFormattedTime()}</div>
                    </div>
                </div>
            </div>

            <!-- Quick Chips -->
            <div class="kalibot-chips-container">
                <button class="kalibot-chip" onclick="handleQuickChip('Apa saja syarat PPDB di SDN Kalibaru 05 Pagi?')">📝 Syarat PPDB</button>
                <button class="kalibot-chip" onclick="handleQuickChip('Apa saja kegiatan ekstrakurikuler di sekolah ini?')">🎨 Daftar Ekskul</button>
                <button class="kalibot-chip" onclick="handleQuickChip('Siapa saja dewan guru dan kepala sekolah?')">👨‍🏫 Guru & Staf</button>
                <button class="kalibot-chip" onclick="handleQuickChip('Dimana lokasi dan bagaimana cara menghubungi sekolah?')">📍 Lokasi & Kontak</button>
            </div>

            <!-- Input Area -->
            <div class="kalibot-input-area">
                <input type="text" id="kalibot-input" placeholder="Tanyakan sesuatu ke KaliBot..." autocomplete="off" onkeypress="if(event.key === 'Enter') sendKaliBotMessage()">
                <button id="kalibot-send-btn" onclick="sendKaliBotMessage()" aria-label="Kirim Pesan">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(container);

    // Event Listeners
    const launcher = document.getElementById('kalibot-launcher');
    const closeBtn = document.getElementById('kalibot-close-btn');
    const chatWindow = document.getElementById('kalibot-chat-window');
    const voiceToggle = document.getElementById('kalibot-voice-toggle');

    launcher.addEventListener('click', () => {
        chatWindow.classList.toggle('hidden');
        if (!chatWindow.classList.contains('hidden')) {
            document.getElementById('kalibot-input').focus();
        }
    });

    closeBtn.addEventListener('click', () => {
        chatWindow.classList.add('hidden');
    });

    voiceToggle.addEventListener('click', () => {
        isVoiceEnabled = !isVoiceEnabled;
        const icon = voiceToggle.querySelector('i');
        if (isVoiceEnabled) {
            voiceToggle.classList.add('active');
            icon.className = 'fas fa-volume-up';
            speakText("Suara KaliBot telah diaktifkan.");
        } else {
            voiceToggle.classList.remove('active');
            icon.className = 'fas fa-volume-mute';
            window.speechSynthesis.cancel();
        }
    });
}

async function sendKaliBotMessage() {
    const inputEl = document.getElementById('kalibot-input');
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';

    // Append User Message
    appendMessage('user', text);
    kalibotHistory.push({ sender: 'user', text: text });

    // Append Typing Indicator
    const typingId = appendTypingIndicator();

    try {
        if (!window.AIService) {
            throw new Error('Layanan AI Service belum dimuat.');
        }

        const aiResponse = await window.AIService.askKaliBot(text, kalibotHistory);
        
        removeTypingIndicator(typingId);
        appendMessage('bot', aiResponse);
        kalibotHistory.push({ sender: 'bot', text: aiResponse });

        if (isVoiceEnabled) {
            speakText(aiResponse);
        }
    } catch (err) {
        console.error('KaliBot Error:', err);
        removeTypingIndicator(typingId);
        appendMessage('bot', `Maaf, terjadi masalah saat menghubungi server AI. ${err.message || ''}`);
    }
}

function handleQuickChip(question) {
    document.getElementById('kalibot-input').value = question;
    sendKaliBotMessage();
}

function appendMessage(sender, text) {
    const messagesContainer = document.getElementById('kalibot-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `kalibot-msg ${sender}`;

    const formattedContent = text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    let speakBtnHtml = '';
    if (sender === 'bot') {
        speakBtnHtml = `<button class="kalibot-msg-speak" onclick="speakText('${escapeQuotes(text)}')" title="Bacakan Pesan"><i class="fas fa-volume-up"></i></button>`;
    }

    msgDiv.innerHTML = `
        <div class="kalibot-msg-avatar"><i class="fas ${sender === 'bot' ? 'fa-robot' : 'fa-user'}"></i></div>
        <div class="kalibot-msg-bubble">
            ${formattedContent}
            <div class="kalibot-msg-footer">
                <span class="kalibot-msg-time">${getFormattedTime()}</span>
                ${speakBtnHtml}
            </div>
        </div>
    `;

    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendTypingIndicator() {
    const messagesContainer = document.getElementById('kalibot-messages');
    const id = 'typing-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.className = 'kalibot-msg bot typing';

    msgDiv.innerHTML = `
        <div class="kalibot-msg-avatar"><i class="fas fa-robot"></i></div>
        <div class="kalibot-msg-bubble">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>
    `;

    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    // Strip formatting tags & markdown for clean speech
    const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/\*/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'id-ID';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
}

function getFormattedTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeQuotes(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
}

// Make chip handler global
window.handleQuickChip = handleQuickChip;
window.speakText = speakText;
