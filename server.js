// Backend Fastify pour ScanBiblio :
// - Upload image
// - Appel à Google Cloud Vision API pour extraire le texte
// - Recherche floue dans Google Books API pour chaque ligne

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ✅ Création du dossier tmp s'il n'existe pas (important pour Render)
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}
const fastify = Fastify();
await fastify.register(multipart);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
console.log(GOOGLE_API_KEY);

fastify.post('/books/upload', async function (req, reply) {
    const parts = req.parts();
    const filePart = await parts.next();

    if (!filePart || filePart.done || filePart.value?.type !== 'file') {
        return reply.code(400).send({ error: 'Image manquante ou invalide' });
    }

    const { filename: originalName, file } = filePart.value;
    const filename = path.join(__dirname, 'tmp', `${uuidv4()}-${originalName}`);
    await pipeline(file, fs.createWriteStream(filename));

    try {
        const visionRes = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{
                    image: { content: fs.readFileSync(filename).toString('base64') },
                    features: [{ type: 'TEXT_DETECTION' }],
                }],
            }),
        });


        const visionData = await visionRes.json();
        const lines = visionData.responses?.[0]?.textAnnotations?.[0]?.description?.split('\n') || [];

        const results = [];
        for (const line of lines) {
            const booksRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(line)}`);
            const booksData = await booksRes.json();
            const first = booksData.items?.[0]?.volumeInfo;
            if (first) {
                results.push({
                    line,
                    title: first.title,
                    authors: first.authors || [],
                    thumbnail: first.imageLinks?.thumbnail || null,
                });
            }
        }

        reply.send({ results });
    } catch (err) {
        console.error(err);
        reply.code(500).send({ error: 'Erreur durant le traitement de l\'image' });
    } finally {
        fs.unlinkSync(filename);
    }
});

const PORT = process.env.PORT || 3000;
fastify.listen({ port: PORT, host: '0.0.0.0' })
    .then(() => {
        console.log(`📚 Backend ScanBiblio démarré sur http://localhost:${PORT}`);
    })
    .catch(err => {
        console.error('Erreur lors du démarrage du serveur:', err);
        process.exit(1);
    });
