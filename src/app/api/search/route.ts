import { Pinecone } from '@pinecone-database/pinecone'
import { NextResponse } from 'next/server';
import { Agent } from "@mastra/core/agent";

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })

const agent = new Agent({
  id: "my-agent",
  name: "My Agent",
  instructions: "You are a helpful assistant. Use the provided context to answer questions. If the answer is not in the context, say you do not know. Don't say anything else.",
  model: "openai/gpt-5-nano"
})

export async function POST(req: Request) {
    try {
        const { query, score } = await req.json();
        const acceptable_score = score == '' ? 0.5 : parseFloat(score);

        // Find similar documents using vector similarity search
        // The match_documents function finds the 5 most similar chunks
        const namespace = pc.index("rag-search-app", "https://rag-search-app-psm6fwc.svc.aped-4627-b74a.pinecone.io").namespace("__default__");
        const {result} = await namespace.searchRecords({
            query: {
                topK: 50,
                inputs: { text: query },
            },
            fields: ['persona', 'chunk_text', 'document'],
        });
        // Combine retrieved chunks into context
        // These chunks will be used as context for the AI to generate an answer
        const context = result.hits.filter(res => res._score >= acceptable_score).map((res:any) => res.fields.chunk_text);
        // Generate answer using OpenAI with retrieved context
        // This is the "Generation" part of RAG
        const completion = await agent.generate(query, {
            context
        })
        
        return NextResponse.json({
            answer: completion.text,
            sources: result.hits
        });

        
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}