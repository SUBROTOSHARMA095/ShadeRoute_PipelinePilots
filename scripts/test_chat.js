// Quick test of Ira AI chat with RAG
const url = 'http://localhost:3000/api/assistant/chat';
const body = {
    prompt: 'What is the current heatwave risk level for SOA ITER campus and which hospitals are prepared?',
    language: 'en',
    history: []
};

fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
})
.then(r => r.json())
.then(data => {
    console.log('Source:', data.source);
    console.log('Is Fallback:', data.isFallback);
    console.log('RAG Active:', data.ragActive);
    console.log('RAG Sources:', JSON.stringify(data.ragSources || [], null, 2));
    console.log('Credits Left:', data.creditsRemainingToday);
    console.log('\n--- REPLY ---\n');
    console.log(data.reply);
})
.catch(err => console.error('Error:', err.message));
