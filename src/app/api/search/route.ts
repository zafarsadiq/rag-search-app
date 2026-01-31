import { Pinecone } from '@pinecone-database/pinecone'
import { NextResponse } from 'next/server';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })

export async function POST(req: Request) {
    try {
        const { query } = await req.json();

        // Find similar documents using vector similarity search
        // The match_documents function finds the 5 most similar chunks
        const namespace = pc.index("rag-search-app", "https://rag-search-app-psm6fwc.svc.aped-4627-b74a.pinecone.io").namespace("__default__");
        const {result} = await namespace.searchRecords({
            query: {
                topK: 5,
                inputs: { text: query },
            },
            fields: ['persona'],
        });
        return NextResponse.json(result);
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Combine retrieved chunks into context
        // These chunks will be used as context for the AI to generate an answer
        const context = results?.map((r: any) => r.content).join('\n---\n') || '';

        // Generate answer using OpenAI with retrieved context
        // This is the "Generation" part of RAG
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant. Use the provided context to answer questions. If the answer is not in the context, say you do not know.'
                },
                {
                    role: 'user',
                    content: `Context: ${context}\n\nQuestion: ${query}`
                }
            ],
        });

        return NextResponse.json({
            answer: completion.choices[0].message.content,
            sources: results
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}