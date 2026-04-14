require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getQueryEmbedding(text) {
  const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`
    },
    body: JSON.stringify({
      texts: [text],
      model: 'nomic-embed-text-v1.5',
      task_type: 'search_query'
    })
  });
  const data = await res.json();
  if (!data.embeddings || !data.embeddings[0]) {
    console.error('Embedding API error:', JSON.stringify(data));
    throw new Error('Embedding failed');
  }
  return data.embeddings[0];
}

async function searchChunks(embedding) {
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: 0.1, // lowered from 0.3
    match_count: 5
  });

  if (error) {
    console.error('Supabase RPC error:', error);
    throw error;
  }

  console.log(`Search returned ${data?.length || 0} chunks`);

  if (!data || data.length === 0) return null;
  return data.map(d => d.content).join('\n\n');
}

async function getGroqAnswer(context, userQuery) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant for Sharma Academy.
STRICT RULES:
- Answer ONLY using the context provided below.
- If the information is NOT in the context, say ONLY: "I don't have that information, please contact us at 98765-43210"
- Do NOT make up, guess, or assume any information.
- Do NOT use any outside knowledge.`
        },
        {
          role: 'user',
          content: `Context:\n${context}\n\nQuestion: ${userQuery}`
        }
      ]
    })
  });
  const data = await res.json();
  if (!data.choices || data.choices.length === 0) {
    console.error('Groq error:', JSON.stringify(data));
    throw new Error('Groq API failed');
  }
  return data.choices[0].message.content;
}

// Debug endpoint - browser mein /debug kholo to check DB
app.get('/debug', async (req, res) => {
  const { data, error } = await supabase.from('documents').select('id, content').limit(5);
  res.json({ count: data?.length, sample: data, error });
});

app.post('/chat', async (req, res) => {
  try {
    const { message, question } = req.body;
    const userQuery = message || question;

    if (!userQuery) return res.json({ answer: "Please send a message.", response: "Please send a message." });

    const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'namaste'];
    if (greetings.includes(userQuery.trim().toLowerCase())) {
      return res.json({
        answer: "Hello! 👋 Welcome to Sharma Academy. How can I help you today?",
        response: "Hello! 👋 Welcome to Sharma Academy. How can I help you today?"
      });
    }

    console.log('Query:', userQuery);
    const embedding = await getQueryEmbedding(userQuery);
    const context = await searchChunks(embedding);

    if (!context) {
      console.log('No context found for query:', userQuery);
      return res.json({
        answer: "I don't have that information, please contact us at 98765-43210",
        response: "I don't have that information, please contact us at 98765-43210"
      });
    }

    console.log('Context found, sending to Groq...');
    const answer = await getGroqAnswer(context, userQuery);
    res.json({ answer, response: answer });

  } catch (e) {
    console.error('Chat error:', e);
    res.json({ answer: "Server error: " + e.message, response: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));