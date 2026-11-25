const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 70000;

export async function extractDocument(file, onProgress = () => {}) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over the 15 MB limit.`);
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf' || file.type === 'application/pdf') return extractPdf(file, onProgress);
  if (['txt', 'md', 'csv'].includes(ext) || file.type.startsWith('text/')) {
    return (await file.text()).slice(0, MAX_EXTRACTED_CHARS);
  }
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    onProgress(`Reading text from ${file.name}…`);
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(file);
      return data.text.slice(0, MAX_EXTRACTED_CHARS);
    } finally {
      await worker.terminate();
    }
  }
  throw new Error(`${file.name}: use a PDF, image, or text file.`);
}

async function extractPdf(file, onProgress) {
  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  let chars = 0;
  for (let n = 1; n <= pdf.numPages && chars < MAX_EXTRACTED_CHARS; n += 1) {
    onProgress(`Reading ${file.name} · page ${n} of ${pdf.numPages}`);
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(' ');
    pages.push(text);
    chars += text.length;
  }
  const result = pages.join('\n');
  if (result.trim().length < 80) {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const ocr = [];
      for (let n = 1; n <= Math.min(pdf.numPages, 12); n += 1) {
        onProgress(`Scanning ${file.name} · page ${n}`);
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
        const { data } = await worker.recognize(canvas);
        ocr.push(data.text);
      }
      return ocr.join('\n').slice(0, MAX_EXTRACTED_CHARS);
    } finally {
      await worker.terminate();
    }
  }
  return result.slice(0, MAX_EXTRACTED_CHARS);
}

export const fileRules = 'Upload PDF, JPG, PNG, WEBP, TXT, or MD files up to 15 MB each.';
