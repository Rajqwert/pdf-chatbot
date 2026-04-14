require('dotenv').config();
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function chunkText(text, size = 500, overlap = 50) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    const chunk = text.slice(i, i + size).trim();
    if (chunk.length > 20) chunks.push(chunk); // empty/tiny chunks skip
  }
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getEmbedding(text) {
  const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`
    },
    body: JSON.stringify({
      texts: [text],
      model: 'nomic-embed-text-v1.5',
      task_type: 'search_document'
    })
  });
  const data = await res.json();
  if (!data.embeddings || !data.embeddings[0]) {
    console.error('Embedding error:', JSON.stringify(data));
    throw new Error('Failed to get embedding');
  }
  return data.embeddings[0];
}

async function main() {
  // Pehle purana data delete karo (fresh ingest)
  console.log('Clearing old data...');
  await supabase.from('documents').delete().neq('id', 0);

  const buffer = fs.readFileSync('./sharma-academy.pdf');
  const pdf = await pdfParse(buffer);

  console.log('PDF text sample:', pdf.text.slice(0, 300)); // verify PDF read ho rha hai

  const chunks = chunkText(pdf.text);
  console.log(`Created ${chunks.length} chunks.`);

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunks.length}: ${chunks[i].slice(0, 60)}...`);
    try {
      const embedding = await getEmbedding(chunks[i]);
      const { error } = await supabase.from('documents').insert({ content: chunks[i], embedding });
      if (error) console.error('Supabase insert error:', error);
      else console.log(`✅ Chunk ${i + 1} stored.`);
    } catch (err) {
      console.error(`❌ Chunk ${i + 1} failed:`, err.message);
    }
    await sleep(500);
  }
  console.log('✅ Done! All chunks stored in Supabase!');
}

main().catch(console.error);