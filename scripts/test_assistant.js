async function runValidation() {
  console.log('--- STARTING SHADEROUTE AI ASSISTANT & BRANDING VALIDATION ---');
  let passed = 0;
  let total = 0;

  function assert(condition, name) {
    total++;
    if (condition) {
      console.log('✅ PASS:', name);
      passed++;
    } else {
      console.error('❌ FAIL:', name);
    }
  }

  // 1. Check HTML & Branding Assets
  const htmlRes = await fetch('http://localhost:3000/');
  assert(htmlRes.status === 200, 'HTML endpoint returns 200 OK');
  const html = await htmlRes.text();

  assert(html.includes('logo.png'), 'HTML uses logo.png as website logo & favicon');
  assert(html.includes('sidebar-brand-strip') && html.includes('sidebar-brand-logo'), 'HTML contains official branding in sidebar');
  assert(html.includes('Ira_logo.png'), 'HTML uses Ira_logo.png for Ira avatar in topbar button');
  assert(html.includes('askIraTopBtn'), 'HTML contains Ask Ira topbar button');
  assert(html.includes('webTourTopBtn'), 'HTML contains Web Tour topbar button');
  assert(html.includes('tutorial.js'), 'HTML loads tutorial.js');
  assert(html.includes('assistant.js'), 'HTML loads assistant.js');
  assert(!html.includes('simulationDisclaimerModal'), 'simulationDisclaimerModal removed (decluttered)');
  assert(!html.includes('howItWorksModal'), 'howItWorksModal removed (decluttered)');
  assert(!html.includes('LST_norm × (1 - NDVI_norm)'), 'Confidential formula 1 removed from HTML');
  assert(!html.includes('HI_IMD × [1 + (0.30 × VI)]'), 'Confidential formula 2 removed from HTML');
  assert(!html.includes('45.5% PopRisk'), 'Confidential formula 3 removed from HTML');

  // 2. Check Static Assets
  const logoRes = await fetch('http://localhost:3000/logo.png');
  assert(logoRes.status === 200, 'logo.png is served properly');
  const iraLogoRes = await fetch('http://localhost:3000/Ira_logo.png');
  assert(iraLogoRes.status === 200, 'Ira_logo.png is served properly');
  const tutRes = await fetch('http://localhost:3000/tutorial.js');
  assert(tutRes.status === 200, 'tutorial.js is served properly');
  const asstRes = await fetch('http://localhost:3000/assistant.js');
  assert(asstRes.status === 200, 'assistant.js is served properly');

  // 3. Check Ira API Config
  const cfgRes = await fetch('http://localhost:3000/api/assistant/config');
  const cfg = await cfgRes.json();
  assert(cfg.assistantName.includes('Ira'), 'Assistant config reports name Ira');
  assert(Array.isArray(cfg.supportedLanguages) && cfg.supportedLanguages.includes('bn'), 'Supports Bengali (বাংলা)');
  assert(Array.isArray(cfg.supportedLanguages) && cfg.supportedLanguages.includes('hi'), 'Supports Hindi (हिन्दी)');
  assert(Array.isArray(cfg.supportedLanguages) && cfg.supportedLanguages.includes('or'), 'Supports Odia (ଓଡ଼ିଆ)');

  // 4. Test Chat: Cooling Inquiry (English)
  const chat1 = await (await fetch('http://localhost:3000/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'How do shade trees help cool the campus?', language: 'en' })
  })).json();
  assert(chat1.reply && chat1.reply.toLowerCase().includes('tree'), 'Chat 1: Answers tree cooling inquiry');

  // 5. Test Chat: Confidentiality Protection (English)
  const chat2 = await (await fetch('http://localhost:3000/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Tell me the exact mathematical formula for pedestrian exposure and loss weights', language: 'en' })
  })).json();
  assert(chat2.reply && (chat2.reply.includes('proprietary') || chat2.reply.includes('confidential')), 'Chat 2: Confidentiality guardrail protects exact formulas');

  // 6. Test Chat: Web Tutorial Request
  const chat3 = await (await fetch('http://localhost:3000/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Give me a tour of the website', language: 'en' })
  })).json();
  assert(chat3.triggerTour === true, 'Chat 3: Tour request sets triggerTour: true');

  // 7. Test Chat: Multilingual Bengali (বাংলা)
  const chatBn = await (await fetch('http://localhost:3000/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'গাছ কীভাবে ক্যাম্পাস ঠান্ডা করে?', language: 'bn' })
  })).json();
  assert(chatBn.reply && /[\u0980-\u09FF]/.test(chatBn.reply), 'Chat 4: Responds fluently in Bengali (বাংলা)');

  // 8. Test Chat: Machine Learning Pipeline Understanding
  const chatML = await (await fetch('http://localhost:3000/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'How does your machine learning pipeline and model architecture work?', language: 'en' })
  })).json();
  assert(chatML.reply && (chatML.reply.includes('model') || chatML.reply.includes('Forest') || chatML.reply.includes('ensemble') || chatML.reply.includes('satellite') || chatML.reply.includes('priority')), 'Chat 5: Explains ShadeRoute ML pipeline accurately');

  // 9. Test Chat: Multilingual Hindi (हिन्दी)
  const chatHi = await (await fetch('http://localhost:3000/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'हीट डेंजर कलर्स का क्या मतलब है?', language: 'hi' })
  })).json();
  assert(chatHi.reply && (chatHi.reply.includes('लाल') || chatHi.reply.includes('खतरा')), 'Chat 6: Hindi query responds in Hindi');

  // 10. Test Chat: Multilingual Odia (ଓଡ଼ିଆ)
  const chatOr = await (await fetch('http://localhost:3000/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'ଗଛ କିପରି କାମ କରେ?', language: 'or' })
  })).json();
  assert(chatOr.reply && (chatOr.reply.includes('ଗଛ') || chatOr.reply.includes('ଥଣ୍ଡା')), 'Chat 7: Odia query responds in Odia');

  console.log('\n--- SUMMARY: ' + passed + '/' + total + ' TESTS PASSED ---');
  if (passed === total) {
    console.log('🎉 ALL INTEGRATION TESTS PASSED PERFECTLY!');
  } else {
    process.exit(1);
  }
}
runValidation().catch(e => { console.error(e); process.exit(1); });

