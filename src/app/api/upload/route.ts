import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { MDocument } from '@mastra/rag';
import { Pinecone } from '@pinecone-database/pinecone'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseStorage = createClient(url, serviceKey || anonKey);
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })

function safeDecodeURIComponent(str: string): string {
    try {
        return decodeURIComponent(str);
    } catch {
        try {
            return decodeURIComponent(str.replace(/%/g, '%25'));
        } catch {
            return str;
        }
    }
}

async function extractTextFromFile(file: File): Promise<string> {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith(".docs")) {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    }
    if (fileName.endsWith(".txt")) {
        return buffer.toString('utf-8');
    }
    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
}

export async function POST(req: Request) {
    try {
        const file = (await req.formData()).get('file') as File;
        if (!file) {
            return NextResponse.json({ error: "no file uploaded", status: 400 })
        }
        // Extract text from file
        const text = await extractTextFromFile(file);
        if (!text || text.trim().length === 0) {
            return NextResponse.json({
                error: 'Could not extract text from file'
            }, { status: 400 });
        }
        const documentID = crypto.randomUUID()
        const uploadDate = new Date().toISOString()
        const filePath = `${documentID}.${file.name.split('.').pop() || 'bin'}`
        // Upload file to Supabase Storage
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const { error: storageError } = await supabaseStorage.storage
            .from('rag-search-app')
            .upload(filePath, fileBuffer, {
                contentType: file.type || 'application/octet-stream',
                upsert: false,
            });

        if (storageError) {
            const msg = storageError.message || 'Unknown storage error';
            if (msg.includes('row-level security') || msg.includes('RLS')) {
                return NextResponse.json({
                    success: false,
                    error: `Storage RLS error: ${msg}. Ensure SUPABASE_SERVICE_ROLE_KEY is set.`
                }, { status: 500 });
            }
            return NextResponse.json({
                success: false,
                error: `Failed to store file: ${msg}`
            }, { status: 500 });
        }

        // Get public URL for the file
        const { data: urlData } = supabaseStorage.storage
            .from('rag-search-app')
            .getPublicUrl(filePath);

        /* chunking and embedding */
        // 1. Initialize document
        const doc = MDocument.fromText(text);

        // 2. Create chunks
        const chunks = await doc.chunk({
            strategy: "recursive",
            maxSize: 512,
            overlap: 50,
        });
        // 3. Upsert records to pinecone
        const namespace = pc.index("rag-search-app", "https://rag-search-app-psm6fwc.svc.aped-4627-b74a.pinecone.io").namespace("__default__");
        namespace.upsertRecords(chunks.map((chunk, i) => {
            return {
                id: `${documentID}-${i}`,
                chunk_text: chunk.text,
                text: chunk.text,
                persona: ['developer', 'business owner', 'agency'][Math.round((Math.random()*100))%3],
                document: filePath
            }
        }));
        return NextResponse.json({ success: true, documentID, uploadDate, filePath, urlData, chunks: chunks.length })
    } catch (e: unknown) { // <-- note `e` has explicit `unknown` type
        let msg = '';
        if (typeof e === "string") {
            msg = e;
        } else if (e instanceof Error) {
            msg = e.message // works, `e` narrowed to Error
        }
        return NextResponse.json({ error: msg, status: 500 })
    }
}
