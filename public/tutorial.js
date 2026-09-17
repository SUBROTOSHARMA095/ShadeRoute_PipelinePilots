/**
 * ShadeRoute — Interactive Web Tutorial & Guided Tour (V2 Refined)
 * Guarantees zero obstruction of UI controls, covers heatwave forecast and hospital surge,
 * and responds to language changes seamlessly.
 */

(function () {
    'use strict';

    const TOUR_STEPS = [
        {
            id: 'brand',
            target: '.brand',
            title: {
                en: '🌿 Welcome to ShadeRoute',
                hi: '🌿 शेडरूट में आपका स्वागत है',
                or: '🌿 ଶେଡରୁଟ୍ କୁ ସ୍ୱାଗତ',
                bn: '🌿 শেডরুটে আপনাকে স্বাগতম',
                es: '🌿 Bienvenido a ShadeRoute',
                fr: '🌿 Bienvenue sur ShadeRoute'
            },
            text: {
                en: 'ShadeRoute is an urban climate digital twin for the SOA ITER Campus. It tracks heat hazards on walkways, models live weather, and helps simulate real cooling actions.',
                hi: 'शेडरूट सोआ आईटर (SOA ITER) कैंपस के लिए एक डिजिटल ट्विन है। यह अत्यधिक गर्मी को ट्रैक करता है और परिसर को ठंडा रखने के उपाय सिमुलेट करता है।',
                or: 'ଶେଡରୁଟ୍ ହେଉଛି SOA ITER କ୍ୟାମ୍ପସ ପାଇଁ ଏକ ଡିଜିଟାଲ୍ ଟ୍ୱିନ୍। ଏହା ପ୍ରବଳ ଗରମ ଟ୍ରାକ୍ କରେ ଏବଂ କ୍ୟାମ୍ପସକୁ ଥଣ୍ଡା ରଖିବାକୁ ପଦକ୍ଷେପ ଦେଖାଏ।',
                bn: 'শেডরুট হলো SOA ITER ক্যাম্পাসের জন্য একটি ডিজিটাল টুইন যা তাপদাহ পর্যবেক্ষণ করে এবং ক্যাম্পাস ঠান্ডা রাখার ব্যবস্থা প্রদর্শন করে।',
                es: 'ShadeRoute es un gemelo digital climático para el campus SOA ITER. Monitorea olas de calor y simula intervenciones de enfriamiento.',
                fr: 'ShadeRoute est un jumeau numérique climatique pour le campus SOA ITER, modélisant les îlots de chaleur et simulant le rafraîchissement.'
            },
            placement: 'below',
            beforeStep: () => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar && !sidebar.classList.contains('collapsed')) {
                    sidebar.classList.add('collapsed');
                }
            }
        },
        {
            id: 'kpis',
            target: '.kpi-strip',
            title: {
                en: '📊 Live Campus Heat KPIs',
                hi: '📊 लाइव कैंपस हीट मेट्रिक्स',
                or: '📊 ଲାଇଭ୍ କ୍ୟାମ୍ପସ ହିଟ୍ ସୂଚକ',
                bn: '📊 রিয়েল-টাইম হিট মেট্রিক্স',
                es: '📊 Métricas de Calor en Tiempo Real',
                fr: '📊 Indicateurs de Chaleur en Direct'
            },
            text: {
                en: 'Real-time overview of campus thermal health: 820 high-resolution 10m sectors scanned, 142 urgent hotspots, placed cooling items, and peak satellite ground temperatures.',
                hi: 'परिसर के तापमान का त्वरित अवलोकन: 820 स्कैन किए गए ज़ोन, अत्यधिक गर्म हॉटस्पॉट, लगाए गए पेड़/स्प्रेयर और अधिकतम ज़मीनी तापमान।',
                or: 'କ୍ୟାମ୍ପସ ତାପମାତ୍ରାର ସଂକ୍ଷିପ୍ତ ସୂଚନା: ୮୨୦ ସ୍କାନ୍ ହୋଇଥିବା ଜୋନ୍, ଅତ୍ୟଧିକ ଗରମ ସ୍ଥାନ, ଏବଂ ସର୍ବାଧିକ ଭୂମି ତାପମାତ୍ରା।',
                bn: 'ক্যাম্পাসের সামগ্রিক তাপমাত্রার সূচক: ৮২০টি স্ক্যান করা জোন, আশু হটস্পট এবং উপগ্রহ থেকে প্রাপ্ত সর্বোচ্চ ভূমি তাপমাত্রা।',
                es: 'Resumen en tiempo real: 820 sectores analizados, 142 puntos críticos de calor, árboles plantados y temperatura máxima superficial.',
                fr: 'Vue d’ensemble en direct : 820 secteurs analysés, 142 points chauds critiques, actions de refroidissement et température de surface maximale.'
            },
            placement: 'below',
            beforeStep: () => {
                // Collapse sidebar to ensure 100% unobstructed view of KPI strip
                const sidebar = document.getElementById('sidebar');
                if (sidebar && !sidebar.classList.contains('collapsed')) {
                    sidebar.classList.add('collapsed');
                }
            }
        },
        {
            id: 'trees',
            target: '.scenario-card-tree',
            title: {
                en: '🌳 Step 1: Simulate Shade Trees',
                hi: '🌳 चरण 1: छायादार पेड़ लगाना',
                or: '🌳 ପ୍ରଥମ ପଦକ୍ଷେପ: ଛାଇ ଗଛ ଲଗାଇବା',
                bn: '🌳 ধাপ ১: ছায়া প্রদানকারী গাছ লাগানো',
                es: '🌳 Paso 1: Simular Árboles de Sombra',
                fr: '🌳 Étape 1 : Simuler des Arbres d’Ombrage'
            },
            text: {
                en: 'Use the slider or preset chips to pick your tree target. ShadeRoute AI automatically targets the hottest, unshaded student walkways to block solar radiation and cool ground by up to 4°C.',
                hi: 'स्लाइडर का उपयोग करके पेड़ों की संख्या चुनें। एआई स्वचालित रूप से सबसे गर्म रास्तों पर पेड़ लगाता है जो धूप रोककर तापमान 4°C तक कम कर सकते हैं।',
                or: 'ସ୍ଲାଇଡର୍ ବ୍ୟବହାର କରି ଗଛ ସଂଖ୍ୟା ବାଛନ୍ତୁ। AI ସ୍ୱୟଂଚାଳିତ ଭାବେ ସବୁଠାରୁ ଗରମ ରାସ୍ତାରେ ଗଛ ସ୍ଥାପନ କରି ୪°C ପର୍ଯ୍ୟନ୍ତ ତାପମାତ୍ରା କମାଇପାରେ।',
                bn: 'স্লাইডার ব্যবহার করে গাছের সংখ্যা নির্বাচন করুন। এআই স্বয়ংক্রিয়ভাবে ক্যাম্পাসের সবচেয়ে উত্তপ্ত পায়ে হাঁটার রাস্তায় গাছ স্থাপন করে।',
                es: 'Usa el deslizador para elegir la cantidad de árboles. La IA busca automáticamente los caminos más calurosos para bloquear el sol y reducir hasta 4°C.',
                fr: 'Réglez le curseur pour choisir le nombre d’arbres. L’IA cible automatiquement les allées piétonnes les plus chaudes pour réduire la température jusqu’à 4°C.'
            },
            placement: 'sidebar-right',
            beforeStep: () => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar && sidebar.classList.contains('collapsed')) {
                    sidebar.classList.remove('collapsed');
                }
                if (typeof window.setAppMode === 'function') {
                    window.setAppMode('intervention');
                }
            }
        },
        {
            id: 'mist',
            target: '.scenario-card-mist',
            title: {
                en: '💧 Step 2: Install Mist Sprayers',
                hi: '💧 चरण 2: मिस्ट स्प्रेयर स्थापित करना',
                or: '💧 ଦ୍ୱିତୀୟ ପଦକ୍ଷେପ: ମିଷ୍ଟ ସ୍ପ୍ରେୟାର ସ୍ଥାପନ',
                bn: '💧 ধাপ ২: মিস্ট স্প্রেয়ার স্থাপন',
                es: '💧 Paso 2: Instalar Nebulizadores',
                fr: '💧 Étape 2 : Installer des Brumiseurs'
            },
            text: {
                en: 'Install mist posts along student pathways between hostels and academic buildings. Ultra-fine water mist provides instant evaporative cooling up to ~2°C.',
                hi: 'छात्रावास और कक्षाओं के बीच पैदल रास्तों पर मिस्ट स्प्रेयर लगाएं। यह वाष्पीकरण के माध्यम से हवा को तुरंत 2°C तक ठंडा करता है।',
                or: 'ଛାତ୍ରାବାସ ଓ କ୍ଲାସରୁମ୍ ମଧ୍ୟରେ ଥିବା ରାସ୍ତାରେ ମିଷ୍ଟ ସ୍ପ୍ରେୟାର ଲଗାନ୍ତୁ, ଯାହା ତୁରନ୍ତ ୨°C ପର୍ଯ୍ୟନ୍ତ ଥଣ୍ଡା ଅନୁଭବ ଦିଏ।',
                bn: 'হস্টেল ও ক্লাসরুমের মধ্যবর্তী পথে মিস্ট পোস্ট স্থাপন করুন। এটি তাৎক্ষণিকভাবে প্রায় ২°C তাপমাত্রা কমায়।',
                es: 'Instala nebulizadores en los caminos entre residencias y aulas. Proporcionan enfriamiento evaporativo instantáneo de hasta 2°C.',
                fr: 'Installez des brumisateurs sur les allées entre résidences et salles de cours pour un rafraîchissement évaporatif immédiat jusqu’à 2°C.'
            },
            placement: 'sidebar-right'
        },
        {
            id: 'cooling-impact',
            target: '.cooling-impact-banner',
            title: {
                en: '❄️ Before & After Cooling Preview',
                hi: '❄️ पहले और बाद का कूलिंग प्रभाव',
                or: '❄️ ପୂର୍ବ ଓ ପର ତାପମାତ୍ରା ପ୍ରଭାବ',
                bn: '❄️ তাপমাত্রা হ্রাসের পূর্বাভাস',
                es: '❄️ Vista Previa del Impacto Térmico',
                fr: '❄️ Aperçu Avant / Après Refroidissement'
            },
            text: {
                en: 'Watch the cooling meter compare before vs. after temperatures as you add trees and mist units to see your campus heat reduction.',
                hi: 'जैसे ही आप पेड़ और स्प्रेयर लगाते हैं, वास्तविक समय में तापमान में अनुमानित गिरावट देखें।',
                or: 'ଆପଣ ଗଛ ଓ ସ୍ପ୍ରେୟାର ଲଗାଇବା ସହିତ ତାପମାତ୍ରା ହ୍ରାସର ଫଳାଫଳ ପ୍ରତ୍ୟକ୍ଷ ଦେଖନ୍ତୁ।',
                bn: 'গাছ এবং স্প্রেয়ার যোগ করার সাথে সাথে তাপমাত্রার পরিবর্তন সরাসরি প্রত্যক্ষ করুন।',
                es: 'Observa la reducción de temperatura estimada en tiempo real a medida que agregas árboles y nebulizadores.',
                fr: 'Visualisez la baisse de température estimée en temps réel au fur et à mesure que vous ajoutez des arbres et des brumisateurs.'
            },
            placement: 'sidebar-right'
        },
        {
            id: 'heatwave-forecast',
            target: '#rightPredictionCard',
            title: {
                en: '🔥 Multi-Horizon Heatwave Forecast',
                hi: '🔥 मल्टी-हॉराइजन हीटवेव पूर्वानुमान',
                or: '🔥 ମଲ୍ଟି-ହରାଇଜନ୍ ହିଟୱେଭ୍ ପୂର୍ବାନୁମାନ',
                bn: '🔥 বহুমুখী তাপদাহ পূর্বাভাস',
                es: '🔥 Pronóstico Multidía de Olas de Calor',
                fr: '🔥 Prévision des Vagues de Chaleur Multijours'
            },
            text: {
                en: 'Live probabilistic heatwave forecasting covering same-day (H0) and 1 to 3-day lead times (H1–H3). Shows hourly danger windows, temperatures, and alerts derived from ECMWF numerical weather predictions.',
                hi: 'समान दिन (H0) और 1 से 3 दिन की लीड-टाइम (H1-H3) पर आधारित लाइव हीटवेव पूर्वानुमान। यह ईसीएमडब्ल्यूएफ (ECMWF) मौसम मॉडल से खतरे की चरम अवधि और तापमान दिखाता है।',
                or: 'ସମାନ ଦିନ (H0) ଏବଂ ୧ ରୁ ୩ ଦିନ ଆଗୁଆ (H1-H3) ହିଟୱେଭ୍ ସମ୍ଭାବନା। ଏହା ECMWF ପାଣିପାଗ ପୂର୍ବାନୁମାନରୁ ସର୍ବାଧିକ ବିପଦ ସମୟ ଏବଂ ତାପମାତ୍ରା ପ୍ରଦର୍ଶନ କରେ।',
                bn: 'একই দিন (H0) এবং ১ থেকে ৩ দিন পূর্বের (H1-H3) সম্ভাব্য তাপদাহ পূর্বাভাস, পিক বিপদ ঘণ্টা এবং তাপমাত্রা প্রদর্শন করে।',
                es: 'Predicción probabilística de olas de calor a corto y mediano plazo (H0 a H3) con ventanas horarias de peligro basadas en modelos ECMWF.',
                fr: 'Prévisions probabilistes des vagues de chaleur (de H0 à H3) affichant les créneaux horaires les plus dangereux selon les modèles ECMWF.'
            },
            placement: 'prediction-left',
            beforeStep: () => {
                // Ensure sidebar is collapsed to maximize focus on prediction widget
                const sidebar = document.getElementById('sidebar');
                if (sidebar && !sidebar.classList.contains('collapsed')) {
                    sidebar.classList.add('collapsed');
                }
                // Ensure prediction widget is expanded and showing weather tab
                if (typeof window.setPredictionTab === 'function') {
                    window.setPredictionTab('weather');
                }
                if (typeof window.setPredictionWidgetCollapsed === 'function') {
                    window.setPredictionWidgetCollapsed(false);
                }
            }
        },
        {
            id: 'hospital-surge',
            target: '#rightPredictionCard',
            title: {
                en: '🏥 Hospital Surge & Clinical Readiness',
                hi: '🏥 अस्पताल सर्ज और चिकित्सीय तत्परता',
                or: '🏥 ଡାକ୍ତରଖାନା ସର୍ଜ ଓ ଚିକିତ୍ସା ପ୍ରସ୍ତୁତି',
                bn: '🏥 হাসপাতাল প্রস্তুতি ও রোগী চাপ',
                es: '🏥 Capacidad Hospitalaria y Afluencia Clínica',
                fr: '🏥 Afflux Hospitalier et Préparation Clinique'
            },
            text: {
                en: 'Scenario-based clinical readiness for 4 hospitals near SOA ITER (including IMS & SUM Hospital). Forecasts emergency OPD volume surges, Heat Stroke Unit (HSU) bed requirements, and cold IV fluid supplies.',
                hi: 'सोआ आईटर के पास स्थित 4 अस्पतालों (जैसे IMS & SUM हॉस्पिटल) के लिए आपातकालीन मरीज वृद्धि (OPD surge), हीट स्ट्रोक यूनिट (HSU) बेड और आवश्यक आईवी फ्लुइड्स की योजना बनाने में मदद करता है।',
                or: 'SOA ITER ନିକଟସ୍ଥ ୪ଟି ଡାକ୍ତରଖାନା (ଯେପରିକି IMS & SUM ହସ୍ପିଟାଲ୍) ପାଇଁ ଜରୁରୀକାଳୀନ ରୋଗୀ ସଂଖ୍ୟା ବୃଦ୍ଧି, ହିଟ୍ ଷ୍ଟ୍ରୋକ୍ ବେଡ୍ ଏବଂ ଆଇଭି ଫ୍ଲୁଇଡ୍ ଆବଶ୍ୟକତାର ଆଗୁଆ ଆକଳନ।',
                bn: 'SOA ITER-এর নিকটবর্তী ৪টি হাসপাতালের জন্য জরুরি বহির্বিভাগ (OPD) রোগীর চাপ এবং হিট স্ট্রোক বেডের আনুমানিক প্রস্তুতি ব্যবস্থা।',
                es: 'Estimación de afluencia de pacientes para 4 centros médicos cercanos (incluido el hospital IMS & SUM), camas para golpes de calor y sueros.',
                fr: 'Préparation clinique pour 4 centres hospitaliers proches (dont l’hôpital IMS & SUM), prévoyant l’afflux aux urgences et les lits d’urgence thermique.'
            },
            placement: 'prediction-left',
            beforeStep: () => {
                // Ensure sidebar is collapsed to maximize focus on prediction widget
                const sidebar = document.getElementById('sidebar');
                if (sidebar && !sidebar.classList.contains('collapsed')) {
                    sidebar.classList.add('collapsed');
                }
                // Switch prediction widget to hospital surge tab
                if (typeof window.setPredictionTab === 'function') {
                    window.setPredictionTab('surge');
                }
                if (typeof window.setPredictionWidgetCollapsed === 'function') {
                    window.setPredictionWidgetCollapsed(false);
                }
            }
        },
        {
            id: 'heat-stress',
            target: '#modeHeatStressBtn',
            title: {
                en: '🔥 Heat Danger Zones & Live NWP',
                hi: '🔥 हीट अलर्ट ज़ोन और मौसम पूर्वानुमान',
                or: '🔥 ହିଟ୍ ଆଲର୍ଟ ଜୋନ୍ ଓ ପାଣିପାଗ ପୂର୍ବାନୁମାନ',
                bn: '🔥 হিট ডেঞ্জার জোন ও আবহাওয়া টাইমলাইন',
                es: '🔥 Zonas de Peligro Térmico y Satélite',
                fr: '🔥 Zones de Danger Thermique et Météo'
            },
            text: {
                en: 'Switch to Heat Stress Alerts to see 5-tier danger zones based on India Meteorological Department (IMD) standards, select active dates, and sync dynamic forecasts.',
                hi: 'भारतीय मौसम विभाग (IMD) के मानकों पर आधारित 5-स्तरीय हीट ज़ोन देखने और पूर्वानुमान तिथियों को चुनने के लिए इस मोड पर स्विच करें।',
                or: 'ଭାରତୀୟ ପାଣିପାଗ ବିଭାଗ (IMD) ମାନକ ଅନୁଯାୟୀ ୫ଟି ବିପଦ ସ୍ତର ଦେଖିବା ପାଇଁ ଏହି ମୋଡ୍ କୁ ଯାଆନ୍ତୁ।',
                bn: 'ভারতীয় আবহাওয়া বিভাগের (IMD) ৫-স্তরের বিপদ জোন দেখতে এবং তারিখ পরিবর্তন করতে এই মোডে যান।',
                es: 'Cambia al modo de alertas para ver las 5 zonas de peligro según los estándares meteorológicos de la India (IMD) y navegar por las fechas.',
                fr: 'Passez en mode alertes pour visualiser les 5 niveaux de danger selon les normes de l’IMD et naviguer dans les dates prévisionnelles.'
            },
            placement: 'sidebar-right',
            beforeStep: () => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar && sidebar.classList.contains('collapsed')) {
                    sidebar.classList.remove('collapsed');
                }
            },
            afterStep: () => {
                if (typeof window.setAppMode === 'function') {
                    window.setAppMode('heatstress');
                }
            }
        },
        {
            id: 'ira-assistant',
            target: '#askIraTopBtn',
            title: {
                en: '✨ Meet Ira (इरा) — Your AI Guide',
                hi: '✨ मिलिए इरा (Ira) से — आपकी एआई गाइड',
                or: '✨ ଭେଟନ୍ତୁ ଇରା (Ira) — ଆପଣଙ୍କ ଏଆଇ ଗାଇଡ୍',
                bn: '✨ পরিচিত হোন ইরা (Ira)-র সাথে — আপনার এআই গাইড',
                es: '✨ Conoce a Ira (इरा) — Tu Asistente IA',
                fr: '✨ Découvrez Ira (इरा) — Votre Guide IA'
            },
            text: {
                en: 'Need answers anytime? Click "Ask Ira" in the top bar! Ira answers questions accurately in simple words across English, Hindi, Odia, Bengali, Spanish, and French.',
                hi: 'कभी भी सहायता चाहिए? ऊपर "Ask Ira" पर क्लिक करें! इरा आपको सरल शब्दों में अंग्रेजी, हिंदी, ओडिया आदि भाषाओं में तुरंत उत्तर देती हैं।',
                or: 'ଯେକୌଣସି ସମୟରେ ସାହାଯ୍ୟ ଦରକାର? ଉପରେ "Ask Ira" ରେ କ୍ଲିକ୍ କରନ୍ତୁ! ଇରା ସରଳ ଭାଷାରେ ଆପଣଙ୍କ ପ୍ରଶ୍ନର ସଠିକ୍ ଉତ୍ତର ଦେବେ।',
                bn: 'যেকোনো সময় সাহায্যের জন্য উপরে "Ask Ira" বাটনে ক্লিক করুন! ইরা সহজ ভাষায় আপনার সমস্ত প্রশ্নের উত্তর দেবে।',
                es: '¿Preguntas en cualquier momento? Haz clic en "Ask Ira". Responderá tus dudas de forma clara en tu idioma preferido.',
                fr: 'Une question à tout moment ? Cliquez sur "Ask Ira" dans la barre supérieure ! Ira vous répondra simplement dans votre langue.'
            },
            placement: 'below'
        }
    ];

    class ShadeRouteTour {
        constructor() {
            this.currentStep = 0;
            this.isActive = false;
            this.lang = localStorage.getItem('sr_ira_lang') || 'en';
            this.dom = {};
            this.initDOM();
            this.bindEvents();
        }

        initDOM() {
            let overlay = document.getElementById('srTourOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'srTourOverlay';
                overlay.className = 'sr-tour-overlay';
                overlay.innerHTML = `
                    <div id="srTourSpotlight" class="sr-tour-spotlight"></div>
                    <div id="srTourCard" class="sr-tour-card" role="dialog" aria-modal="true">
                        <div class="sr-tour-card-header">
                            <span id="srTourStepBadge" class="sr-tour-badge">Step 1 of 9</span>
                            <button id="srTourCloseBtn" class="sr-tour-close-btn" title="End Tour" aria-label="End Tour">✕</button>
                        </div>
                        <h3 id="srTourTitle" class="sr-tour-title"></h3>
                        <p id="srTourText" class="sr-tour-text"></p>
                        <div class="sr-tour-actions">
                            <button id="srTourPrevBtn" class="sr-tour-btn sr-tour-btn-secondary">← Back</button>
                            <div class="sr-tour-dots" id="srTourDots"></div>
                            <button id="srTourNextBtn" class="sr-tour-btn sr-tour-btn-primary">Next →</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
            }

            this.dom = {
                overlay,
                spotlight: document.getElementById('srTourSpotlight'),
                card: document.getElementById('srTourCard'),
                stepBadge: document.getElementById('srTourStepBadge'),
                title: document.getElementById('srTourTitle'),
                text: document.getElementById('srTourText'),
                dots: document.getElementById('srTourDots'),
                prevBtn: document.getElementById('srTourPrevBtn'),
                nextBtn: document.getElementById('srTourNextBtn'),
                closeBtn: document.getElementById('srTourCloseBtn')
            };
        }

        bindEvents() {
            this.dom.closeBtn.addEventListener('click', () => this.endTour());
            this.dom.prevBtn.addEventListener('click', () => this.prevStep());
            this.dom.nextBtn.addEventListener('click', () => this.nextStep());

            window.addEventListener('keydown', (e) => {
                if (!this.isActive) return;
                if (e.key === 'Escape') this.endTour();
                if (e.key === 'ArrowRight') this.nextStep();
                if (e.key === 'ArrowLeft') this.prevStep();
            });

            window.addEventListener('resize', () => {
                if (this.isActive) this.renderStep(this.currentStep);
            });
        }

        setLanguage(lang) {
            this.lang = lang || 'en';
            if (this.isActive) {
                this.renderStep(this.currentStep);
            }
        }

        startTour(lang) {
            if (lang) this.lang = lang;
            this.isActive = true;
            this.currentStep = 0;
            this.dom.overlay.classList.add('active');
            document.body.classList.add('sr-tour-running');
            this.renderStep(0);
        }

        endTour() {
            this.isActive = false;
            this.dom.overlay.classList.remove('active');
            document.body.classList.remove('sr-tour-running');
            const sidebar = document.getElementById('sidebar');
            if (sidebar && sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
            }
        }

        nextStep() {
            if (this.currentStep < TOUR_STEPS.length - 1) {
                this.currentStep++;
                this.renderStep(this.currentStep);
            } else {
                this.endTour();
            }
        }

        prevStep() {
            if (this.currentStep > 0) {
                this.currentStep--;
                this.renderStep(this.currentStep);
            }
        }

        renderStep(index) {
            const step = TOUR_STEPS[index];
            if (!step) return;

            if (typeof step.beforeStep === 'function') {
                step.beforeStep();
            }

            // Text localization
            const title = step.title[this.lang] || step.title['en'];
            const text = step.text[this.lang] || step.text['en'];

            this.dom.title.textContent = title;
            this.dom.text.textContent = text;

            const isHindi = this.lang === 'hi';
            const isOdia = this.lang === 'or';
            const stepLabel = isHindi ? `चरण ${index + 1} / ${TOUR_STEPS.length}` :
                             (isOdia ? `ପଦକ୍ଷେପ ${index + 1} / ${TOUR_STEPS.length}` :
                             `Step ${index + 1} of ${TOUR_STEPS.length}`);
            this.dom.stepBadge.textContent = stepLabel;

            // Buttons
            this.dom.prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
            this.dom.prevBtn.textContent = isHindi ? '← वापस' : (isOdia ? '← ପୂର୍ବ' : '← Back');

            const isLast = index === TOUR_STEPS.length - 1;
            this.dom.nextBtn.textContent = isLast
                ? (isHindi ? 'समाप्त ✓' : (isOdia ? 'ସମାପ୍ତ ✓' : 'Finish ✓'))
                : (isHindi ? 'आगे →' : (isOdia ? 'ପରବର୍ତ୍ତୀ →' : 'Next →'));

            // Step dots
            this.dom.dots.innerHTML = TOUR_STEPS.map((_, i) =>
                `<span class="sr-tour-dot ${i === index ? 'active' : ''}"></span>`
            ).join('');

            // Delay positioning slightly to let any sidebar/prediction animation settle
            setTimeout(() => {
                const targetEl = document.querySelector(step.target);
                if (targetEl) {
                    const rect = targetEl.getBoundingClientRect();
                    const pad = 10;

                    // Spotlight highlight geometry
                    this.dom.spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
                    this.dom.spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
                    this.dom.spotlight.style.width = `${rect.width + pad * 2}px`;
                    this.dom.spotlight.style.height = `${rect.height + pad * 2}px`;

                    // Smart non-overlapping card positioning
                    this.positionCardSafely(rect, step.placement || 'below');
                } else {
                    // Center fallback
                    this.dom.spotlight.style.width = '0px';
                    this.dom.spotlight.style.height = '0px';
                    this.dom.card.style.top = '50%';
                    this.dom.card.style.left = '50%';
                    this.dom.card.style.transform = 'translate(-50%, -50%)';
                }

                if (typeof step.afterStep === 'function') {
                    step.afterStep();
                }
            }, 180);
        }

        positionCardSafely(targetRect, placement) {
            const card = this.dom.card;
            const cardWidth = 340;
            const cardHeight = 240;
            const margin = 20;

            let top = 0;
            let left = 0;

            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;

            if (placement === 'below') {
                // Position directly below target with clean clearance
                top = targetRect.bottom + margin;
                left = Math.max(margin, Math.min(targetRect.left, winWidth - cardWidth - margin));
            } else if (placement === 'sidebar-right') {
                // Position to the RIGHT of sidebar so sidebar content is 100% visible
                const sidebar = document.getElementById('sidebar');
                const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : targetRect.right;
                left = sidebarRight + margin;
                top = Math.max(margin, Math.min(targetRect.top - 20, winHeight - cardHeight - margin));
            } else if (placement === 'prediction-left') {
                // Position to the LEFT of rightPredictionCard so card is 100% visible
                if (winWidth >= 768 && (targetRect.left - cardWidth - margin) >= margin) {
                    left = targetRect.left - cardWidth - margin;
                    top = Math.max(margin, Math.min(targetRect.top, winHeight - cardHeight - margin));
                } else {
                    // On narrow screens where side-by-side doesn't fit, position at bottom center
                    left = Math.max(margin, (winWidth - cardWidth) / 2);
                    top = Math.min(winHeight - cardHeight - margin, targetRect.bottom + margin);
                }
            } else if (placement === 'left') {
                left = targetRect.left - cardWidth - margin;
                top = targetRect.top;
            } else {
                top = targetRect.bottom + margin;
                left = targetRect.left;
            }

            // Window boundary safety clamp
            left = Math.max(margin, Math.min(left, winWidth - cardWidth - margin));
            top = Math.max(margin, Math.min(top, winHeight - cardHeight - margin));

            card.style.transform = 'none';
            card.style.top = `${top}px`;
            card.style.left = `${left}px`;
        }
    }

    window.ShadeRouteTour = new ShadeRouteTour();
})();
