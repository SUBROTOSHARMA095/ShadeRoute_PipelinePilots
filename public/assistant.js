/**
 * ShadeRoute — Ira (इरा) AI Assistant Widget (Polished, Multilingual & GPT-Grade)
 * Intelligent Climate & Campus Guide for SOA ITER Urban Microclimate Twin.
 */

(function () {
    'use strict';

    const LANGUAGES = [
        { code: 'en', label: 'English', native: 'English', flag: '🇬🇧' },
        { code: 'bn', label: 'Bengali', native: 'বাংলা', flag: '🇮🇳' },
        { code: 'hi', label: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
        { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ', flag: '🇮🇳' },
        { code: 'es', label: 'Spanish', native: 'Español', flag: '🇪🇸' },
        { code: 'fr', label: 'French', native: 'Français', flag: '🇫🇷' }
    ];

    const SPEECH_LANG_MAP = {
        'en': 'en-US',
        'bn': 'bn-IN',
        'hi': 'hi-IN',
        'or': 'hi-IN', // Web Speech API in Chromium lacks or-IN model, fallback to Hindi to prevent network crash
        'es': 'es-ES',
        'fr': 'fr-FR'
    };

    const GREETINGS = {
        en: "Hello! I'm **Ira (इरा)**, your AI Climate & Campus Guide for ShadeRoute.\n\nPlease select your preferred language below, or ask me anything about campus cooling, our machine learning pipeline, heatwaves, or hospital surge readiness:",
        bn: "নমস্কার! আমি **ইরা (Ira)**, শেডরুট (ShadeRoute)-এর জন্য আপনার এআই ক্লাইমেট ও ক্যাম্পাস গাইড।\n\nঅনুগ্রহ করে নিচে আপনার পছন্দের ভাষা নির্বাচন করুন, অথবা ক্যাম্পাসের শীতলীকরণ, মেশিন লার্নিং পাইপলাইন, হিটওয়েভ পূর্বাভাস বা হাসপাতাল প্রস্তুতি সম্পর্কে যেকোনো প্রশ্ন আমাকে করতে পারেন:",
        hi: "नमस्ते! मैं **इरा (Ira)** हूँ, शेडरूट के लिए आपकी एआई क्लाइमेट और कैंपस गाइड।\n\nकृपया नीचे अपनी पसंदीदा भाषा चुनें, या कैंपस कूलिंग, मशीन लर्निंग मॉडल, हीटवेव या अस्पताल तत्परता के बारे में मुझसे कोई भी सवाल पूछें:",
        or: "ନମସ୍କାର! ମୁଁ **ଇରା (Ira)**, ଶେଡରୁଟ୍ ପାଇଁ ଆପଣଙ୍କ ଏଆଇ କ୍ଲାଇମେଟ୍ ଏବଂ କ୍ୟାମ୍ପସ ଗାଇଡ୍।\n\nଦୟାକରି ତଳେ ଆପଣଙ୍କ ପସନ୍ଦର ଭାଷା ବାଛନ୍ତୁ, କିମ୍ବା କ୍ୟାମ୍ପସ ଥଣ୍ଡା କରିବା, ମେସିନ୍ ଲର୍ଣ୍ଣିଂ ମଡେଲ୍, ହିଟୱେଭ୍ କିମ୍ବା ହସ୍ପିଟାଲ୍ ପ୍ରସ୍ତୁତି ବିଷୟରେ ପଚାରନ୍ତୁ:"
    };

    const LANG_SWITCH_MESSAGES = {
        en: "Language set to **English**. How can I assist you with campus climate and cooling today?",
        bn: "ভাষা **বাংলা**তে পরিবর্তন করা হয়েছে। আজ আমি আপনাকে কীভাবে সাহায্য করতে পারি?",
        hi: "भाषा **हिन्दी** में सेट कर दी गई है। आज मैं आपकी क्या सहायता करूँ?",
        or: "ଭାଷା **ଓଡ଼ିଆ** ରେ ସେଟ୍ କରାଗଲା। ଆଜି ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିବି?",
        es: "Idioma configurado en **Español**. ¿Cómo puedo ayudarte hoy con el clima del campus?",
        fr: "Langue configurée en **Français**. Comment puis-je vous aider aujourd'hui avec le climat du campus?"
    };

    const PLACEHOLDERS = {
        en: "Ask Ira about trees, mist, ML models, heatwaves, hospital surge, or ask for a tour...",
        bn: "গাছ, মিস্ট স্প্রেয়ার, এমএল মডেল, হিটওয়েভ, হাসপাতাল প্রস্তুতি বা ট্যুর সম্পর্কে জিজ্ঞাসা করুন...",
        hi: "पेड़ों, मिस्ट, एमएल मॉडल, हीटवेव, अस्पताल सर्ज या टूर के बारे में पूछें...",
        or: "ଗଛ, ମିଷ୍ଟ, ଏମଏଲ୍ ମଡେଲ୍, ହିଟୱେଭ୍, ହସ୍ପିଟାଲ୍ ସର୍ଜ କିମ୍ବା ଟୁର୍ ବିଷୟରେ ପଚାରନ୍ତୁ..."
    };

    const SUGGESTIONS = {
        en: [
            "🚀 Give me a website tour",
            "🧠 How does the ML pipeline work?",
            "🔥 What is the heatwave forecast?",
            "🌳 How do shade trees cool campus?",
            "🏥 How does hospital surge readiness work?",
            "💧 How do mist sprayers work?"
        ],
        bn: [
            "🚀 ওয়েবসাইটের সম্পূর্ণ ট্যুর দিন",
            "🧠 আমাদের মেশিন লার্নিং মডেল কীভাবে কাজ করে?",
            "🔥 হিটওয়েভ এবং আবহাওয়া পূর্বাভাস কী?",
            "🌳 ছায়াদার গাছ কীভাবে ক্যাম্পাস ঠান্ডা করে?",
            "🏥 হাসপাতাল প্রস্তুতি কীভাবে কাজ করে?",
            "💧 মিস্ট স্প্রেয়ার কীভাবে কাজ করে?"
        ],
        hi: [
            "🚀 वेबसाइट का संपूर्ण टूर कराएं",
            "🧠 मशीन लर्निंग पाइपलाइन कैसे काम करती है?",
            "🔥 हीटवेव पूर्वानुमान क्या है?",
            "🌳 छायादार पेड़ कैंपस को कैसे ठंडा करते हैं?",
            "🏥 अस्पताल सर्ज तत्परता कैसे काम करती है?",
            "💧 मिस्ट स्प्रेयर कैसे काम करते हैं?"
        ],
        or: [
            "🚀 ୱେବସାଇଟର ସମ୍ପୂର୍ଣ୍ଣ ଟୁର୍ ଦେଖାନ୍ତୁ",
            "🧠 ମେସିନ୍ ଲର୍ଣ୍ଣିଂ ମଡେଲ୍ କିପରି କାମ କରେ?",
            "🔥 ହିଟୱେଭ୍ ପୂର୍ବାନୁମାନ କ'ଣ ଅଟେ?",
            "🌳 ଗଛ କ୍ୟାମ୍ପସକୁ କିପରି ଥଣ୍ଡା କରେ?",
            "🏥 ହସ୍ପିଟାଲ୍ ସର୍ଜ ପ୍ରସ୍ତୁତି କିପରି କାମ କରେ?",
            "💧 ମିଷ୍ଟ ସ୍ପ୍ରେୟାର କିପରି କାମ କରେ?"
        ]
    };

    class IraAssistant {
        constructor() {
            this.isOpen = false;
            this.isMinimized = false;
            this.language = localStorage.getItem('sr_ira_lang') || 'en';
            this.history = [];
            this.hasGeminiKey = false;
            this.geminiActive = false;
            this.creditsRemainingToday = null;
            this.dom = {};
            this.speechSupported = false;
            this.recognition = null;
            this.isListening = false;
            this.activeStreamFinish = null;

            this.init();
        }

        async init() {
            this.createWidgetDOM();
            this.initSpeechRecognition();
            this.bindEvents();
            await this.checkServerConfig();
            this.showInitialConversation();
        }

        async checkServerConfig() {
            try {
                const res = await fetch('/api/assistant/config');
                const data = await res.json();
                this.hasGeminiKey = Boolean(data.hasGeminiKey);
                this.geminiActive = Boolean(data.geminiActive);
                this.creditsRemainingToday = data.creditsRemainingToday;
                this.updateStatusBadge();
            } catch (e) {
                console.warn('[Ira Assistant] Config check skipped:', e.message);
            }
        }

        updateStatusBadge() {
            if (!this.dom.statusText) return;
            if (this.hasGeminiKey && this.geminiActive) {
                this.dom.statusDot.className = 'ira-status-dot online';
                this.dom.statusText.textContent = 'Ira AI · Gemini 3.6 Flash';
            } else {
                this.dom.statusDot.className = 'ira-status-dot active';
                this.dom.statusText.textContent = 'Active Guide · Multilingual';
            }
        }

        createWidgetDOM() {
            // Chat Drawer Container
            const chatDrawer = document.createElement('div');
            chatDrawer.id = 'iraChatDrawer';
            chatDrawer.className = 'ira-chat-drawer';
            chatDrawer.setAttribute('role', 'dialog');
            chatDrawer.setAttribute('aria-label', 'Ira AI Campus Assistant');
            chatDrawer.innerHTML = `
                <!-- Chat Header -->
                <div class="ira-header">
                    <div class="ira-header-left">
                        <div class="ira-avatar">
                            <img src="Ira_logo.png" alt="Ira AI Avatar" class="ira-avatar-img">
                            <span class="ira-avatar-pulse"></span>
                        </div>
                        <div class="ira-header-info">
                            <div class="ira-title-row">
                                <span class="ira-name">Ira (इरा)</span>
                            </div>
                            <div class="ira-status-row">
                                <span id="iraStatusDot" class="ira-status-dot active"></span>
                                <span id="iraStatusText" class="ira-status-text">Active Guide</span>
                            </div>
                        </div>
                    </div>

                    <div class="ira-header-actions">
                        <!-- Language Selector Dropdown -->
                        <div class="ira-lang-select-wrap">
                            <select id="iraLangSelect" class="ira-lang-select" title="Change Language" aria-label="Select Language">
                                ${LANGUAGES.map(l => `<option value="${l.code}" ${l.code === this.language ? 'selected' : ''}>${l.flag} ${l.native}</option>`).join('')}
                            </select>
                        </div>

                        <!-- Tour Button -->
                        <button id="iraHeaderTourBtn" class="ira-icon-btn highlight tour-btn" title="Start Interactive Web Tour" aria-label="Start Tour">
                            <span style="font-size:13px;">🚀</span>
                        </button>

                        <!-- Clear Chat Button -->
                        <button id="iraClearChatBtn" class="ira-icon-btn" title="Clear Conversation" aria-label="Clear Conversation">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>

                        <!-- Minimize Button (desktop only) -->
                        <button id="iraMinimizeBtn" class="ira-icon-btn desktop-only" title="Minimize Chat" aria-label="Minimize Chat">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </button>

                        <!-- Close Button -->
                        <button id="iraCloseBtn" class="ira-icon-btn close-action" title="Close Chat" aria-label="Close Chat">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>

                <!-- Messages Stream -->
                <div id="iraMessages" class="ira-messages" role="log" aria-live="polite"></div>

                <!-- Suggested Chips Container -->
                <div id="iraSuggestions" class="ira-suggestions"></div>

                <!-- Input Footer -->
                <div class="ira-footer">
                    <!-- Live Voice Listening Notification Banner -->
                    <div id="iraVoiceBanner" class="ira-voice-banner">
                        <div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">
                            <span class="ira-voice-pulse-dot" style="margin-top:4px;flex-shrink:0;"></span>
                            <div id="iraVoiceStatus" style="font-size:11.5px;line-height:1.4;word-break:break-word;">Listening... Speak now</div>
                        </div>
                        <button id="iraVoiceCancelBtn" type="button" title="Dismiss" style="background:none;border:none;color:inherit;cursor:pointer;font-size:13px;font-weight:800;padding:2px 6px;line-height:1;flex-shrink:0;">✕</button>
                    </div>

                    <form id="iraForm" class="ira-input-form" onsubmit="return false;">
                        <input id="iraInput" type="text" class="ira-input" placeholder="${PLACEHOLDERS[this.language] || PLACEHOLDERS['en']}" autocomplete="off">
                        
                        <!-- Live Multilingual Microphone Button -->
                        <button id="iraMicBtn" type="button" class="ira-mic-btn" title="Live Voice Input (Speak in any language)" aria-label="Voice Input">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                <line x1="12" y1="19" x2="12" y2="23"/>
                                <line x1="8" y1="23" x2="16" y2="23"/>
                            </svg>
                        </button>

                        <button id="iraSendBtn" type="submit" class="ira-send-btn" title="Send Message" aria-label="Send Message">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        </button>
                    </form>
                    <div class="ira-confidentiality-notice">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <span>Confidential mathematical formulations protected · Multilingual AI</span>
                    </div>
                </div>
            `;
            document.body.appendChild(chatDrawer);

            this.dom = {
                drawer: chatDrawer,
                messages: document.getElementById('iraMessages'),
                suggestions: document.getElementById('iraSuggestions'),
                input: document.getElementById('iraInput'),
                form: document.getElementById('iraForm'),
                sendBtn: document.getElementById('iraSendBtn'),
                micBtn: document.getElementById('iraMicBtn'),
                voiceBanner: document.getElementById('iraVoiceBanner'),
                voiceStatus: document.getElementById('iraVoiceStatus'),
                voiceCancelBtn: document.getElementById('iraVoiceCancelBtn'),
                langSelect: document.getElementById('iraLangSelect'),
                headerTourBtn: document.getElementById('iraHeaderTourBtn'),
                clearChatBtn: document.getElementById('iraClearChatBtn'),
                minimizeBtn: document.getElementById('iraMinimizeBtn'),
                closeBtn: document.getElementById('iraCloseBtn'),
                statusDot: document.getElementById('iraStatusDot'),
                statusText: document.getElementById('iraStatusText')
            };
        }

        bindEvents() {
            // Header buttons
            this.dom.closeBtn.addEventListener('click', () => this.closeChat());
            this.dom.minimizeBtn.addEventListener('click', () => this.minimizeChat());

            // Header tour button
            this.dom.headerTourBtn.addEventListener('click', () => {
                this.startGuidedTour();
            });

            // Clear chat button
            this.dom.clearChatBtn.addEventListener('click', () => {
                if (this.activeStreamFinish) this.activeStreamFinish();
                this.history = [];
                this.dom.messages.innerHTML = '';
                this.showInitialConversation();
            });

            // Language Selector Dropdown
            this.dom.langSelect.addEventListener('change', (e) => {
                this.setLanguage(e.target.value, true);
            });

            // Form Submit
            this.dom.form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (this.isListening) this.stopSpeechRecognition();
                this.handleUserSubmit();
            });

            // Microphone Button (Live Multilingual Voice Recognition)
            if (this.dom.micBtn) {
                this.dom.micBtn.addEventListener('click', () => {
                    this.toggleSpeechRecognition();
                });
            }

            // Voice Cancel Button
            if (this.dom.voiceCancelBtn) {
                this.dom.voiceCancelBtn.addEventListener('click', () => {
                    this.stopSpeechRecognition();
                });
            }

            // Stop speech if user types manually
            if (this.dom.input) {
                this.dom.input.addEventListener('input', () => {
                    if (this.isListening) {
                        this.stopSpeechRecognition();
                    }
                });
            }

            // Connect topbar button
            const topAskBtn = document.getElementById('askIraTopBtn');
            if (topAskBtn) {
                topAskBtn.addEventListener('click', () => this.openChat());
            }

            const topTourBtn = document.getElementById('webTourTopBtn');
            if (topTourBtn) {
                topTourBtn.addEventListener('click', () => this.startGuidedTour());
            }
        }

        initSpeechRecognition() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                this.speechSupported = false;
                console.warn('[Ira Speech] Web Speech API not supported in this browser.');
                if (this.dom.micBtn) {
                    this.dom.micBtn.title = "Live speech recognition not supported in this browser (use Chrome, Edge, or Safari)";
                    this.dom.micBtn.style.opacity = "0.5";
                }
                return;
            }

            this.speechSupported = true;
            this.isListening = false;
            this.isConnecting = false;
            this.voiceTimeout = null;
        }

        setupSpeechRecognition() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) return null;

            if (this.recognition) {
                try {
                    this.recognition.abort();
                } catch (e) {}
                this.recognition = null;
            }

            try {
                const rec = new SpeechRecognition();
                rec.continuous = false;
                rec.interimResults = true;
                rec.maxAlternatives = 1;
                rec.lang = SPEECH_LANG_MAP[this.language] || 'en-IN';

                rec.onstart = () => {
                    this.isConnecting = false;
                    this.isListening = true;
                    if (this.dom.micBtn) {
                        this.dom.micBtn.classList.remove('connecting');
                        this.dom.micBtn.classList.add('listening');
                    }
                    if (this.dom.voiceBanner) {
                        if (this.voiceTimeout) clearTimeout(this.voiceTimeout);
                        this.dom.voiceBanner.className = 'ira-voice-banner active listening';
                        const langObj = LANGUAGES.find(l => l.code === this.language);
                        const langLabel = langObj ? `${langObj.flag} ${langObj.native}` : this.language;
                        this.dom.voiceStatus.innerHTML = `Listening in <strong>${langLabel}</strong>... Speak now`;
                    }
                };

                rec.onresult = (event) => {
                    let interimTranscript = '';
                    let finalTranscript = '';

                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        const transcript = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            finalTranscript += transcript;
                        } else {
                            interimTranscript += transcript;
                        }
                    }

                    const combined = (finalTranscript || interimTranscript).trim();
                    if (combined && this.dom.input) {
                        this.dom.input.value = combined;
                    }
                };

                rec.onerror = (event) => {
                    console.warn('[Ira Speech] Error:', event.error);
                    this.isConnecting = false;
                    this.isListening = false;

                    if (this.dom.micBtn) {
                        this.dom.micBtn.classList.remove('connecting', 'listening');
                    }

                    if (this.dom.voiceBanner) {
                        this.dom.voiceBanner.className = 'ira-voice-banner active error';

                        if (event.error === 'network') {
                            const isBrave = (navigator.brave && typeof navigator.brave.isBrave === 'function') || navigator.userAgent.includes('Brave');
                            if (isBrave) {
                                this.dom.voiceStatus.innerHTML = `<strong>Brave Shield Blocked Speech:</strong> Chromium Web Speech uses Google cloud. In Brave: open <code>brave://settings/privacy</code> & enable <em>"Use Google services for speech recognition"</em>.`;
                            } else {
                                this.dom.voiceStatus.innerHTML = `<strong>Voice Cloud Unreachable:</strong> Browser speech service was blocked by network firewall, adblocker, or offline. You can type directly below!`;
                            }
                        } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                            this.dom.voiceStatus.innerHTML = `<strong>Microphone Blocked:</strong> Please allow microphone access in browser address bar (lock/tune icon).`;
                        } else if (event.error === 'no-speech') {
                            this.dom.voiceStatus.innerHTML = `No speech detected. Tap mic to try speaking again.`;
                        } else if (event.error === 'language-not-supported') {
                            this.dom.voiceStatus.innerHTML = `Language model not supported by browser. Falling back to English...`;
                            setTimeout(() => {
                                this.setLanguage('en');
                                this.startSpeechRecognition();
                            }, 1200);
                            return;
                        } else {
                            this.dom.voiceStatus.innerHTML = `Microphone notice: ${event.error}`;
                        }
                    }

                    if (this.voiceTimeout) clearTimeout(this.voiceTimeout);
                    this.voiceTimeout = setTimeout(() => {
                        if (!this.isListening && !this.isConnecting && this.dom.voiceBanner) {
                            this.dom.voiceBanner.classList.remove('active', 'listening', 'error', 'connecting');
                        }
                    }, 7000);
                };

                rec.onend = () => {
                    this.isConnecting = false;
                    this.isListening = false;
                    if (this.dom.micBtn) {
                        this.dom.micBtn.classList.remove('connecting', 'listening');
                    }
                    if (this.dom.voiceBanner && !this.dom.voiceBanner.classList.contains('error')) {
                        this.dom.voiceBanner.classList.remove('active', 'listening', 'connecting');
                    }
                    if (this.dom.input) {
                        this.dom.input.focus();
                    }
                };

                this.recognition = rec;
                return rec;
            } catch (err) {
                console.warn('[Ira Speech] Instance creation failed:', err.message);
                return null;
            }
        }

        toggleSpeechRecognition() {
            if (!this.speechSupported) {
                alert("Live voice recognition is not supported in this browser. Please try Google Chrome, Microsoft Edge, or Safari.");
                return;
            }

            if (this.isListening || this.isConnecting) {
                this.stopSpeechRecognition();
            } else {
                this.startSpeechRecognition();
            }
        }

        startSpeechRecognition() {
            if (this.isListening || this.isConnecting) {
                this.stopSpeechRecognition();
                return;
            }

            const rec = this.setupSpeechRecognition();
            if (!rec) {
                alert("Could not initialize microphone recognition in this browser.");
                return;
            }

            this.isConnecting = true;
            if (this.dom.micBtn) {
                this.dom.micBtn.classList.add('connecting');
            }
            if (this.dom.voiceBanner) {
                if (this.voiceTimeout) clearTimeout(this.voiceTimeout);
                this.dom.voiceBanner.className = 'ira-voice-banner active connecting';
                this.dom.voiceStatus.textContent = 'Connecting microphone...';
            }

            try {
                rec.start();
            } catch (err) {
                console.warn('[Ira Speech] Start failed:', err.message);
                this.isConnecting = false;
                if (rec.onerror) {
                    rec.onerror({ error: err.name === 'InvalidStateError' ? 'busy' : 'network' });
                }
            }
        }

        stopSpeechRecognition() {
            this.isConnecting = false;
            this.isListening = false;
            if (this.voiceTimeout) clearTimeout(this.voiceTimeout);

            if (this.recognition) {
                try {
                    this.recognition.stop();
                } catch (e) {}
            }

            if (this.dom.micBtn) {
                this.dom.micBtn.classList.remove('connecting', 'listening');
            }
            if (this.dom.voiceBanner) {
                this.dom.voiceBanner.classList.remove('active', 'listening', 'error', 'connecting');
            }
        }

        setLanguage(code, notifyUser = false) {
            this.language = code;
            localStorage.setItem('sr_ira_lang', code);
            localStorage.setItem('sr_ira_lang_selected', 'true');

            // Sync speech recognition language
            if (this.recognition) {
                this.recognition.lang = SPEECH_LANG_MAP[code] || 'en-IN';
            }

            // Sync mic button title
            if (this.dom.micBtn) {
                const langObj = LANGUAGES.find(l => l.code === code);
                const langName = langObj ? langObj.native : code;
                this.dom.micBtn.title = `Live Voice Input (Speak in ${langName})`;
            }

            // Sync dropdown value
            if (this.dom.langSelect && this.dom.langSelect.value !== code) {
                this.dom.langSelect.value = code;
            }

            // Sync input placeholder
            if (this.dom.input) {
                this.dom.input.placeholder = PLACEHOLDERS[code] || PLACEHOLDERS['en'];
            }

            // Sync Interactive Web Tour language
            if (window.ShadeRouteTour) {
                window.ShadeRouteTour.setLanguage(code);
            }

            // Refresh suggested chips in new language
            this.renderSuggestions();

            if (notifyUser) {
                const switchMsg = LANG_SWITCH_MESSAGES[code] || LANG_SWITCH_MESSAGES['en'];
                this.addMessage('assistant', switchMsg, true);
            }
        }

        toggleChat() {
            if (this.isOpen) {
                this.closeChat();
            } else {
                this.openChat();
            }
        }

        openChat() {
            this.isOpen = true;
            this.isMinimized = false;
            this.dom.drawer.classList.add('open');
            this.dom.drawer.classList.remove('minimized');

            // Collapse Heatwave Prediction card while chat is open to prevent any overlap
            if (typeof window.isPredictionWidgetCollapsed !== 'undefined') {
                this.prevPredictionCollapsedState = window.isPredictionWidgetCollapsed;
            }
            if (typeof window.setPredictionWidgetCollapsed === 'function') {
                window.setPredictionWidgetCollapsed(true);
            }

            this.dom.input.focus();
        }

        closeChat() {
            this.isOpen = false;
            this.dom.drawer.classList.remove('open');

            // Restore Heatwave Prediction widget when chat closes
            if (typeof window.setPredictionWidgetCollapsed === 'function') {
                window.setPredictionWidgetCollapsed(this.prevPredictionCollapsedState ?? false);
            }
        }

        minimizeChat() {
            this.isMinimized = !this.isMinimized;
            this.dom.drawer.classList.toggle('minimized', this.isMinimized);
        }

        startGuidedTour() {
            this.closeChat();
            if (window.ShadeRouteTour) {
                window.ShadeRouteTour.startTour(this.language);
            }
        }

        showInitialConversation() {
            const welcomeText = GREETINGS[this.language] || GREETINGS['en'];
            this.addMessage('assistant', welcomeText);

            // Add prominent interactive language picker cards
            this.renderLanguageSelectionCards();
            this.renderSuggestions();
        }

        renderLanguageSelectionCards() {
            const cardWrap = document.createElement('div');
            cardWrap.className = 'ira-lang-grid-card';
            cardWrap.innerHTML = `
                <div class="ira-lang-grid-title">🌐 Select Language / ভাষা নির্বাচন করুন:</div>
                <div class="ira-lang-grid">
                    ${LANGUAGES.map(l => `
                        <button type="button" class="ira-lang-pill ${l.code === this.language ? 'active' : ''}" data-lang="${l.code}">
                            <span class="flag">${l.flag}</span>
                            <span class="name">${l.native}</span>
                        </button>
                    `).join('')}
                </div>
            `;

            cardWrap.querySelectorAll('.ira-lang-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    cardWrap.querySelectorAll('.ira-lang-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const chosen = btn.getAttribute('data-lang');
                    this.setLanguage(chosen, true);
                });
            });

            this.dom.messages.appendChild(cardWrap);
            this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
        }

        renderSuggestions() {
            const list = SUGGESTIONS[this.language] || SUGGESTIONS['en'];
            this.dom.suggestions.innerHTML = '';
            list.forEach(chipText => {
                const btn = document.createElement('button');
                btn.className = 'ira-chip';
                btn.type = 'button';
                btn.textContent = chipText;
                btn.addEventListener('click', () => {
                    this.dom.input.value = chipText.replace(/^[^\w\s\u0900-\u097F\u0B00-\u0B7F\u0980-\u09FF]+/, '').trim();
                    this.handleUserSubmit();
                });
                this.dom.suggestions.appendChild(btn);
            });
        }

        async handleUserSubmit() {
            const query = (this.dom.input.value || '').trim();
            if (!query) return;

            this.dom.input.value = '';
            this.addMessage('user', query);

            // Check if user requested a language change in chat
            const lower = query.toLowerCase().trim();
            if (/^(change\s+language|select\s+language|choose\s+language|language|ভাষা\s*পরিবর্তন|ভাষা|भाषा\s*बदलें|भाषा|ଭାଷା\s*ବଦଳାନ୍ତୁ|cambiar\s+idioma|changer\s+de\s+langue)$/i.test(lower)) {
                let promptMsg = 'Please select your preferred language below:';
                if (this.language === 'bn') promptMsg = 'অনুগ্রহ করে নিচে আপনার পছন্দের ভাষা নির্বাচন করুন:';
                else if (this.language === 'hi') promptMsg = 'कृपया नीचे अपनी पसंदीदा भाषा चुनें:';
                else if (this.language === 'or') promptMsg = 'ଦୟାକରି ତଳେ ଆପଣଙ୍କ ପସନ୍ଦର ଭାଷା ବାଛନ୍ତୁ:';
                this.addMessage('assistant', promptMsg);
                this.renderLanguageSelectionCards();
                return;
            }

            for (const lang of LANGUAGES) {
                const lName = lang.label.toLowerCase();
                const nName = lang.native.toLowerCase();
                if (
                    lower === lName ||
                    lower === nName ||
                    lower.includes(`change to ${lName}`) ||
                    lower.includes(`switch to ${lName}`) ||
                    lower.includes(`speak in ${lName}`) ||
                    lower.includes(`talk in ${lName}`) ||
                    lower.includes(`in ${lName}`) ||
                    lower.includes(`in ${nName}`) ||
                    lower.includes(`speak ${lName}`) ||
                    lower.includes(`speak ${nName}`) ||
                    lower.includes(`bengali please`) ||
                    lower.includes(`hindi please`) ||
                    lower.includes(`odia please`)
                ) {
                    this.setLanguage(lang.code, true);
                    return;
                }
            }

            // Check if user asks for a tour
            if (/tour|tutorial|demonstrat|show me around|ট্যুর|দौरा|ट्यूटोरियल|ଟୁର୍/i.test(query)) {
                this.showTypingIndicator();
                setTimeout(() => {
                    this.removeTypingIndicator();
                    let tourMsg = "Certainly! Let's take a comprehensive live tour of the ShadeRoute platform! [[TRIGGER_TOUR]]";
                    if (this.language === 'bn') {
                        tourMsg = 'অবশ্যই! আসুন আমি আপনাকে শেডরুট ডিজিটাল টুইন প্ল্যাটফর্মটির সরাসরি ইন্টারেক্টিভ ট্যুর করিয়ে দিই। [[TRIGGER_TOUR]]';
                    } else if (this.language === 'hi') {
                        tourMsg = 'ज़रूर! आइए मैं आपको शेडरूट डिजिटल ट्विन का लाइव दौरा कराती हूँ। [[TRIGGER_TOUR]]';
                    } else if (this.language === 'or') {
                        tourMsg = 'ନିଶ୍ଚୟ! ଆସନ୍ତୁ ମୁଁ ଆପଣଙ୍କୁ ଶେଡରୁଟ୍ ୱେବସାଇଟର ଲାଇଭ୍ ଟୁର୍ ଦେଖାଇବି। [[TRIGGER_TOUR]]';
                    }
                    this.addMessage('assistant', tourMsg, true, () => {
                        setTimeout(() => this.startGuidedTour(), 800);
                    });
                }, 350);
                return;
            }

            this.showTypingIndicator();

            try {
                const res = await fetch('/api/assistant/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: query,
                        language: this.language,
                        history: this.history
                    })
                });

                const data = await res.json();
                this.removeTypingIndicator();

                if (data.reply) {
                    this.history.push({ role: 'user', text: query });
                    this.history.push({ role: 'model', text: data.reply });

                    if (data.creditsRemainingToday !== undefined) {
                        this.creditsRemainingToday = data.creditsRemainingToday;
                    }

                    this.addMessage('assistant', data.reply, true, () => {
                        if (data.triggerTour) {
                            setTimeout(() => this.startGuidedTour(), 1200);
                        }
                    });
                } else {
                    let fallbackMsg = "I am here to help! Could you please repeat your question?";
                    if (this.language === 'bn') fallbackMsg = "আমি আপনাকে সাহায্য করতে প্রস্তুত! আপনি কি দয়া করে আপনার প্রশ্নটি পুনরায় বলবেন?";
                    this.addMessage('assistant', fallbackMsg, true);
                }
            } catch (err) {
                this.removeTypingIndicator();
                let errMsg = "I'm here to answer any questions about campus cooling, heatwaves, or our tree simulation! Feel free to ask or click '🚀 Tour' above.";
                if (this.language === 'bn') errMsg = "আমি ক্যাম্পাসের শীতলীকরণ, মেশিন লার্নিং মডেল বা গাছ লাগানোর সিমুলেশন সম্পর্কিত যেকোনো প্রশ্নের উত্তর দিতে প্রস্তুত! যেকোনো প্রশ্ন করুন বা '🚀 Tour' বাটনে ক্লিক করুন।";
                this.addMessage('assistant', errMsg, true);
            }
        }

        formatMarkdown(text) {
            if (!text) return '';
            return text
                .replace(/\[\[TRIGGER_TOUR\]\]/g, '')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n\n/g, '<p></p>')
                .replace(/\n- /g, '<br>• ')
                .replace(/\n([0-9]+\.) /g, '<br><strong>$1</strong> ')
                .replace(/\n/g, '<br>');
        }

        attachCopyHandler(msgEl, rawText) {
            const copyBtn = msgEl.querySelector('.ira-copy-btn');
            if (!copyBtn) return;
            copyBtn.addEventListener('click', () => {
                const clean = rawText.replace(/\[\[TRIGGER_TOUR\]\]/g, '').trim();
                navigator.clipboard.writeText(clean).then(() => {
                    copyBtn.classList.add('copied');
                    copyBtn.querySelector('span').textContent = 'Copied!';
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.querySelector('span').textContent = 'Copy';
                    }, 1800);
                }).catch(() => {});
            });
        }

        addMessage(role, text, isAnimated = false, onComplete = null) {
            // Cancel previous active typewriter streaming if user sent next request
            if (this.activeStreamFinish) {
                this.activeStreamFinish();
            }

            const msgEl = document.createElement('div');
            msgEl.className = `ira-msg ira-msg-${role}`;

            if (role === 'assistant') {
                const uniqueId = 'ira_msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

                if (!isAnimated) {
                    const formatted = this.formatMarkdown(text);
                    msgEl.innerHTML = `
                        <div class="ira-msg-avatar">
                            <img src="Ira_logo.png" alt="Ira AI Avatar" class="ira-msg-avatar-img">
                        </div>
                        <div class="ira-bubble-wrap">
                            <div class="ira-bubble" id="${uniqueId}">${formatted}</div>
                            <div class="ira-msg-actions">
                                <button type="button" class="ira-copy-btn" title="Copy response" data-target="${uniqueId}">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                    <span>Copy</span>
                                </button>
                            </div>
                        </div>
                    `;
                    this.attachCopyHandler(msgEl, text);
                    this.dom.messages.appendChild(msgEl);
                    this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
                    if (typeof onComplete === 'function') onComplete();
                } else {
                    // Typewriter streaming mode like ChatGPT
                    msgEl.innerHTML = `
                        <div class="ira-msg-avatar">
                            <img src="Ira_logo.png" alt="Ira AI Avatar" class="ira-msg-avatar-img">
                        </div>
                        <div class="ira-bubble-wrap">
                            <div class="ira-bubble is-streaming" id="${uniqueId}" title="Click to display full message immediately">
                                <span class="ira-bubble-text"></span><span class="ira-typing-cursor"></span>
                            </div>
                            <div class="ira-msg-actions" style="opacity:0;pointer-events:none;transition:opacity 0.25s ease;">
                                <button type="button" class="ira-copy-btn" title="Copy response" data-target="${uniqueId}">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                    <span>Copy</span>
                                </button>
                            </div>
                        </div>
                    `;
                    this.attachCopyHandler(msgEl, text);
                    this.dom.messages.appendChild(msgEl);
                    this.dom.messages.scrollTop = this.dom.messages.scrollHeight;

                    const bubble = msgEl.querySelector('.ira-bubble');
                    const textSpan = msgEl.querySelector('.ira-bubble-text');
                    const cursor = msgEl.querySelector('.ira-typing-cursor');
                    const actionsWrap = msgEl.querySelector('.ira-msg-actions');

                    // Tokenize keeping whitespace/newlines intact
                    const tokens = text.split(/(\s+)/);
                    let tokenIndex = 0;
                    let isDone = false;
                    let streamTimer = null;

                    const finishStreaming = () => {
                        if (isDone) return;
                        isDone = true;
                        if (streamTimer) clearTimeout(streamTimer);
                        this.activeStreamFinish = null;
                        bubble.classList.remove('is-streaming');
                        bubble.removeAttribute('title');
                        textSpan.innerHTML = this.formatMarkdown(text);
                        if (cursor) cursor.remove();
                        if (actionsWrap) {
                            actionsWrap.style.opacity = '1';
                            actionsWrap.style.pointerEvents = 'auto';
                        }
                        this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
                        if (typeof onComplete === 'function') onComplete();
                    };

                    this.activeStreamFinish = finishStreaming;

                    // User can tap or click the bubble to skip to end
                    bubble.addEventListener('click', () => {
                        finishStreaming();
                    });

                    // ChatGPT-grade token-burst streaming engine:
                    // Streams out rapid, fluid multi-token bursts (~2-4 tokens per 18-24ms)
                    // producing high-velocity, smooth text generation that outpaces human reading speed
                    const totalTokens = tokens.length;
                    const burstSize = totalTokens > 100 ? 4 : totalTokens > 40 ? 3 : 2;

                    const streamNext = () => {
                        if (isDone) return;
                        if (tokenIndex >= totalTokens) {
                            finishStreaming();
                            return;
                        }

                        // Advance by burstSize tokens
                        tokenIndex = Math.min(tokenIndex + burstSize, totalTokens);
                        const currentString = tokens.slice(0, tokenIndex).join('');
                        textSpan.innerHTML = this.formatMarkdown(currentString);
                        this.dom.messages.scrollTop = this.dom.messages.scrollHeight;

                        // Check the last emitted token for subtle rhythm
                        const lastToken = tokens[tokenIndex - 1] || '';
                        let delay = 20; // baseline ~50 ticks/sec (ultra-fast, fluid LLM stream)

                        if (/[.!?]$/.test(lastToken.trim())) {
                            delay = 38; // natural micro-pause at sentence boundary
                        } else if (/[,;:]$/.test(lastToken.trim())) {
                            delay = 26;
                        } else if (/\n/.test(lastToken)) {
                            delay = 30;
                        }

                        streamTimer = setTimeout(streamNext, delay);
                    };

                    // Initial smooth kick-off
                    streamTimer = setTimeout(streamNext, 35);
                }
            } else {
                // User message
                const formatted = this.formatMarkdown(text);
                msgEl.innerHTML = `
                    <div class="ira-bubble">${formatted}</div>
                `;
                this.dom.messages.appendChild(msgEl);
                this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
            }
        }

        showTypingIndicator() {
            this.removeTypingIndicator();
            const typingEl = document.createElement('div');
            typingEl.id = 'iraTypingIndicator';
            typingEl.className = 'ira-msg ira-msg-assistant';
            typingEl.innerHTML = `
                <div class="ira-msg-avatar">
                    <img src="Ira_logo.png" alt="Ira AI Avatar" class="ira-msg-avatar-img">
                </div>
                <div class="ira-bubble typing-bubble">
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                </div>
            `;
            this.dom.messages.appendChild(typingEl);
            this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
        }

        removeTypingIndicator() {
            const existing = document.getElementById('iraTypingIndicator');
            if (existing) existing.remove();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        window.IraAssistant = new IraAssistant();
    });
})();
