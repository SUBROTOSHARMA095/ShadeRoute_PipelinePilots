require('dotenv').config();
console.log('Key present:', Boolean(process.env.GEMINI_API_KEY));
console.log('Key prefix:', (process.env.GEMINI_API_KEY || '').slice(0,6));
