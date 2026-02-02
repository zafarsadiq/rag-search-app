import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const supabase = createClient(url, publishableKey);
const supabaseStorage = createClient(url, serviceKey);
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })

export async function GET(req: Request) {
  try {
    const reqUrl = new URL(req.url);
    const id = reqUrl.searchParams.get('id');
    const file = reqUrl.searchParams.get('file') === 'true';
    const view = reqUrl.searchParams.get('view') === 'true';

    // Handle file download/view
    if (id && file) {
      const { data: documents } = await supabase
        .from('rag-search-app')
        .select('metadata')
        .eq('metadata->>document_id', id)
        .limit(1);

      if (!documents || documents.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const meta = documents[0].metadata;
      const fileName = meta?.file_name || 'document';
      const fileType = meta?.file_type || 'application/octet-stream';
      const filePath = meta?.file_path || `${id}.${fileName.split('.').pop() || 'pdf'}`;

      const { data: fileData, error: downloadError } = await supabaseStorage.storage
        .from('rag-search-app')
        .download(filePath);

      if (downloadError || !fileData) {
        return NextResponse.json({ 
          error: downloadError?.message || 'File not stored' 
        }, { status: 404 });
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      if (buffer.length === 0) {
        return NextResponse.json({ error: 'File is empty' }, { status: 500 });
      }

      const isPDF = fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': fileType,
          'Content-Disposition': (view && isPDF) 
            ? `inline; filename="${fileName}"` 
            : `attachment; filename="${fileName}"`,
          'Content-Length': buffer.length.toString(),
          ...(view && isPDF ? { 'X-Content-Type-Options': 'nosniff' } : {}),
        },
      });
    }

    // Get single document with text content
    if (id) {
      const { data: chunks, error } = await supabase
        .from('rag-search-app')
        .select('content, metadata')
        .eq('metadata->>document_id', id)
        .order('metadata->>chunk_index', { ascending: true });

      if (error || !chunks || chunks.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const m = chunks[0].metadata || {};
      return NextResponse.json({
        id,
        file_name: m.file_name || 'Unknown',
        file_type: m.file_type || 'unknown',
        file_size: m.file_size || 0,
        upload_date: m.upload_date || new Date().toISOString(),
        total_chunks: chunks.length,
        fullText: chunks.map((c: any) => c.content).join('\n\n'),
        file_url: m.file_url,
        file_path: m.file_path
      });
    }

    // List all documents
    const { data: documents, error } = await supabaseStorage
      .storage
      .from('rag-search-app')
      .list()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Add URLs to each document
    const formatedDocuments = documents.map(doc => {
      const { data } = supabaseStorage
        .storage
        .from('rag-search-app')
        .getPublicUrl(doc.name)

      return {
        id: doc.id,
        file_name: doc.name,
        file_type: doc.metadata.mimetype,
        file_size: doc.metadata.size,
        file_url: data.publicUrl,
        upload_date: doc.uploaded_at
      }
    })
    return NextResponse.json({ formatedDocuments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const name = new URL(req.url).searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'Document ID required' }, { status: 400 });
    }

    // Delete file from storage
   await supabaseStorage.storage.from('rag-search-app').remove([name]);

   //delete embedded data
   const namespace = pc.index("rag-search-app", "https://rag-search-app-psm6fwc.svc.aped-4627-b74a.pinecone.io").namespace("__default__");
    await namespace.deleteMany({
      document: { $eq: name },
    });
    return NextResponse.json({ success: true, fileDeleted: !!name });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
